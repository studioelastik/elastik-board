// Mission Control — Service Worker
const CACHE = 'mission-control-v4';
const QUILL_URLS = [
  'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.snow.css',
  'https://cdn.jsdelivr.net/npm/quill@1.3.7/dist/quill.min.js'
];
const ASSETS = [
  './elastik-board.html',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg',
  ...QUILL_URLS
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
  // Quill CDN: cache-first (precached at install), fall back to network
  if (QUILL_URLS.includes(url.href)) {
    e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
    return;
  }
  // Other cross-origin (Firebase, Google APIs, fonts): bypass SW entirely
  if (url.origin !== self.location.origin) return;
  // Same-origin: network first, fall back to cache when offline
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
