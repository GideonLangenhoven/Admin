const CACHE_NAME = 'guide-v4';
const PRECACHE = ['/guide', '/guide/manifest.webmanifest'];
const DB_NAME = 'guide-queue-v2';
const LEGACY_DB_NAME = 'guide-queue';
const DB_VERSION = 1;
const STORE = 'check-ins';
const AUTH_STORE = 'auth-context';
const AUTH_KEY = 'current';
const MAX_SYNC_ITEMS = 25;
const SYNC_TAG = 'sync-check-ins-v2';

self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function(c) { return c.addAll(PRECACHE); }).catch(function() {}));
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME && k.indexOf('guide-') === 0; }).map(function(k) { return caches.delete(k); }));
    }).then(function() { return self.clients.claim(); })
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

async function syncCheckIns() {
  const db = await openDb();
  const all = (await idbGetAll(db)).sort(function(a, b) { return (a.queuedAt || 0) - (b.queuedAt || 0); });
  let retryableFailure = false;
  let submitted = 0;
  let deferredReplay = false;
  let completed = 0;

  for (const item of all) {
    if (!item.userId || !item.businessId) {
      const quarantined = { ...item, status: 'blocked_legacy', lastError: 'missing_owner', updatedAt: Date.now() };
      delete quarantined.token;
      await idbPut(db, quarantined);
      continue;
    }
    if (item.status === 'blocked_legacy' || item.status === 'failed') continue;
    const authState = await idbGetAuthState(db);
    const auth = authState.context;
    if (!auth || !auth.userId || !auth.businessId || !auth.accessToken) {
      if (item.status !== 'needs_reauth' || item.lastError !== 'missing_auth') {
        await idbPut(db, { ...item, status: 'needs_reauth', lastError: 'missing_auth', updatedAt: Date.now() });
      }
      continue;
    }
    if (item.userId !== auth.userId || item.businessId !== auth.businessId) {
      if (item.status !== 'blocked_account' || item.lastError !== 'owner_mismatch') {
        await idbPut(db, { ...item, status: 'blocked_account', lastError: 'owner_mismatch', updatedAt: Date.now() });
      }
      continue;
    }
    if (submitted >= MAX_SYNC_ITEMS) {
      deferredReplay = true;
      continue;
    }
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
      if (response.ok) {
        await idbDelete(db, item.id);
        completed += 1;
      } else if (response.status === 401) {
        const cleared = await idbClearAuthIfGeneration(db, authState.generation);
        await idbPut(db, {
          ...item,
          status: cleared ? 'needs_reauth' : 'pending',
          attempts: (item.attempts || 0) + 1,
          lastError: cleared ? 'unauthorized' : 'auth_changed',
          updatedAt: Date.now(),
        });
        if (!cleared) retryableFailure = true;
      } else if ([408, 425, 429].includes(response.status) || response.status >= 500) {
        await idbPut(db, { ...item, status: 'pending', attempts: (item.attempts || 0) + 1, lastError: 'http_' + response.status, updatedAt: Date.now() });
        retryableFailure = true;
      } else if (response.status >= 400 && response.status < 500) {
        await idbPut(db, { ...item, status: 'failed', attempts: (item.attempts || 0) + 1, lastError: 'http_' + response.status, updatedAt: Date.now() });
      } else {
        await idbPut(db, { ...item, status: 'pending', attempts: (item.attempts || 0) + 1, lastError: 'unexpected_response', updatedAt: Date.now() });
        retryableFailure = true;
      }
    } catch {
      await idbPut(db, { ...item, status: 'pending', attempts: (item.attempts || 0) + 1, lastError: 'network', updatedAt: Date.now() });
      retryableFailure = true;
    }
  }

  await postQueueStatus(db, { progressed: completed, deferred: deferredReplay });
  if (deferredReplay) await registerCheckInSync();
  db.close();
  if (retryableFailure) throw new Error('Guide check-in sync remains retryable');
}

self.addEventListener('message', function(event) {
  const message = event.data || {};
  if (message.type === 'GUIDE_AUTH_CONTEXT') {
    const work = migrateLegacyQueue().then(function() { return openDb(); }).then(async function(db) {
      const context = message.context;
      const generation = Number.isSafeInteger(message.generation) ? message.generation : 0;
      const validContext = context && typeof context.userId === 'string' && typeof context.businessId === 'string' && typeof context.accessToken === 'string'
        ? context
        : null;
      const applied = await idbApplyAuthContext(db, validContext, generation);
      if (applied && validContext) {
        await registerCheckInSync();
      }
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
  }
});

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

function idbDelete(db, id) {
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = function() { resolve(); };
    tx.onerror = function() { reject(tx.error); };
  });
}

function idbPut(db, item) {
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = function() { resolve(); };
    tx.onerror = function() { reject(tx.error); };
  });
}

function idbGetAuthState(db) {
  return new Promise(function(resolve, reject) {
    const req = db.transaction(AUTH_STORE, 'readonly').objectStore(AUTH_STORE).get(AUTH_KEY);
    req.onsuccess = function() { resolve(req.result || { generation: 0, context: null }); };
    req.onerror = function() { reject(req.error); };
  });
}

function idbApplyAuthContext(db, context, generation) {
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(AUTH_STORE, 'readwrite');
    const store = tx.objectStore(AUTH_STORE);
    const req = store.get(AUTH_KEY);
    let applied = false;
    req.onsuccess = function() {
      const current = req.result || { generation: 0, context: null };
      if (generation >= current.generation) {
        store.put({ generation: generation, context: context }, AUTH_KEY);
        applied = true;
      }
    };
    tx.oncomplete = function() { resolve(applied); };
    tx.onerror = function() { reject(tx.error); };
  });
}

function idbClearAuthIfGeneration(db, generation) {
  return new Promise(function(resolve, reject) {
    const tx = db.transaction(AUTH_STORE, 'readwrite');
    const store = tx.objectStore(AUTH_STORE);
    const req = store.get(AUTH_KEY);
    let cleared = false;
    req.onsuccess = function() {
      const current = req.result || { generation: 0, context: null };
      if (current.generation === generation) {
        store.put({ generation: generation, context: null }, AUTH_KEY);
        cleared = true;
      }
    };
    tx.oncomplete = function() { resolve(cleared); };
    tx.onerror = function() { reject(tx.error); };
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
    const quarantined = { ...legacyItem, status: 'blocked_legacy', lastError: 'missing_owner', updatedAt: Date.now() };
    delete quarantined.token;
    await idbPut(db, quarantined);
    await idbPut(legacyDb, quarantined);
  }
  db.close();
  legacyDb.close();
}

async function registerCheckInSync() {
  if (self.registration && self.registration.sync && self.registration.sync.register) {
    try { await self.registration.sync.register(SYNC_TAG); } catch {}
  }
}

async function postQueueStatus(db, outcome) {
  const items = await idbGetAll(db);
  const counts = { pending: 0, needsReauth: 0, failed: 0, blocked: 0 };
  items.forEach(function(item) {
    if (item.status === 'needs_reauth') counts.needsReauth += 1;
    else if (item.status === 'failed') counts.failed += 1;
    else if (item.status === 'blocked_account' || item.status === 'blocked_legacy') counts.blocked += 1;
    else counts.pending += 1;
  });
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach(function(client) {
    client.postMessage({
      type: 'GUIDE_QUEUE_STATUS',
      counts: counts,
      progressed: outcome && outcome.progressed ? outcome.progressed : 0,
      deferred: !!(outcome && outcome.deferred),
    });
  });
}
