const CACHE = 'dv-v1';
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
