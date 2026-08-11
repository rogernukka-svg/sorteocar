const CACHE_NAME = 'mino-goup-pwa-v6';
const ASSETS = [
  '/pwa/',
  '/pwa/index.html',
  '/pwa/styles.css',
  '/pwa/app.js',
  '/pwa/manifest.webmanifest',
  '/assets/logo.png',
  '/assets/mino.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});
