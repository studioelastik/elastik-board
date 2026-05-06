// Mission Control — Service Worker
const CACHE = 'mission-control-v1';
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
  // Bypass SW entirely for cross-origin requests (Firebase, Google APIs, fonts)
  // — EventSource (live sync) and POST/PUT must hit the network directly.
  if (url.origin !== self.location.origin) return;
  // Same-origin: network first, fall back to cache when offline
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
