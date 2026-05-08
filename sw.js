// Mission Control — Service Worker
const CACHE = 'mission-control-v5';
const EDITOR_URLS = [
  'https://cdn.jsdelivr.net/npm/@editorjs/editorjs@2.30.6',
  'https://cdn.jsdelivr.net/npm/@editorjs/header@2.8.1',
  'https://cdn.jsdelivr.net/npm/@editorjs/list@2.0.6',
  'https://cdn.jsdelivr.net/npm/@editorjs/checklist@1.6.0',
  'https://cdn.jsdelivr.net/npm/@editorjs/table@2.4.2',
  'https://cdn.jsdelivr.net/npm/@editorjs/quote@2.7.4',
  'https://cdn.jsdelivr.net/npm/@editorjs/code@2.9.3',
  'https://cdn.jsdelivr.net/npm/@editorjs/inline-code@1.5.1',
  'https://cdn.jsdelivr.net/npm/@editorjs/marker@1.4.0',
  'https://cdn.jsdelivr.net/npm/@editorjs/underline@1.2.1'
];
const ASSETS = [
  './elastik-board.html',
  './manifest.json',
  './icon.svg',
  './icon-maskable.svg',
  ...EDITOR_URLS
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
  // EditorJS CDN: cache-first (precached at install), fall back to network
  if (EDITOR_URLS.includes(url.href)) {
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
