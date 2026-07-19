const CACHE = 'ripreport-v9';
const ASSETS = ['./', './index.html', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
  './icons/maskable-512.png', './icons/apple-touch-180.png'];
// Backend reads must never be cached or shell-fallbacked — live prices and
// catalog would freeze at their first response.
const API_PREFIXES = ['/health', '/cards', '/sets', '/products', '/card/',
  '/search', '/price/', '/recognize', '/auth/', '/me', '/holdings'];
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(
    ks.filter(k => k !== CACHE).map(k => caches.delete(k))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const isApi = url.origin === location.origin &&
    API_PREFIXES.some(p => url.pathname === p || url.pathname.startsWith(p));
  if (isApi) return; // straight to network — no cache, no fallback
  if (e.request.mode === 'navigate') {
    // Page loads: network first so deploys show up; shell only when offline.
    e.respondWith(fetch(e.request).catch(() => caches.match('./index.html')));
    return;
  }
  // Static assets (incl. card images): cache-first for speed + offline.
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok || res.type === 'opaque') {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
      }
      return res;
    }))
  );
});
