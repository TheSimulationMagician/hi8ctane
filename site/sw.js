/* Hi8ctane service worker. Push: it shows the alerts and crew messages the server sends, and opens the right
   page when one is tapped. Offline (2.32): it keeps a copy of the site's own files (pages, scripts, styles, fonts,
   icons) so the app still opens with a weak signal at the beach. Always the network first: a fresh deploy is
   used as soon as the phone can fetch it; the copy is only used when the network fails or takes over 4 s.
   Nothing from Supabase or the forecast passes through here (other sites): the app keeps those itself. */
var SHELL = 'hi8-shell-v1';
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('hi8-shell-') === 0 && k !== SHELL; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
function mine(req) {
  if (req.method !== 'GET') return false;
  var u = new URL(req.url);
  if (u.origin !== self.location.origin) return false;
  if (/\/(rest|functions|storage|auth)\//.test(u.pathname)) return false;
  return req.mode === 'navigate' || /\.(js|css|woff2?|png|svg|webmanifest|ico)$/.test(u.pathname);
}
self.addEventListener('fetch', function (e) {
  var req = e.request; if (!mine(req)) return;
  var key = req.mode === 'navigate' ? new URL(req.url).pathname : req.url;
  e.respondWith(new Promise(function (resolve) {
    var done = false, finish = function (r) { if (!done && r) { done = true; resolve(r); } };
    var fromCache = function () { return caches.open(SHELL).then(function (c) { return c.match(key, { ignoreSearch: req.mode === 'navigate' }); }); };
    var slow = setTimeout(function () { fromCache().then(finish); }, 4000);
    fetch(req).then(function (r) {
      clearTimeout(slow);
      if (r && r.ok && r.type === 'basic') { var copy = r.clone(); caches.open(SHELL).then(function (c) { c.put(key, copy); }); }
      finish(r);
    }).catch(function () {
      clearTimeout(slow);
      fromCache().then(function (r) { finish(r || Response.error()); });
    });
  }));
});

self.addEventListener('push', function (e) {
  var m = {};
  try { m = e.data ? e.data.json() : {}; } catch (x) { m = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(m.title || 'Hi8ctane', {
    body: m.body || '', icon: 'icon-192.png', badge: 'badge-72.png', tag: m.tag || undefined, renotify: !!m.tag,
    data: { url: m.url || self.registration.scope }
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || self.registration.scope, self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (wins) {
    for (var i = 0; i < wins.length; i++) {
      var w = wins[i];
      if (w.url.indexOf(self.registration.scope) === 0 && 'focus' in w) {
        return (w.navigate ? w.navigate(url).catch(function () { return w; }) : Promise.resolve(w)).then(function (x) { return (x || w).focus(); });
      }
    }
    return self.clients.openWindow(url);
  }));
});
