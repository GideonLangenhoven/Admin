const CACHE_NAME = 'guide-v2';
const PRECACHE = ['/guide', '/guide/manifest.webmanifest'];

self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function(c) { return c.addAll(PRECACHE); }).catch(function() {}));
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
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
  if (event.tag === 'sync-check-ins') {
    event.waitUntil(syncCheckIns());
  }
});

function syncCheckIns() {
  return openDb().then(function(db) {
    return idbGetAll(db);
  }).then(function(all) {
    let chain = Promise.resolve();
    all.forEach(function(item) {
      chain = chain.then(function() {
        var headers = { 'Content-Type': 'application/json' };
        if (item.token) headers['Authorization'] = 'Bearer ' + item.token;
        return fetch('/api/guide/check-in', {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(item.payload),
          credentials: 'include',
        }).then(function(r) {
          // Drop on success or non-retryable client error (e.g. expired token) so we don't loop forever.
          if (r.ok || (r.status >= 400 && r.status < 500)) {
            return openDb().then(function(db) { return idbDelete(db, item.id); });
          }
        }).catch(function() {});
      });
    });
    return chain;
  });
}

const DB_NAME = 'guide-queue';
const STORE = 'check-ins';

function openDb() {
  return new Promise(function(resolve, reject) {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function(e) { e.target.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror = function(e) { reject(e); };
  });
}

function idbGetAll(db) {
  return new Promise(function(resolve) {
    const tx = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    tx.onsuccess = function() { resolve(tx.result || []); };
  });
}

function idbDelete(db, id) {
  return new Promise(function(resolve) {
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id).onsuccess = resolve;
  });
}
