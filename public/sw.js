// CrowdFeed service worker: app shell caching, offline access to saved
// rewards, and push notifications from venues.

const VERSION = 'crowdfeed-v1';
const SHELL = [
  '/',
  '/index.html',
  '/css/app.css',
  '/js/app.js',
  '/js/api.js',
  '/js/store.js',
  '/js/icons.js',
  '/js/widgets.js',
  '/js/qr.js',
  '/js/scanner.js',
  '/js/pwa.js',
  '/vendor/qrcode-generator.js',
  '/vendor/jsqr.js',
  '/manifest.webmanifest',
  '/icons/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/404.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return; // live data only

  // App navigations: try the network, fall back to the cached shell so the
  // app opens offline (saved rewards still work).
  if (req.mode === 'navigate') {
    const isShellRoute = !url.pathname.startsWith('/admin') && !url.pathname.startsWith('/scan');
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (isShellRoute && res.ok) caches.open(VERSION).then((c) => c.put('/index.html', res.clone()));
          return res;
        })
        .catch(() => caches.match(isShellRoute ? '/index.html' : req))
    );
    return;
  }

  // Static assets: cached copy first, refreshed in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res.ok) caches.open(VERSION).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'CrowdFeed', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'CrowdFeed';
  const options = {
    body: data.body || 'A venue near you is offering a reward for your feedback.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || 'crowdfeed',
    renotify: true,
    data: { url: data.url || '/', venue: data.venue || null }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  // The browser rotated the subscription; the app re-subscribes next time it opens.
  event.waitUntil(Promise.resolve());
});
