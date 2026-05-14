"use strict";

const CACHE = "image-mirror-v1";
const SHELL = ["./", "index.html", "app.js", "manifest.json", "icon-192.png", "icon-512.png"];
const LAST_IMAGE_KEY = "last-image";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Never intercept the live event stream.
  if (url.pathname.endsWith("/events")) return;

  // The current image: network-first, but keep the last copy so a reopened
  // PWA shows something instead of a blank screen while offline.
  if (url.pathname.endsWith("/current")) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(LAST_IMAGE_KEY, copy));
          }
          return response;
        })
        .catch(() =>
          caches.match(LAST_IMAGE_KEY).then((cached) => cached || new Response("", { status: 204 }))
        )
    );
    return;
  }

  // App shell: cache-first.
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
