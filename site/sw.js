/* Hi8ctane service worker: only for push. It shows the alerts and crew messages the server sends,
   and opens the right page when one is tapped. It doesn't cache anything: the site works as before. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

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
