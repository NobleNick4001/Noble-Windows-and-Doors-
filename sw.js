// Offline shell for iPad (Safari / Add to Home Screen).
// Network-first, then this versioned cache. A new CACHE name drops the old one on
// activate, so price files update the next time the iPad is online.
const CACHE = 'nwd-sales-v51-arch-top';
const PRECACHE = ['./', 'index.html', 'manifest.webmanifest', 'css/styles.css', 'js/app.js', 'js/core.js', 'js/milgard.js', 'js/cloud.js', 'js/frames.js', 'js/pdf.js', 'js/sign.js', 'js/vendor/jspdf.umd.min.js', 'js/vendor/pdf.min.mjs', 'js/vendor/pdf.worker.min.mjs',
  'js/pages/calculator.js', 'js/pages/milgard-ui.js', 'js/pages/estimate.js', 'js/pages/contract.js', 'js/pages/options.js', 'js/pages/gallery.js', 'js/pages/brochures.js', 'js/pages/overlay.js', 'js/pages/settings.js', 'js/pages/obscure.js', 'js/pages/frame-types.js', 'js/pages/auth.js', 'js/pages/admin.js',
  'data/rates.json', 'data/variable-rates.json', 'data/milgard-onelink.json', 'data/options.json', 'data/install.json', 'data/settings.default.json', 'data/obscure-glass.json', 'data/frame-types.json', 'data/promos.json', 'data/purchase-agreement.json', 'data/overlay/manifest.json', 'assets/gallery/gallery.json',
  'assets/noble-logo-trim.png', 'assets/noble-logo.jpg', 'assets/icon-192.png', 'assets/icon-512.png',
  'assets/obscure/cascade.png', 'assets/obscure/fern.png', 'assets/obscure/obscure.png', 'assets/obscure/reed.png', 'assets/obscure/satin-etch.png'];
// Gallery JPEGs are not precached (48 photos). The fetch handler below stores each one on first view.
// Brochure PDFs are not precached. The first open stores that one file for offline.
// PDF.js is precached so the in-app viewer can draw a saved brochure with no network.
// Overlay WebPs are read from the manifest so a replaced photo is cached without editing this list.
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(PRECACHE);
    try {
      const res = await fetch('data/overlay/manifest.json');
      const manifest = res.ok ? await res.json() : null;
      const files = (manifest?.assets || []).map((a) => a.file).filter(Boolean);
      await Promise.all(files.map((file) => c.add(file).catch(() => {})));
    } catch { /* a later visit stores each photo */ }
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
function brochureKey(url) {
  return url.origin + url.pathname;
}
function isBrochurePdf(url) {
  return /\/brochures\/[^/]+\.pdf$/i.test(url.pathname);
}
// Range responses (206) cannot be stored. Keep a full copy under a stable key, and
// still hand the viewer whatever the network returned so Safari can show the PDF.
async function brochurePdf(req) {
  const cache = await caches.open(CACHE);
  const url = new URL(req.url);
  const key = brochureKey(url);
  try {
    const res = await fetch(req);
    if (res.ok && res.status === 200) {
      await cache.put(key, res.clone());
      return res;
    }
    if (res.ok && res.status === 206) {
      fetch(key).then(async (full) => {
        if (full.ok && full.status === 200) {
          const c = await caches.open(CACHE);
          await c.put(key, full);
        }
      }).catch(() => {});
      return res;
    }
    const hit = await cache.match(key);
    if (hit) return hit;
    return res;
  } catch {
    const hit = await cache.match(key);
    if (hit) return hit;
    return new Response('This brochure is not on this iPad yet. Open it once while online.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}
self.addEventListener('fetch', (e) => {
  const req = e.request; if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (isBrochurePdf(new URL(req.url))) { e.respondWith(brochurePdf(req)); return; }
  e.respondWith(fetch(req).then((res) => { if (res.ok && res.status !== 206) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); } return res; })
    .catch(() => caches.match(req).then((m) => m || caches.match('index.html'))));
});
