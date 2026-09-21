const CACHE_NAME = 'guide-v6';
const PRECACHE = ['/guide', '/guide/manifest.webmanifest'];
const DB_NAME = 'guide-queue-v2';
const LEGACY_DB_NAME = 'guide-queue';
const DB_VERSION = 1;
const STORE = 'check-ins';
const AUTH_STORE = 'auth-context';
const AUTH_KEY = 'current';
const MAX_SYNC_ITEMS = 25;
const MAX_AUTO_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;
const SYNC_TAG = 'sync-check-ins-v2';
let syncFlight = null;

self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function(c) { return c.addAll(PRECACHE); }).catch(function() {}));
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME && k.indexOf('guide-') === 0; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
      .then(function() { return invalidateLegacyAuthContext(); })
      .then(function() { return migrateLegacyQueue(); })
  );
});

self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);
  if (!url.pathname.startsWith('/guide')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(function(res) {
        const copy = res.clone();
        caches.open(CACHE_NAME).then(function(c) { c.put(event.request, copy); }).catch(function() {});
        return res;
      })
      .catch(function() {
        return caches.match(event.request).then(function(m) {
          return m || new Response('Offline', { status: 503 });
        });
      })
  );
});

self.addEventListener('sync', function(event) {
  if (event.tag === SYNC_TAG || event.tag === 'sync-check-ins') {
    event.waitUntil(migrateLegacyQueue().then(function() { return syncCheckIns(); }));
  }
});

function retryDelayMs(attempt, retryAfter, now) {
  const exponential = Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * (2 ** Math.min(20, Math.max(0, attempt - 1)))
  );
  let requested = 0;
  const value = typeof retryAfter === 'string' ? retryAfter.trim() : '';
  if (/^\d+$/.test(value)) requested = Number(value) * 1_000;
  else if (value) {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) requested = parsed - now;
  }
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(exponential, Number.isFinite(requested) ? requested : 0));
}

function retryQueueItem(item, reason, retryAfter, now) {
  const attempts = (item.attempts || 0) + 1;
  const next = {
    ...item,
    status: attempts >= MAX_AUTO_ATTEMPTS ? 'retry_exhausted' : 'pending',
    attempts: attempts,
    lastError: reason,
    updatedAt: now,
  };
  if (next.status === 'pending') next.nextAttemptAt = now + retryDelayMs(attempts, retryAfter, now);
  else delete next.nextAttemptAt;
  return next;
}

function workerAuthority(authState) {
  const owner = authState && (authState.context || authState.owner);
  if (!authState || !authState.authorityId || !owner || !owner.userId || !owner.businessId) return null;
  return {
    generation: authState.generation,
    authorityId: authState.authorityId,
    userId: owner.userId,
    businessId: owner.businessId,
  };
}

function sameWorkerAuthority(left, right) {
  return !!left && !!right
    && left.generation === right.generation
    && left.authorityId === right.authorityId
    && left.userId === right.userId
    && left.businessId === right.businessId;
}

function syncCheckIns() {
  if (syncFlight) return syncFlight;
  syncFlight = (async function() {
    const db = await openDb();
    try {
      const all = (await idbGetAll(db)).sort(function(a, b) {
        return (a.updatedAt || a.queuedAt || 0) - (b.updatedAt || b.queuedAt || 0);
      });
      let retryCursor = Math.max(Date.now(), ...all.map(function(item) { return item.updatedAt || item.queuedAt || 0; }));
      const retryTime = function() { retryCursor += 1; return retryCursor; };
      let retryableFailure = false;
      let submitted = 0;
      let deferredReplay = false;
      let completed = 0;
      let outcomeAuthority = null;
      const updates = [];

      for (const item of all) {
        if (!item.userId || !item.businessId) {
          const quarantined = { ...item, status: 'blocked_legacy', lastError: 'missing_owner', updatedAt: retryTime() };
          delete quarantined.token;
          await idbPut(db, quarantined);
          continue;
        }
        if (item.status === 'blocked_legacy' || item.status === 'failed' || item.status === 'retry_exhausted') continue;
        if (item.status === 'pending' && (item.attempts || 0) >= MAX_AUTO_ATTEMPTS) {
          const exhausted = {
            ...item, status: 'retry_exhausted', lastError: item.lastError || 'retry_limit', updatedAt: retryTime(),
          };
          delete exhausted.nextAttemptAt;
          await idbPut(db, exhausted);
          continue;
        }
        const authState = await idbGetAuthState(db);
        const auth = authState.context;
        if (!authState.authorityId || !auth || !auth.userId || !auth.businessId
            || !auth.accessToken || !auth.credentialId) {
          if (item.status !== 'needs_reauth' || item.lastError !== 'missing_auth') {
            await idbPut(db, { ...item, status: 'needs_reauth', lastError: 'missing_auth', updatedAt: retryTime() });
          }
          continue;
        }
        if (item.userId !== auth.userId || item.businessId !== auth.businessId) {
          if (item.status !== 'blocked_account' || item.lastError !== 'owner_mismatch') {
            await idbPut(db, { ...item, status: 'blocked_account', lastError: 'owner_mismatch', updatedAt: retryTime() });
          }
          continue;
        }
        if (Number.isFinite(item.nextAttemptAt) && item.nextAttemptAt > Date.now()) continue;
        if (submitted >= MAX_SYNC_ITEMS) {
          deferredReplay = true;
          continue;
        }
        const requestAuthority = workerAuthority(authState);
        if (outcomeAuthority && !sameWorkerAuthority(outcomeAuthority, requestAuthority)) {
          deferredReplay = true;
          continue;
        }
        if (!outcomeAuthority) outcomeAuthority = requestAuthority;
        submitted += 1;

        try {
          const response = await fetch('/api/guide/check-in', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': 'Bearer ' + auth.accessToken,
              'x-admin-business-id': auth.businessId,
            },
            body: JSON.stringify(item.payload),
            credentials: 'include',
          });
          const body = await response.json().catch(function() { return null; });
          if (response.ok) {
            const canonical = canonicalCheckInResponse(body, item.payload);
            if (canonical) {
              await idbDelete(db, item.id);
              completed += 1;
              updates.push({
                kind: 'canonical', id: item.id, userId: item.userId, businessId: item.businessId,
                bookingId: item.payload.booking_id, slotId: item.payload.slot_id, canonical: canonical,
              });
            } else {
              const retry = retryQueueItem(item, 'uncertain_success', null, retryTime());
              await idbPut(db, retry);
              retryableFailure = retryableFailure || retry.status === 'pending';
            }
          } else if (response.status === 401) {
            const cleared = await idbClearAuthIfCredential(
              db, authState.generation, authState.authorityId, auth.credentialId
            );
            if (cleared) {
              await idbPut(db, {
                ...item,
                status: 'needs_reauth',
                attempts: (item.attempts || 0) + 1,
                lastError: 'unauthorized',
                updatedAt: retryTime(),
              });
            } else {
              const retry = retryQueueItem(item, 'auth_changed', null, retryTime());
              await idbPut(db, retry);
              retryableFailure = retryableFailure || retry.status === 'pending';
            }
          } else if ([408, 425, 429].includes(response.status) || response.status >= 500) {
            const retryAfter = response.headers && typeof response.headers.get === 'function'
              ? response.headers.get('Retry-After')
              : null;
            const retry = retryQueueItem(item, 'http_' + response.status, retryAfter, retryTime());
            await idbPut(db, retry);
            retryableFailure = retryableFailure || retry.status === 'pending';
          } else if (response.status >= 400 && response.status < 500) {
            const reason = body && typeof body.code === 'string' ? body.code : 'http_' + response.status;
            await idbPut(db, {
              ...item, status: 'failed', attempts: (item.attempts || 0) + 1,
              lastError: reason, serverError: body && typeof body.error === 'string' ? body.error.slice(0, 160) : null,
              updatedAt: retryTime(),
            });
            updates.push({
              kind: 'terminal', id: item.id, userId: item.userId, businessId: item.businessId,
              bookingId: item.payload.booking_id, slotId: item.payload.slot_id, reason: reason,
            });
          } else {
            const retry = retryQueueItem(item, 'unexpected_response', null, retryTime());
            await idbPut(db, retry);
            retryableFailure = retryableFailure || retry.status === 'pending';
          }
        } catch {
          const retry = retryQueueItem(item, 'network', null, retryTime());
          await idbPut(db, retry);
          retryableFailure = retryableFailure || retry.status === 'pending';
        }
      }

      await postQueueStatus(db, {
        progressed: completed,
        deferred: deferredReplay,
        updates: updates,
        authority: outcomeAuthority,
      });
      if (deferredReplay && !await registerCheckInSync()) retryableFailure = true;
      if (retryableFailure) throw new Error('Guide check-in sync remains retryable');
    } finally {
      db.close();
    }
  })();
  syncFlight = syncFlight.finally(function() { syncFlight = null; });
  return syncFlight;
}

function canonicalCheckInResponse(value, payload) {
  if (!value || value.ok !== true || typeof value.replay !== 'boolean') return null;
  if (!Number.isInteger(value.qty) || value.qty < 0) return null;
  if (!Number.isInteger(value.arrived_count) || value.arrived_count < 0 || value.arrived_count > value.qty) return null;
  if (typeof value.checked_in !== 'boolean') return null;
  if (value.checked_in_at !== null && typeof value.checked_in_at !== 'string') return null;
  if (typeof value.slot_id !== 'string' || value.slot_id !== payload.slot_id) return null;
  return {
    ok: true,
    replay: value.replay,
    arrived_count: value.arrived_count,
    qty: value.qty,
    checked_in: value.checked_in,
    checked_in_at: value.checked_in_at,
    slot_id: value.slot_id,
  };
}

self.addEventListener('message', function(event) {
  const message = event.data || {};
  if (message.type === 'GUIDE_AUTH_CONTEXT') {
    const work = migrateLegacyQueue().then(function() { return openDb(); }).then(async function(db) {
      const context = message.context;
      const generation = Number.isSafeInteger(message.generation) ? message.generation : 0;
      const authorityId = typeof message.authorityId === 'string' && message.authorityId ? message.authorityId : null;
      const validContext = context && typeof context.userId === 'string' && context.userId
        && typeof context.businessId === 'string' && context.businessId
        && typeof context.accessToken === 'string' && context.accessToken
        && typeof context.credentialId === 'string' && context.credentialId
        ? context
        : null;
      const applied = authorityId ? await idbApplyAuthContext(db, validContext, generation, authorityId) : false;
      if (applied && validContext) await registerCheckInSync();
      await postQueueStatus(db);
      db.close();
    });
    if (event.waitUntil) event.waitUntil(work);
  } else if (message.type === 'GUIDE_QUEUE_STATUS_REQUEST') {
    const work = migrateLegacyQueue().then(function() { return openDb(); }).then(async function(db) {
      await postQueueStatus(db);
      db.close();
    });
    if (event.waitUntil) event.waitUntil(work);
  } else if (message.type === 'GUIDE_SYNC_REQUEST') {
    const work = migrateLegacyQueue().then(function() { return syncCheckIns(); });
    if (event.waitUntil) event.waitUntil(work);
  } else if (message.type === 'GUIDE_ACKNOWLEDGE_ISSUE') {
    const work = acknowledgeGuideQueueIssue(message);
    if (event.waitUntil) event.waitUntil(work);
  } else if (message.type === 'GUIDE_RETRY_ISSUE') {
    const work = retryGuideQueueIssue(message);
    if (event.waitUntil) event.waitUntil(work);
  } else if (message.type === 'GUIDE_AUTH_REJECTED') {
    const work = rejectGuideQueueCredential(message);
    if (event.waitUntil) event.waitUntil(work);
  }
});

async function rejectGuideQueueCredential(message) {
  const db = await openDb();
  const authState = await idbGetAuthState(db);
  const auth = authState.context;
  if (!auth || authState.generation !== message.generation
      || authState.authorityId !== message.authorityId
      || auth.userId !== message.userId || auth.businessId !== message.businessId
      || auth.credentialId !== message.credentialId) {
    db.close();
    return false;
  }
  const cleared = await idbClearAuthIfCredential(
    db, message.generation, message.authorityId, message.credentialId
  );
  await postQueueStatus(db);
  db.close();
  return cleared;
}

async function acknowledgeGuideQueueIssue(message) {
  const db = await openDb();
  try {
    const resolved = await idbResolveGuideQueueIssue(db, message, 'acknowledge');
    if (resolved) await postQueueStatus(db, { resolved: 1 });
    return resolved;
  } finally {
    db.close();
  }
}

async function retryGuideQueueIssue(message) {
  const db = await openDb();
  try {
    const retried = await idbResolveGuideQueueIssue(db, message, 'retry');
    if (retried) {
      await postQueueStatus(db, { resolved: 1 });
      await registerCheckInSync();
    }
    return retried;
  } finally {
    db.close();
  }
}

function openDb() {
  return new Promise(function(resolve, reject) {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = function(e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(AUTH_STORE)) db.createObjectStore(AUTH_STORE);
    };
    req.onsuccess = function(e) {
      const db = e.target.result;
      db.onversionchange = function() { db.close(); };
      resolve(db);
    };
    req.onerror = function(e) { reject(e); };
  });
}

function idbGetAll(db) {
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    tx.onsuccess = function() { resolve(tx.result || []); };
    tx.onerror = function() { reject(tx.error); };
  });
}

function idbGet(db, id) {
  return new Promise(function(resolve, reject) {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
    req.onsuccess = function() { resolve(req.result); };
    req.onerror = function() { reject(req.error); };
  });
}

function idbDelete(db, id) {
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = function() { resolve(); };
    tx.onerror = function() { reject(tx.error); };
    tx.onabort = function() { reject(tx.error || new Error('IndexedDB delete aborted')); };
  });
}

function idbPut(db, item) {
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = function() { resolve(); };
    tx.onerror = function() { reject(tx.error); };
    tx.onabort = function() { reject(tx.error || new Error('IndexedDB write aborted')); };
  });
}

function idbPutIfAbsent(db, item) {
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req = store.get(item.id);
    let inserted = false;
    req.onsuccess = function() {
      if (req.result) return;
      store.add(item);
      inserted = true;
    };
    tx.oncomplete = function() { resolve(inserted); };
    tx.onerror = function() { reject(tx.error); };
    tx.onabort = function() { reject(tx.error || new Error('IndexedDB insert aborted')); };
  });
}

function idbGetAuthState(db) {
  return new Promise(function(resolve, reject) {
    const req = db.transaction(AUTH_STORE, 'readonly').objectStore(AUTH_STORE).get(AUTH_KEY);
    req.onsuccess = function() {
      resolve(req.result || {
        generation: 0, authorityId: null, context: null, owner: null, credentialRevision: null, retiredCredentialIds: [],
      });
    };
    req.onerror = function() { reject(req.error); };
  });
}

function idbSetAuthState(db, value) {
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(AUTH_STORE, 'readwrite');
    tx.objectStore(AUTH_STORE).put(value, AUTH_KEY);
    tx.oncomplete = function() { resolve(); };
    tx.onerror = function() { reject(tx.error); };
    tx.onabort = function() { reject(tx.error || new Error('IndexedDB auth write aborted')); };
  });
}

function idbResolveGuideQueueIssue(db, message, action) {
  return new Promise(function(resolve, reject) {
    const tx = db.transaction([AUTH_STORE, STORE], 'readwrite');
    const authStore = tx.objectStore(AUTH_STORE);
    const queueStore = tx.objectStore(STORE);
    const authRequest = authStore.get(AUTH_KEY);
    let changed = false;
    authRequest.onsuccess = function() {
      const authState = authRequest.result;
      const auth = authState && authState.context;
      if (!auth || !authState.authorityId || authState.generation !== message.generation
          || authState.authorityId !== message.authorityId
          || auth.userId !== message.userId || auth.businessId !== message.businessId
          || typeof message.itemId !== 'string' || !message.itemId) return;
      const itemRequest = queueStore.get(message.itemId);
      itemRequest.onsuccess = function() {
        const item = itemRequest.result;
        if (!item || item.userId !== auth.userId || item.businessId !== auth.businessId) return;
        if (action === 'acknowledge' && item.status === 'failed') {
          queueStore.delete(item.id);
          changed = true;
        } else if (action === 'retry' && item.status === 'retry_exhausted') {
          const retried = { ...item, status: 'pending', attempts: 0, updatedAt: Date.now() };
          delete retried.lastError;
          delete retried.serverError;
          delete retried.nextAttemptAt;
          queueStore.put(retried);
          changed = true;
        }
      };
      itemRequest.onerror = function() { reject(itemRequest.error); };
    };
    authRequest.onerror = function() { reject(authRequest.error); };
    tx.oncomplete = function() { resolve(changed); };
    tx.onerror = function() { reject(tx.error); };
    tx.onabort = function() { reject(tx.error || new Error('IndexedDB issue resolution aborted')); };
  });
}

async function invalidateLegacyAuthContext() {
  const db = await openDb();
  const current = await idbGetAuthState(db);
  if ((!current.authorityId && (current.context || current.generation))
      || (current.context && (!current.context.credentialId
        || !Number.isSafeInteger(current.context.credentialIssuedAt) || current.context.credentialIssuedAt <= 0
        || !Number.isSafeInteger(current.context.credentialExpiresAt)
        || current.context.credentialExpiresAt <= current.context.credentialIssuedAt))) {
    await idbSetAuthState(db, {
      generation: 0, authorityId: null, context: null, owner: null, credentialRevision: null, retiredCredentialIds: [],
    });
  }
  db.close();
}

function idbApplyAuthContext(db, context, generation, authorityId) {
  if (!authorityId || (context && !context.credentialId)) return Promise.resolve(false);
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(AUTH_STORE, 'readwrite');
    const store = tx.objectStore(AUTH_STORE);
    const req = store.get(AUTH_KEY);
    let applied = false;
    req.onsuccess = function() {
      const current = req.result || {
        generation: 0, authorityId: null, context: null, owner: null, credentialRevision: null, retiredCredentialIds: [],
      };
      const sameAuthority = authorityId === current.authorityId;
      const sameOwner = context && (current.context || current.owner)
        && context.userId === (current.context || current.owner).userId
        && context.businessId === (current.context || current.owner).businessId;
      let retiredCredentialIds = Array.isArray(current.retiredCredentialIds)
        ? current.retiredCredentialIds.slice(-8)
        : [];
      let accepted = generation > current.generation;
      if (generation === current.generation && sameAuthority) {
        if (!context && !current.context) {
          accepted = true;
        } else if (context && sameOwner) {
          const duplicate = current.context && current.context.credentialId === context.credentialId;
          const previousRevision = current.context || current.credentialRevision;
          const incomingRevisionValid = Number.isSafeInteger(context.credentialIssuedAt)
            && context.credentialIssuedAt > 0
            && Number.isSafeInteger(context.credentialExpiresAt)
            && context.credentialExpiresAt > context.credentialIssuedAt;
          const previousRevisionValid = previousRevision
            && Number.isSafeInteger(previousRevision.credentialIssuedAt)
            && previousRevision.credentialIssuedAt > 0
            && Number.isSafeInteger(previousRevision.credentialExpiresAt)
            && previousRevision.credentialExpiresAt > previousRevision.credentialIssuedAt;
          const duplicateRevision = duplicate && ((!previousRevisionValid && !incomingRevisionValid)
            || (incomingRevisionValid && (!previousRevisionValid
              || (context.credentialIssuedAt === previousRevision.credentialIssuedAt
                && context.credentialExpiresAt === previousRevision.credentialExpiresAt))));
          const newer = incomingRevisionValid && (!previousRevisionValid
            || context.credentialIssuedAt > previousRevision.credentialIssuedAt
            || (context.credentialIssuedAt === previousRevision.credentialIssuedAt
              && context.credentialExpiresAt > previousRevision.credentialExpiresAt));
          if (duplicateRevision || (!duplicate && !retiredCredentialIds.includes(context.credentialId) && newer)) {
            accepted = true;
          }
          if (accepted && current.context && current.context.credentialId !== context.credentialId) {
            retiredCredentialIds = retiredCredentialIds.filter(function(id) {
              return id !== current.context.credentialId;
            });
            retiredCredentialIds.push(current.context.credentialId);
            retiredCredentialIds = retiredCredentialIds.slice(-8);
          }
        }
      }
      if (accepted) {
        if (generation > current.generation) retiredCredentialIds = [];
        store.put({
          generation: generation,
          authorityId: authorityId,
          context: context,
          owner: context
            ? { userId: context.userId, businessId: context.businessId }
            : generation > current.generation ? null : current.owner || null,
          credentialRevision: context ? {
            credentialId: context.credentialId,
            credentialIssuedAt: context.credentialIssuedAt,
            credentialExpiresAt: context.credentialExpiresAt,
          } : generation > current.generation ? null : current.credentialRevision || null,
          retiredCredentialIds: retiredCredentialIds,
        }, AUTH_KEY);
        applied = true;
      }
    };
    tx.oncomplete = function() { resolve(applied); };
    tx.onerror = function() { reject(tx.error); };
    tx.onabort = function() { reject(tx.error || new Error('IndexedDB auth update aborted')); };
  });
}

function idbClearAuthIfCredential(db, generation, authorityId, credentialId) {
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(AUTH_STORE, 'readwrite');
    const store = tx.objectStore(AUTH_STORE);
    const req = store.get(AUTH_KEY);
    let cleared = false;
    req.onsuccess = function() {
      const current = req.result || {
        generation: 0, authorityId: null, context: null, owner: null, credentialRevision: null, retiredCredentialIds: [],
      };
      if (current.generation === generation && current.authorityId === authorityId
          && current.context && current.context.credentialId === credentialId) {
        const retiredCredentialIds = Array.isArray(current.retiredCredentialIds)
          ? current.retiredCredentialIds.filter(function(id) { return id !== credentialId; }).slice(-7)
          : [];
        retiredCredentialIds.push(credentialId);
        store.put({
          generation: generation,
          authorityId: authorityId,
          context: null,
          owner: current.context
              ? { userId: current.context.userId, businessId: current.context.businessId }
              : current.owner || null,
          credentialRevision: {
            credentialId: current.context.credentialId,
            credentialIssuedAt: current.context.credentialIssuedAt,
            credentialExpiresAt: current.context.credentialExpiresAt,
          },
          retiredCredentialIds: retiredCredentialIds,
        }, AUTH_KEY);
        cleared = true;
      }
    };
    tx.oncomplete = function() { resolve(cleared); };
    tx.onerror = function() { reject(tx.error); };
    tx.onabort = function() { reject(tx.error || new Error('IndexedDB auth clear aborted')); };
  });
}

function openLegacyDb() {
  return new Promise(function(resolve, reject) {
    const req = indexedDB.open(LEGACY_DB_NAME, 1);
    req.onupgradeneeded = function(e) {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = function(e) {
      const db = e.target.result;
      db.onversionchange = function() { db.close(); };
      resolve(db);
    };
    req.onerror = function(e) { reject(e); };
  });
}

async function migrateLegacyQueue() {
  const legacyDb = await openLegacyDb();
  const legacyItems = await idbGetAll(legacyDb);
  if (legacyItems.length === 0) {
    legacyDb.close();
    return;
  }
  const db = await openDb();
  for (const legacyItem of legacyItems) {
    if (legacyItem.status === 'blocked_legacy' && !legacyItem.token) continue;
    const quarantined = { ...legacyItem, status: 'blocked_legacy', lastError: 'missing_owner', updatedAt: Date.now() };
    delete quarantined.token;
    await idbPutIfAbsent(db, quarantined);
    await idbPut(legacyDb, quarantined);
  }
  db.close();
  legacyDb.close();
}

async function registerCheckInSync() {
  if (self.registration && self.registration.sync && self.registration.sync.register) {
    try {
      await self.registration.sync.register(SYNC_TAG);
      return true;
    } catch { return false; }
  }
  return false;
}

async function postQueueStatus(db, outcome) {
  const items = await idbGetAll(db);
  const authState = await idbGetAuthState(db);
  const auth = authState.context;
  const owner = auth || authState.owner;
  const authority = workerAuthority(authState);
  const counts = { pending: 0, needsReauth: 0, failed: 0, blocked: 0, exhausted: 0 };
  const issues = [];
  let autoRetriesRemaining = 0;
  let nextAttemptAt = null;
  items.forEach(function(item) {
    const legacy = item.status === 'blocked_legacy' || !item.userId || !item.businessId;
    const owned = owner && item.userId === owner.userId && item.businessId === owner.businessId;
    if (!legacy && !owned) return;
    if (item.status === 'needs_reauth') counts.needsReauth += 1;
    else if (item.status === 'retry_exhausted') {
      counts.exhausted += 1;
      if (issues.length < 25) issues.push({
        id: item.id, userId: item.userId, businessId: item.businessId,
        bookingId: item.payload && item.payload.booking_id,
        slotId: item.payload && item.payload.slot_id,
        reason: item.lastError || 'retry_limit',
        retryable: true,
      });
    }
    else if (item.status === 'failed') {
      counts.failed += 1;
      if (issues.length < 25) issues.push({
        id: item.id, userId: item.userId, businessId: item.businessId,
        bookingId: item.payload && item.payload.booking_id,
        slotId: item.payload && item.payload.slot_id,
        reason: item.lastError || 'rejected',
      });
    } else if (item.status === 'blocked_account' || item.status === 'blocked_legacy') {
      counts.blocked += 1;
      if (item.status === 'blocked_legacy' && issues.length < 25) {
        issues.push({
          id: item.id, legacy: true,
          bookingId: item.payload && item.payload.booking_id,
          slotId: item.payload && item.payload.slot_id,
          reason: item.lastError || 'missing_owner',
        });
      }
    }
    else {
      counts.pending += 1;
      autoRetriesRemaining = Math.max(autoRetriesRemaining, Math.max(1, MAX_AUTO_ATTEMPTS - (item.attempts || 0)));
      if (Number.isFinite(item.nextAttemptAt)
          && (nextAttemptAt === null || item.nextAttemptAt < nextAttemptAt)) nextAttemptAt = item.nextAttemptAt;
    }
  });
  const outcomeMatches = !outcome || !outcome.authority || sameWorkerAuthority(outcome.authority, authority);
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(function(client) {
    const message = {
      type: 'GUIDE_QUEUE_STATUS',
      generation: authState.generation,
      authorityId: authState.authorityId || null,
      userId: owner && owner.userId || null,
      businessId: owner && owner.businessId || null,
      counts: counts,
      progressed: outcomeMatches && outcome && outcome.progressed ? outcome.progressed : 0,
      deferred: !!(outcomeMatches && outcome && outcome.deferred),
      autoRetriesRemaining: autoRetriesRemaining,
      nextAttemptAt: nextAttemptAt,
      issues: issues,
    };
    if (outcomeMatches && outcome && outcome.updates && outcome.updates.length) message.updates = outcome.updates;
    if (outcomeMatches && outcome && outcome.resolved) message.resolved = outcome.resolved;
    client.postMessage(message);
  });
}
