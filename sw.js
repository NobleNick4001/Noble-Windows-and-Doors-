// Offline support: network-first (so edited JSON/rates show up immediately), cache fallback when offline.
const CACHE = 'nwd-sales-v10';
const PRECACHE = ['./', 'index.html', 'manifest.webmanifest', 'css/styles.css', 'js/app.js', 'js/core.js', 'js/frames.js',
  'js/pages/calculator.js', 'js/pages/estimate.js', 'js/pages/options.js', 'js/pages/gallery.js', 'js/pages/overlay.js', 'js/pages/settings.js', 'js/pages/obscure.js', 'js/pages/frame-types.js',
  'data/rates.json', 'data/options.json', 'data/install.json', 'data/settings.default.json', 'data/obscure-glass.json', 'data/frame-types.json', 'assets/gallery/gallery.json',
  'assets/noble-logo-trim.png', 'assets/icon-192.png', 'assets/icon-512.png',
  'assets/gallery/placeholder-1.svg', 'assets/gallery/placeholder-2.svg', 'assets/gallery/placeholder-3.svg', 'assets/gallery/placeholder-4.svg',
  'assets/obscure/cascade.png', 'assets/obscure/fern.png', 'assets/obscure/obscure.png', 'assets/obscure/reed.png', 'assets/obscure/satin-etch.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
    .catch(() => caches.match(req).then((m) => m || caches.match('index.html'))));
});
