// Offline shell + push. Bump VERSION whenever app files change.
const VERSION = "gemready-1.0.0";
const SHELL = [
  "./", "index.html", "app.css", "manifest.webmanifest",
  "js/main.js", "js/router.js", "js/ui.js", "js/state.js", "js/api.js", "js/capture.js", "js/push.js", "js/theme.js",
  "js/screens/scan.js", "js/screens/estimate.js", "js/screens/outcomes.js", "js/screens/collection.js", "js/screens/settings.js", "js/screens/onboarding.js",
  "shared/analysis.js", "shared/grading.js", "shared/outcomes.js", "shared/model.js",
  "icons/icon-192.png", "icons/icon-512.png", "legal/privacy.html", "legal/terms.html", "legal/licenses.html",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return; // API: always network
  if (url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((r) => {
      const copy = r.clone();
      caches.open(VERSION).then((c) => c.put(e.request, copy)).catch(() => {});
      return r;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data.json(); } catch { d = { title: "GemReady", body: e.data?.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || "GemReady", { body: d.body, icon: "icons/icon-192.png", data: { url: d.url || "./" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(e.notification.data?.url || "./"));
});
