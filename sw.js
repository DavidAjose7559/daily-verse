/*const CACHE = 'dv-v1';
const ASSETS = [
  '/daily-verse/',
  '/daily-verse/index.html',
  '/daily-verse/archive.html',
  '/daily-verse/style.css',
  '/daily-verse/DA.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  // network-first for API, cache-first for static
  if (request.url.includes('/api/')) {
    e.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
  } else {
    e.respondWith(
      caches.match(request).then(r => r || fetch(request))
    );
  }
});
*/

// sw.js — kill-switch while you're developing

// Install immediately
self.addEventListener('install', event => {
  self.skipWaiting();
});

// On activate: delete all caches, then unregister this service worker
self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k)));
      } catch (e) {
        // ignore
      }
      await self.registration.unregister();
    })()
  );
});

// Let all requests go straight to the network
self.addEventListener('fetch', event => {
  // do nothing: default browser behavior (no caching here)
});

