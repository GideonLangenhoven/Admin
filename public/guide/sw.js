var CACHE_NAME = 'guide-v1';
var PRECACHE = ['/guide', '/guide/manifest.webmanifest'];

self.addEventListener('install', function(event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function(c) { return c.addAll(PRECACHE); }).catch(function() {}));
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);
  if (!url.pathname.startsWith('/guide')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then(function(res) {
        var copy = res.clone();
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
    var chain = Promise.resolve();
    all.forEach(function(item) {
      chain = chain.then(function() {
        return fetch('/api/guide/check-in', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(item.payload),
          credentials: 'include',
        }).then(function(r) {
          if (r.ok) return openDb().then(function(db) { return idbDelete(db, item.id); });
        }).catch(function() {});
      });
    });
    return chain;
  });
}

var DB_NAME = 'guide-queue';
var STORE = 'check-ins';

function openDb() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = function(e) { e.target.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = function(e) { resolve(e.target.result); };
    req.onerror = function(e) { reject(e); };
  });
}

function idbGetAll(db) {
  return new Promise(function(resolve) {
    var tx = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    tx.onsuccess = function() { resolve(tx.result || []); };
  });
}

function idbDelete(db, id) {
  return new Promise(function(resolve) {
    db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id).onsuccess = resolve;
  });
}
