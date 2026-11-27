/* Hi8ctane iPhone app: the bridge between the site (bundled in the app) and iOS. Loaded only in the app's copy of
 * the page (scripts/web.sh), after app.js. On the website it is never loaded.
 *   - links from emails and messages (hi8ctane.com/?c=…, the sign-in link) open here, on the same screen
 *   - native push: asked for after your first I'M IN, not at launch; the device token goes to the database
 *   - the buttons on a notification (I'M IN · A SEAT, NOT NOW, STILL IN, ON / MEH / OFF) answer without opening a form
 *   - the spot report's location check uses iOS's own permission prompt
 */
(function () {
  var C = window.Capacitor; if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var P = C.Plugins || {}, App = P.App, Push = P.PushNotifications, Geo = P.Geolocation, Bar = P.StatusBar;
  var N = window.HI8_NATIVE = { app: true, platform: C.getPlatform() };
  document.documentElement.classList.add('in-app');
  if (Bar && Bar.setStyle) Bar.setStyle({ style: 'DARK' }).catch(function () {});

  // links that open the app: keep the query and the hash, load them in the app's own page
  function openUrl(url) {
    try {
      var u = new URL(url);
      if (!/(^|\.)hi8ctane\.com$/.test(u.hostname)) return;
      var here = location.pathname.replace(/[^/]*$/, '') + 'index.html';
      location.href = here + u.search + u.hash;
    } catch (e) { /* not a link we know */ }
  }
  if (App) App.addListener('appUrlOpen', function (e) { if (e && e.url) openUrl(e.url); });

  // geolocation: the site calls navigator.geolocation; in the app, iOS asks once with our own words (Info.plist)
  if (Geo && navigator.geolocation) {
    navigator.geolocation.getCurrentPosition = function (ok, fail, opts) {
      Geo.getCurrentPosition({ enableHighAccuracy: !!(opts && opts.enableHighAccuracy), timeout: (opts && opts.timeout) || 12000, maximumAge: (opts && opts.maximumAge) || 0 })
        .then(function (p) { ok({ coords: p.coords, timestamp: p.timestamp }); }, function (e) { if (fail) fail({ code: 1, message: String(e && e.message || e) }); });
    };
  }

  // native push. The device token is saved with the rider's key (hi8_push_native, migration 0031).
  function key() { try { return (JSON.parse(localStorage.getItem('hi8.me') || '{}') || {}).key || null; } catch (e) { return null; } }
  function saveToken(t) {
    N.token = t;
    try { localStorage.setItem('hi8.apns', JSON.stringify(t)); } catch (e) {}
    if (key() && window.HI8 && HI8.rpc) HI8.rpc('hi8_push_native', { p_key: key(), p_token: t, p_platform: 'ios' }).catch(function () {});
  }
  N.pushState = function () { return Push ? Push.checkPermissions().then(function (r) { return r.receive; }) : Promise.resolve('denied'); };
  N.pushOn = function () {
    if (!Push) return Promise.reject(new Error('no_push'));
    return Push.requestPermissions().then(function (r) { if (r.receive !== 'granted') throw new Error('denied'); return Push.register(); });
  };
  if (Push) {
    Push.addListener('registration', function (t) { saveToken(t.value); });
    Push.addListener('registrationError', function () { N.token = null; });
    // a tap on the notification or on one of its buttons
    Push.addListener('pushNotificationActionPerformed', function (a) {
      var d = (a && a.notification && a.notification.data) || {}, act = a && a.actionId;
      if (act && act !== 'tap' && window.HI8 && HI8.rpc && key()) {
        HI8.rpc('hi8_push_answer', { p_key: key(), p_ref: d.ref || null, p_answer: act }).then(function (r) {
          if (r && r.url) openUrl(r.url); else if (d.url) openUrl(d.url);
        }, function () { if (d.url) openUrl(d.url); });
        return;
      }
      if (d.url) openUrl(d.url);
    });
    // already allowed: register again at each start (tokens can change)
    var off = false; try { off = JSON.parse(localStorage.getItem('hi8.pushOff') || 'false'); } catch (e) {}
    N.pushState().then(function (s) { if (s === 'granted' && !off) Push.register(); });   // turned off in the app: stay off
  }
})();
