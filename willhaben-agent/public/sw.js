/* willhaben agent — service worker.
   Its only job is receiving push messages; the app itself is always online
   anyway (it talks to your own server), so there is no offline cache here. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'willhaben agent', body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'New on willhaben';
  const options = {
    body: data.body || '',
    // A stable tag per advert means a re-delivered push replaces rather than
    // duplicates the notification.
    tag: data.tag || 'willhaben',
    data: { url: data.url || '/' },
    icon: 'icon.svg',
    badge: 'icon.svg',
    image: data.image || undefined,
    timestamp: data.ts || Date.now(),
    requireInteraction: false,
    renotify: true,
    vibrate: [40, 60, 40]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Reuse a tab that already has the advert open rather than stacking tabs.
      for (const client of clients) {
        if (client.url === target && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow(target);
    })
  );
});
