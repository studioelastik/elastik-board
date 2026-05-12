// Mission Control — Service Worker
const CACHE = 'mission-control-v34';
// Only same-origin assets are precached. CDN scripts (EditorJS etc.) are
// fetched fresh each load — precaching them is fragile (one 404 breaks the
// whole install) and the editor scripts are small enough to load on demand.
const ASSETS = [
  './elastik-board.html',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // All cross-origin (CDN scripts, Firebase, Google APIs, fonts): bypass SW
  if (url.origin !== self.location.origin) return;
  // Same-origin: network first, fall back to cache when offline
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
