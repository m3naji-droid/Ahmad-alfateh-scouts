/* network-first: الموقع يتحدث دائماً عند وجود اتصال، ويعمل من النسخة المخزنة عند انقطاعه */
var C = "afs-v2";
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) { return Promise.all(ks.filter(function (k) { return k !== C; }).map(function (k) { return caches.delete(k); })); }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var r = e.request;
  if (r.method !== "GET" || new URL(r.url).origin !== location.origin) return;
  e.respondWith(fetch(r).then(function (res) {
    var cp = res.clone(); caches.open(C).then(function (c) { c.put(r, cp); }); return res;
  }).catch(function () { return caches.match(r).then(function (m) { return m || caches.match("./"); }); }));
});

/* Web Push */
self.addEventListener("push", function (e) {
  var d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) {}
  e.waitUntil(self.registration.showNotification(d.title || "فرقة أحمد الفاتح", { body: d.body || "", icon: "icon-192.png", badge: "icon-192.png", tag: d.tag || undefined, dir: "rtl", lang: "ar", data: { url: d.url || "./" } }));
});
self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var u = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (l) {
    for (var i = 0; i < l.length; i++) { var c = l[i]; if ("focus" in c) { return c.focus().then(function (w) { return (w || c).navigate ? (w || c).navigate(u).catch(function () {}) : null; }); } }
    return self.clients.openWindow(u);
  }));
});
