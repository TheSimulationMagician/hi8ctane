/*
 * Hi8ctane live sign-ups (live.js)
 *
 * Makes the sign-up screens real without changing how they look:
 *   - Get In (B27-Join): saves the email to Supabase, hands out the real next founding plate
 *   - Onboarding (B27-Onboard): saves rider name, sports and levels, hub, how far, getting there
 *   - Founding Night (B27-Night): a real RSVP with real counts, a real calendar file and share link
 *   - A new city (B27-City): "I'm in" and "I'll captain" saved, real counts, a working share link
 *   - Schools + rental shops (B27-Schools): the form is saved as well as opening an email
 *   - Landing and web page: remember the hub and sport someone picked, so they don't pick twice
 *
 * It talks to Supabase with the publishable key from config.js, through the hi8_* functions in
 * supabase/migrations/0002_live_signups.sql. Without a URL and key in config.js it does nothing.
 * The screens stay as designed; this file only extends their Component classes (see support.js).
 */
(function () {
  'use strict';

  var H = window.HI8;
  if (!H || !H.live) return; // no Supabase key in config.js: change nothing
  var CFG = H.cfg, API = H.api, KEY = H.key;

  var SCREEN = H.screen;
  var PARAMS = H.params;
  var EVENT = H.EVENT;
  var SP = H.SPORTS;
  var CITY_NAMES = { amsterdam: 'Amsterdam', barcelona: 'Barcelona', lisbon: 'Lisbon', tarifa: 'Tarifa', berlin: 'Berlin' };
  var AMS_HUBS = { // the four Amsterdam pickup hubs on the onboarding screen
    west: { n: 'SLOTERDIJK', lat: 52.3889, lon: 4.8378 },
    cs: { n: 'CENTRAAL', lat: 52.3791, lon: 4.9003 },
    zuid: { n: "A'DAM ZUID", lat: 52.3389, lon: 4.8730 },
    hlm: { n: 'HAARLEM', lat: 52.3874, lon: 4.6383 }
  };
  var NIGHT_SESSIONS = ['kite-wing', 'sup-surf', 'mtb']; // in the order the Night screen lists them
  var NIGHT_HUBS = { 'SANTS': 'sants', 'GRÀCIA': 'gracia', 'LA SAGRERA': 'sagrera' };
  var NIGHT_CAP = 150;
  var NEW_CITIES = { lis: 'lisbon', tar: 'tarifa', ber: 'berlin' }; // the City screen's tabs
  var CAPTAIN_DAYS = { wed: 'weekdays', fri: 'fri', sat: 'sat', sun: 'sun' };
  var noop = function () {};

  // the shared pieces live in hi8.js
  var store = H.store, me = H.me, rpc = H.rpc, timeout = H.timeout, unreachable = H.unreachable;
  var later = H.later, withKey = H.withKey, saveMe = H.saveMe, ready = H.ready;
  var counts = H.counts;
  function loadCounts() { return H.loadCounts().then(function (c) { counts = c; return c; }); }
  function refreshOn(cmp) { H.watch(cmp); loadCounts().then(function () { cmp.forceUpdate(); }, noop); }
  H.onData(function () { counts = H.counts; });

  // ---------------------------------------------------------------- small helpers
  function root() { return document.getElementById('dc-root') || document.body; }
  function pad3(n) { return ('00' + n).slice(-3); }
  function abs(p) { return new URL(p, location.href).href; }
  function knownCity(c) { return Object.prototype.hasOwnProperty.call(CITY_NAMES, c) ? c : null; }
  function leafWithText(re) {
    var els = root().querySelectorAll('div, span, b, p');
    for (var i = 0; i < els.length; i++) if (!els[i].firstElementChild && re.test(els[i].textContent)) return els[i];
    return null;
  }
  function nativeHint(inp, msg) {
    if (!inp) return;
    inp.setCustomValidity(msg);
    inp.reportValidity();
    inp.focus();
    inp.addEventListener('input', function clear() { inp.setCustomValidity(''); inp.removeEventListener('input', clear); });
  }
  function share(url, title, text, done) {
    if (navigator.share) { navigator.share({ title: title, text: text, url: url }).then(done, noop); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(url).then(done, done); return; }
    done();
  }
  function sameJSON(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  // gmial.com, hotmal.com, gmail.con: one letter off a common email domain
  var DOMAINS = ['gmail.com', 'hotmail.com', 'outlook.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'protonmail.com', 'proton.me',
    'hotmail.nl', 'live.nl', 'outlook.nl', 'ziggo.nl', 'kpnmail.nl', 'planet.nl', 'xs4all.nl', 'gmx.de', 'web.de', 't-online.de', 'hotmail.es', 'yahoo.es', 'sapo.pt'];
  function oneOff(a, b) { // optimal string alignment distance <= 1
    if (a === b || Math.abs(a.length - b.length) > 1) return false;
    var i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1) || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
    return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
  }
  function emailTypo(email) {
    var at = email.lastIndexOf('@'), d = email.slice(at + 1).toLowerCase();
    if (at < 1 || DOMAINS.indexOf(d) >= 0) return null;
    for (var i = 0; i < DOMAINS.length; i++) if (oneOff(d, DOMAINS[i])) return email.slice(0, at + 1) + DOMAINS[i];
    return null;
  }

  // ================================================================ the screens
  var SCREENS = {};

  // ---- landing (phone) and web page: remember the hub and sport someone picked ----
  function rememberPicks(C) {
    return class extends C {
      constructor(props) {
        super(props);
        var pick = store.get('pick', null) || {};
        if (pick.city === 'barcelona') this.state.hub = 'bcn';
        else if (AMS_HUBS[pick.hub]) this.state.hub = pick.hub;
        if (pick.sport && SP.indexOf(pick.sport) >= 0) this.state.sp = pick.sport;
        if ('max' in this.state && [30, 60, 90].indexOf(pick.max) >= 0) this.state.max = pick.max; // the web page only
        this.hi8Was = { hub: this.state.hub, sp: this.state.sp, max: this.state.max };
      }
      componentDidUpdate() {
        if (super.componentDidUpdate) super.componentDidUpdate();
        var st = this.state, now = { hub: st.hub, sp: st.sp, max: st.max };
        if (sameJSON(now, this.hi8Was)) return;
        this.hi8Was = now;
        store.set('pick', {
          city: st.hub === 'bcn' ? 'barcelona' : 'amsterdam',
          hub: AMS_HUBS[st.hub] ? st.hub : null,
          sport: SP.indexOf(st.sp) >= 0 ? st.sp : null,
          max: [30, 60, 90].indexOf(st.max) >= 0 ? st.max : (store.get('pick', null) || {}).max || null
        });
      }
    };
  }
  SCREENS['B27-Landing'] = rememberPicks;
  SCREENS['B27-Web'] = rememberPicks;

  // ---- Get In ----
  function joinCity() {
    return knownCity(PARAMS.get('city')) || (store.get('pick', null) || {}).city || 'amsterdam';
  }
  function nextAfterJoin() {
    var n = PARAMS.get('next'), c = PARAMS.get('c');
    if (n === 'night') return 'B27-Night.dc.html?from=join';
    if (n === 'city' && NEW_CITIES[c]) return 'B27-City.dc.html?c=' + c + '&from=join';
    if (n === 'crew' && /^[A-Za-z0-9]{6}$/.test(c || '')) return 'B27-Crew.dc.html?c=' + c.toUpperCase() + '&from=join';
    return 'B27-Onboard.dc.html';
  }
  function sendEmailLink(email) {
    return fetch(API + '/auth/v1/otp?redirect_to=' + encodeURIComponent(abs('B27-Onboard.dc.html')), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': KEY },
      body: JSON.stringify({ email: email, create_user: true })
    });
  }
  SCREENS['B27-Join'] = function (C) {
    return class extends C {
      componentDidMount() {
        if (super.componentDidMount) super.componentDidMount();
        var self = this, r = root();
        r.addEventListener('click', function (e) {
          var a = e.target.closest ? e.target.closest('a.big') : null;
          if (!a) return;
          var t = a.textContent.toUpperCase();
          if (t.indexOf('EMAIL ME') >= 0) { e.preventDefault(); self.hi8Submit(a); }
          else if (t.indexOf('GOOGLE') >= 0) { e.preventDefault(); self.hi8Google(); }
        }, true);
        r.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && e.target && e.target.id === 'em') {
            e.preventDefault();
            var links = r.querySelectorAll('a.big');
            self.hi8Submit(links[links.length - 1]);
          }
        });
        refreshOn(this);
        this.hi8Sticker();
      }
      componentDidUpdate() {
        if (super.componentDidUpdate) super.componentDidUpdate();
        this.hi8Sticker();
      }
      // "You'll get founding plate #038 in Amsterdam" with the real next plate and city
      hi8Sticker() {
        var el = this.hi8StickerEl && this.hi8StickerEl.isConnected ? this.hi8StickerEl : leafWithText(/founding plate/i);
        if (!el) return;
        this.hi8StickerEl = el;
        var city = joinCity(), name = CITY_NAMES[city], mine = (me().plates || {})[city];
        var cc = counts && counts.cities && counts.cities[city], want;
        if (mine) want = 'Your founding plate: #' + pad3(mine) + ' in ' + name;
        else if (cc && cc.next_plate) want = "You'll get founding plate #" + pad3(cc.next_plate) + ' in ' + name;
        else if (cc) want = 'Founding plates in ' + name + " are gone: you'll be on the list";
        else want = "You'll get a founding plate in " + name;
        if (el.textContent !== want) el.textContent = want;
        // the yellow plate in the header shows the same number
        if (!this.hi8Badge || !this.hi8Badge.isConnected) {
          var ts = root().querySelectorAll('svg text');
          for (var i = 0; i < ts.length; i++) if (ts[i].textContent === '38') { this.hi8Badge = ts[i]; break; }
        }
        var n = mine || (cc && cc.next_plate) || '';
        if (this.hi8Badge && this.hi8Badge.textContent !== String(n)) this.hi8Badge.textContent = String(n);
      }
      hi8Submit(btn) {
        if (this.hi8Busy) return;
        var self = this, inp = document.getElementById('em'), email = inp ? inp.value.trim() : '';
        if (inp) inp.setCustomValidity('');
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
          nativeHint(inp, email ? "That email doesn't look right." : 'Type your email first.');
          return;
        }
        var fix = emailTypo(email);
        if (fix && this.hi8Warned !== email) {
          this.hi8Warned = email; // asked once: pressing again keeps it as typed
          nativeHint(inp, 'Did you mean ' + fix + '? Fix it, or press again to keep it.');
          return;
        }
        this.hi8Busy = true;
        var label = btn ? btn.lastChild : null, was = label ? label.nodeValue : null;
        if (label && label.nodeType === 3) label.nodeValue = 'ONE SEC…';
        if (btn) btn.setAttribute('aria-busy', 'true');
        var src = store.get('src', null) || {};
        var args = { p_email: email, p_city: joinCity(), p_source: src.source || null, p_ref: src.ref || null };
        timeout(rpc('hi8_join', args), 8000).then(function (out) {
          saveMe(out);
          if (CFG.emailLink) {
            store.set('after', { city: args.p_city, next: nextAfterJoin(), at: Date.now() });
            return timeout(sendEmailLink(email), 4000).catch(noop);
          }
          return null;
        }, function (e) {
          // only a bad email or too many tries stop them; anything else (no connection, Supabase down or
          // not set up yet) keeps the sign-up in this browser and sends it again on the next page
          if (e.status === 400 || e.status === 429) throw e;
          later('hi8_join', args);
          return null;
        }).then(function () {
          location.href = nextAfterJoin();
        }, function (e) {
          self.hi8Busy = false;
          if (label && label.nodeType === 3) label.nodeValue = was;
          if (btn) btn.removeAttribute('aria-busy');
          nativeHint(inp, e.status === 429 ? 'Too many tries from here. Wait a few minutes.' : (e.hint || 'That didn\'t work. Try again.'));
        });
      }
      hi8Google() {
        if (CFG.google) {
          store.set('after', { city: joinCity(), next: nextAfterJoin(), at: Date.now() });
          location.href = API + '/auth/v1/authorize?provider=google&redirect_to=' + encodeURIComponent(abs('B27-Onboard.dc.html'));
          return;
        }
        nativeHint(document.getElementById('em'), 'Google sign-in is coming soon. Use your email for now.');
      }
    };
  };

  // ---- onboarding ----
  function profileOf(st, final) {
    var picked = SP.filter(function (s) { return st.on[s]; }), lv = {};
    picked.forEach(function (s) { lv[s] = st.lvl[s]; });
    var home = me().city || 'amsterdam';
    var a = { p_name: (st.name || '').trim() || null, p_sports: picked, p_levels: lv };
    if (final) {
      a.p_city = home;
      a.p_hub = H.hubsOf(home).some(function (h) { return h.slug === st.hub; }) ? st.hub : null; // a hub of the rider's own city
      a.p_max_min = st.max;
      a.p_getting_there = st.mode;
    }
    return a;
  }
  function km(a, b) {
    var R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  }
  SCREENS['B27-Onboard'] = function (C) {
    return class extends C {
      constructor(props) {
        super(props);
        // start blank (the design's sample rider is "Frankie"), or from what this person already chose
        var p = me().profile || {}, pick = store.get('pick', null) || {}, on = {}, home = me().city || pick.city || 'amsterdam';
        var homeHubs = H.hubsOf(home).map(function (h) { return h.slug; });
        (p.sports && p.sports.length ? p.sports : (pick.sport ? [pick.sport] : [])).forEach(function (s) { on[s] = true; });
        Object.assign(this.state, {
          name: p.name || '',
          on: on,
          lvl: Object.assign({}, this.state.lvl, p.levels || {}),
          hub: homeHubs.indexOf(p.hub) >= 0 ? p.hub : (homeHubs.indexOf(pick.hub) >= 0 ? pick.hub : (homeHubs[0] && home !== 'amsterdam' ? homeHubs[0] : this.state.hub)),
          max: p.max || ([30, 60, 90].indexOf(pick.max) >= 0 ? pick.max : this.state.max),
          mode: p.mode || this.state.mode
        });
        this.hi8Loc = null;
      }
      renderVals() {
        var self = this, st = this.state, home = me().city || (store.get('pick', null) || {}).city || 'amsterdam';
        var hubs = H.hubsOf(home), other = home !== 'amsterdam';
        // the design's own matches box only knows Amsterdam's hubs: draw it with one, then fill in the real ones
        if (other) this.state = Object.assign({}, st, { hub: 'west' });
        var v;
        try { v = super.renderVals(); } finally { this.state = st; }
        var picked = SP.filter(function (s) { return st.on[s]; });
        var hubObj = hubs.filter(function (h) { return h.slug === st.hub; })[0] || hubs[0] || null;
        var hubName = hubObj ? hubObj.name.charAt(0) + hubObj.name.slice(1).toLowerCase() : '';
        if (other && hubs.length) {
          v.hubs = hubs.map(function (h) {
            var on = st.hub === h.slug;
            return { t: h.name, sub: h.sub, on: on ? 'true' : 'false', go: function () { self.setState({ hub: h.slug, loc: false }); },
              s: 'height:56px;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:3px;padding:0 10px;text-align:left;border:2px solid #111111;cursor:pointer;' + (on ? 'background:#111111;color:#C8FF3D;box-shadow:3px 3px 0 #FF2D78' : 'background:#FFFFFF;color:#111111') };
          });
          if (st.mode === 'seat') v.modeT = 'We show crews with a free seat leaving from ' + hubName + ', with the smallest detour.';
        }
        // the real crews that match: sport, level, and close enough to the hub
        var WDS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], tz = home === 'barcelona' ? 'Europe/Madrid' : 'Europe/Amsterdam';
        var dayN = function (d) { for (var i = 0; i < 2; i++) if (new Date(Date.now() + i * 864e5).toLocaleDateString('en-CA', { timeZone: tz }) === d) return i ? 'TMRW' : 'TODAY'; var x = new Date(d + 'T12:00:00Z'); return WDS[x.getUTCDay()] + ' ' + x.getUTCDate(); };
        var shown = [], lvlOut = 0, farOut = 0;
        (H.crews || []).filter(function (c) { return c.status === 'on' && !c.past && c.city === home && st.on[c.sport]; }).forEach(function (c) {
          var spot = H.spot(c.spot), min = hubObj && spot ? H.driveMin(hubObj, spot) : null;
          if (c.levels === 'regular' && st.lvl[c.sport] === 'rookie') { lvlOut++; return; }
          if (min != null && min > st.max) { farOut++; return; }
          var fit = c.levels === 'rookie' ? 'ROOKIE CREW' : st.lvl[c.sport] === 'rookie' ? 'ALL LEVELS' : 'YOUR LEVEL', fl = {};
          SP.forEach(function (x) { fl['is_' + x] = x === c.sport; });
          shown.push(Object.assign({ spot: c.spot_name.toUpperCase(), when: dayN(c.day) + ' ' + c.start + ' · ' + c.going + ' GOING', hasSeat: st.mode === 'seat' && c.seats_free > 0,
            seat: hubObj && spot ? 'Seat about ' + H.fuelEach(hubObj, spot, 4) + ' each' : '', fit: fit, min: min == null ? '–' : String(min),
            fs: "padding:1px 6px;border:2px solid #111111;font-family:'Archivo Black',sans-serif;font-size:10px;white-space:nowrap;background:" + (fit === 'YOUR LEVEL' ? '#C8FF3D' : '#FFE14D') + ';color:#111111' }, fl));
        });
        v.ms = shown;
        v.mN = shown.length + (shown.length === 1 ? ' CREW' : ' CREWS');
        v.mSub1 = 'FROM ' + (hubObj ? hubObj.name : '');
        v.hasHid = true;
        v.hidT = [farOut ? farOut + ' more over ' + st.max + ' min away' : '', lvlOut ? lvlOut + ' for regulars and up' : ''].filter(function (x) { return x; }).join(' · ') +
          (farOut || lvlOut ? '. ' : '') + (shown.length ? 'More start on good days.' : 'No crew matches yet: captains start them on good days, and they show on your home screen.');
        v.goT = shown.length ? 'SEE MY ' + shown.length + ' CREW' + (shown.length > 1 ? 'S' : '') + ' →' : 'SEE THE CREWS →';
        v.setName = function (e) { self.setState({ name: e && e.target ? e.target.value : '' }); };
        var next = v.next;
        v.next = function () {
          if (!picked.length) return; // the button says "PICK A SPORT FIRST"
          self.hi8Save(false);
          next();
        };
        var back = v.back;
        v.back = function () {
          if (self.state.step === 1) { location.href = 'B27-Home.dc.html'; return; } // "Skip for now"
          back();
        };
        v.locGo = function () { self.hi8Locate(); };
        if (this.hi8Loc) v.locT = this.hi8Loc;
        return v;
      }
      componentDidMount() {
        if (super.componentDidMount) super.componentDidMount();
        var self = this;
        root().addEventListener('click', function (e) {
          var a = e.target.closest ? e.target.closest('a.big') : null;
          if (!a || (a.getAttribute('href') || '').indexOf('B27-Home') !== 0) return;
          e.preventDefault();
          var href = a.getAttribute('href');
          timeout(self.hi8Save(true), 2500).then(function () { location.href = href; }, function () { location.href = href; });
        }, true);
      }
      hi8Save(final) {
        var st = this.state, m = me(), p = m.profile || {};
        p.name = (st.name || '').trim();
        p.sports = SP.filter(function (s) { return st.on[s]; });
        p.levels = profileOf(st, false).p_levels;
        if (final) { p.hub = st.hub; p.max = st.max; p.mode = st.mode; }
        m.profile = p;
        store.set('me', m);
        return ready.then(function () { return withKey('hi8_profile', profileOf(st, final)); }).catch(noop);
      }
      hi8Locate() {
        var self = this;
        if (!navigator.geolocation) { this.hi8Loc = 'NO LOCATION ON THIS DEVICE · PICK A HUB'; this.forceUpdate(); return; }
        this.hi8Loc = 'FINDING YOUR NEAREST HUB…';
        this.forceUpdate();
        navigator.geolocation.getCurrentPosition(function (pos) {
          var here = { lat: pos.coords.latitude, lon: pos.coords.longitude }, best = null, bestKm = 1e9;
          var hubs = H.hubsOf(me().city || (store.get('pick', null) || {}).city || 'amsterdam'), names = {};
          hubs.forEach(function (h) { names[h.slug] = h.name; var d = km(here, h); if (d < bestKm) { bestKm = d; best = h.slug; } });
          if (!best) { self.hi8Loc = 'NO HUB NEAR YOU YET · PICK ONE'; self.forceUpdate(); return; }
          var mins = Math.max(1, Math.round(bestKm * 1.3 / 15 * 60)); // by bike, roads aren't straight
          self.hi8Loc = 'NEAREST HUB: ' + names[best] + ' · ' + (mins <= 30 ? mins + ' MIN BY BIKE' : Math.round(bestKm) + ' KM AWAY') + ' ✓';
          self.setState({ loc: true, hub: best });
        }, function () {
          self.hi8Loc = 'LOCATION IS OFF · PICK A HUB';
          self.setState({ loc: false });
        }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 });
      }
    };
  };

  // ---- Founding Night ----
  function icsFile(sessionLine) {
    var esc = function (s) { return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); };
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    return [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hi8ctane//Founding Night//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      'UID:founding-night-bcn-2027@hi8ctane.com',
      'DTSTAMP:' + stamp,
      'DTSTART:20270123T083000Z', // 09:30 in Barcelona
      'DTEND:20270124T000000Z', // 01:00 in Barcelona
      'SUMMARY:' + esc('Hi8ctane Founding Night · Barcelona'),
      'LOCATION:' + esc('Barcelona'),
      'DESCRIPTION:' + esc(sessionLine + '\n09:30 crews meet at the hubs. 20:00 Founding Night opens. DJ set till 01:00.\nhttps://hi8ctane.com/night'),
      'URL:https://hi8ctane.com/night',
      'END:VEVENT', 'END:VCALENDAR', ''
    ].join('\r\n');
  }
  function download(name, type, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  SCREENS['B27-Night'] = function (C) {
    return class extends C {
      constructor(props) {
        super(props);
        this.state.photo = false; // consent to photos is opt-in
        var r = store.get('rsvp', null);
        this.hi8Mine = null; // what Supabase has counted for this browser
        if (r && r.event === EVENT && me().key) {
          Object.assign(this.state, { rsvp: true, waiver: true, s: r.s, hub: r.hub, photo: !!r.photo });
          this.hi8Mine = { s: r.s };
          this.hi8N = r.n;
        }
        this.hi8Synced = this.hi8Mine ? this.hi8Choice() : null;
      }
      hi8Choice() { var st = this.state; return { s: st.s, hub: st.hub, photo: !!st.photo }; }
      renderVals() {
        var v = super.renderVals(), self = this, st = this.state, nc = counts && counts.night;
        var mine = this.hi8Mine, sess = (nc && nc.sessions) || {};
        var going = (nc ? nc.going : 0) - (mine ? 1 : 0) + (st.rsvp ? 1 : 0);
        v.goingT = going + ' OF ' + NIGHT_CAP + ' GOING · FREE';
        v.sess.forEach(function (x, i) {
          var n = (sess[NIGHT_SESSIONS[i]] || 0) - (mine && mine.s === i ? 1 : 0) + (st.rsvp && st.s === i ? 1 : 0);
          x.n = String(Math.max(0, n));
        });
        v.myN = String(this.hi8N || going);
        v.needEmail = !me().key && !st.rsvp;
        v.nEmail = st.nEmail || '';
        v.setNEmail = function (e) { self.setState({ nEmail: e && e.target ? e.target.value : '' }); };
        v.rsvpGo = function () {
          if (!self.state.waiver) return;
          if (!me().key) {
            // no account yet: the email in the RSVP box signs them up (a Barcelona plate) and RSVPs in one tap
            var inp = document.getElementById('nem'), email = (self.state.nEmail || '').trim();
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { nativeHint(inp, email ? "That email doesn't look right." : 'Your email first: for your plate and the night\'s details.'); return; }
            var fix = emailTypo(email);
            if (fix && self.hi8Warned !== email) { self.hi8Warned = email; nativeHint(inp, 'Did you mean ' + fix + '? Fix it, or press again to keep it.'); return; }
            if (self.hi8Joining) return;
            self.hi8Joining = true;
            var src = store.get('src', null) || {};
            rpc('hi8_join', { p_email: email, p_city: 'barcelona', p_source: src.source || null, p_ref: src.ref || null }).then(function (out) {
              saveMe(out); self.hi8Joining = false; self.setState({ rsvp: true });
            }, function (e) {
              self.hi8Joining = false;
              nativeHint(inp, e.status === 429 ? 'Too many tries from here. Wait a few minutes.' : (e.hint || (unreachable(e) ? 'No connection. Try again.' : "That didn't work. Try again.")));
            });
            return;
          }
          self.setState({ rsvp: true });
        };
        v.calGo = function () {
          var x = self.state, line = ['Kite + wing at Castelldefels', 'SUP + surf at Barceloneta', 'MTB at Collserola'][x.s] || 'Founding Night';
          download('hi8ctane-founding-night.ics', 'text/calendar', icsFile(line + ', from ' + x.hub.charAt(0) + x.hub.slice(1).toLowerCase()));
          self.setState({ cal: true });
        };
        v.mateGo = function () {
          share('https://hi8ctane.com/night', 'Hi8ctane Founding Night', 'Founding Night in Barcelona, Sat 23 Jan: ride in the day, party at night. Free.', function () { self.setState({ mate: true }); });
        };
        return v;
      }
      componentDidMount() {
        if (super.componentDidMount) super.componentDidMount();
        var self = this, pend = store.get('pendingRsvp', null);
        refreshOn(this);
        this.hi8Plate();
        if (PARAMS.get('from') === 'join' && pend && Date.now() - pend.at < 36e5) {
          store.del('pendingRsvp');
          ready.then(function () {
            if (!me().key) return;
            self.setState({ s: pend.s, hub: pend.hub, photo: !!pend.photo, waiver: true, rsvp: true });
          });
        }
      }
      componentDidUpdate() {
        if (super.componentDidUpdate) super.componentDidUpdate();
        this.hi8Plate();
        var st = this.state, now = this.hi8Choice(), self = this;
        if (!st.rsvp || !st.waiver || sameJSON(now, this.hi8Synced)) return;
        this.hi8Synced = now;
        clearTimeout(this.hi8T);
        this.hi8T = setTimeout(function () {
          withKey('hi8_rsvp', { p_session: NIGHT_SESSIONS[now.s], p_hub: NIGHT_HUBS[now.hub], p_waiver: true, p_photo: now.photo, p_event: EVENT })
            .then(function (out) {
              store.set('rsvp', { event: EVENT, s: now.s, hub: now.hub, photo: now.photo, n: out.n });
              self.hi8Mine = { s: now.s };
              self.hi8N = out.n;
              counts = H.counts = Object.assign({}, counts || {}, { night: { going: out.going, sessions: out.sessions } });
              store.set('counts', counts);
              self.forceUpdate();
            }, function (e) {
              if (e.message === 'unknown_key') { store.del('rsvp'); self.hi8Synced = null; self.setState({ rsvp: false }); }
            });
        }, 300);
      }
      // the plate badge next to "YOU'RE GOING" shows this rider's own plate
      hi8Plate() {
        var spans = root().querySelectorAll('span'), label = null;
        for (var i = 0; i < spans.length; i++) if (/^YOU'RE GOING ·/.test(spans[i].textContent)) label = spans[i]; // the innermost
        var box = label && label.parentNode && label.parentNode.parentNode;
        var t = box ? box.querySelector('svg text') : null;
        if (!t) return;
        var pl = me().plates || {}, n = pl.barcelona || pl[me().city] || pl[Object.keys(pl)[0]];
        var want = n ? String(n) : '';
        if (t.textContent !== want) t.textContent = want;
      }
    };
  };

  // ---- a new city ----
  function cityChoice(k) {
    var all = store.get('cities', null) || {}, c = all[k];
    return c ? { in: !!c.in, cap: !!c.cap, csp: c.csp || null, cdays: c.cdays || { sat: true } } : { in: false, cap: false, csp: null, cdays: { sat: true } };
  }
  // ---- the good-day meter for the cities that aren't open yet (Open-Meteo, hourly) ----
  var COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  function compass(deg) { return COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16]; }
  function outside(deg, from, to) {
    var d = ((deg % 360) + 360) % 360, inside = from <= to ? d >= from && d <= to : d >= from || d <= to;
    if (inside) return 0;
    var dist = function (a, b) { var x = Math.abs(a - b) % 360; return Math.min(x, 360 - x); };
    return Math.min(dist(d, from), dist(d, to));
  }
  function hourScore(sport, h, spot) {
    var clamp = function (x) { return Math.max(0, Math.min(10, Math.round(x))); }, rp = function (p) { return p >= 70 ? 2 : p >= 40 ? 1 : 0; }, s;
    if (sport === 'kite' || sport === 'wing') {
      var lo = sport === 'kite' ? 15 : 12, w = h.w;
      if (w < (sport === 'kite' ? 11 : 9)) s = Math.max(0, w - 6) / 2; else if (w < lo) s = 5; else if (w <= 25) s = w >= lo + 2 && w <= 23 ? 9 : 8; else if (w <= 30) s = 6; else s = 2;
      var gd = h.g - h.w; s -= gd > 10 ? 3 : gd > 7 ? 2 : gd > 5 ? 1 : 0; s -= rp(h.r);
      if (!spot.lake && spot.good_from != null) { var off = outside(h.dir, spot.good_from, spot.good_to); if (off > 30) s = Math.min(s, 1); else if (off > 0) s -= 2; }
      return clamp(s);
    }
    if (sport === 'sup') { s = h.w <= 5 ? 9 : h.w <= 8 ? 7 : h.w <= 12 ? 4 : h.w <= 16 ? 2 : 0; if (h.w <= 3 && h.r < 30) s = 10; s -= rp(h.r); return clamp(s); }
    if (sport === 'surf') {
      var wave = h.wv || 0, per = h.per || 0;
      s = wave < 0.4 ? 1 : wave < 0.7 ? 3 : wave < 1 ? 5 : wave < 2 ? 7 : wave < 3 ? 6 : 4;
      s += per >= 10 ? 2 : per >= 8 ? 1 : per && per < 5 ? -1 : 0;
      if (h.w <= 6) s += 1; else if (spot.good_from != null) { if (outside(h.dir, spot.good_from, spot.good_to) === 0) s -= h.w > 18 ? 3 : h.w > 12 ? 2 : 0; else if (h.w <= 15) s += 1; }
      if (wave < 0.4) s = Math.min(s, 2);
      return clamp(s);
    }
    s = h.r < 30 && (h.mm || 0) < 0.2 ? 8 : h.r < 60 ? 5 : 2; if (h.wet) s -= 2; return clamp(s);
  }
  var LBL = function (s) { return s >= 9 ? 'EPIC' : s >= 6 ? 'GOOD' : s >= 4 ? 'OK' : 'NO GO'; };
  var WVC = { EPIC: ['#FF2D78', '#FFFFFF'], GOOD: ['#C8FF3D', '#111111'], OK: ['#FFE14D', '#111111'], 'NO GO': ['#E7E2D4', '#4A4538'] };
  var WDAY = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  // the best two days for a city this week, from the real forecast, in the city page's "this week" format
  function cityWeek(city) {
    var fx = H.fx || {}, out = [];
    H.spotsOf(city).forEach(function (spot) {
      var f = fx[spot.slug]; if (!f || !f.days) return;
      f.days.forEach(function (d, i) {
        if (!d || d.none || !d.hrs) return;
        spot.sports.forEach(function (sp) {
          var hs = d.hrs.map(function (x) { return Object.assign({ wet: d.wet }, x); }), best = -1, at = 0;
          var sc = hs.map(function (x) { return hourScore(sp, x, spot); });
          for (var k = 1; k < sc.length; k++) { var v2 = (sc[k - 1] + sc[k]) / 2; if (v2 > best) { best = v2; at = k; } }
          var x = hs[at], score = Math.round(best), lab = LBL(score);
          var line = sp === 'surf' ? (x.wv || 0).toFixed(1) + ' m at ' + Math.round(x.per || 0) + ' s, wind ' + Math.round(x.w) + ' kt'
            : sp === 'mtb' ? (x.r < 30 ? 'Dry' : 'Rain ' + x.r + '%') + ', ' + Math.round(x.t) + '°' : Math.round(x.w) + ' kt ' + compass(x.dir) + (sp === 'sup' ? '' : ', gusts ' + Math.round(x.g));
          var day = i === 0 ? 'TODAY' : i === 1 ? 'TOMORROW' : WDAY[new Date(d.date + 'T12:00:00Z').getUTCDay()];
          out.push({ sc: score, sp: sp, t: sp.toUpperCase() + ' · ' + day + ' · ' + spot.name.toUpperCase(), s: line, v: lab + ' ' + score });
        });
      });
    });
    if (!out.length) return null;
    out.sort(function (a, b) { return b.sc - a.sc; });
    var pick = [out[0]].concat(out.filter(function (o) { return o.sp !== out[0].sp; }).slice(0, 1));
    return pick.map(function (o) {
      var c = WVC[o.v.split(' ')[0] === 'NO' ? 'NO GO' : o.v.split(' ')[0]], fl = {};
      SP.forEach(function (s) { fl['is_' + s] = s === o.sp; });
      return Object.assign({ t: o.t, s: o.s, v: o.v, vs: 'flex-shrink:0;padding:2px 6px;border:2px solid #111111;font-family:\'Archivo Black\',sans-serif;font-size:11px;white-space:nowrap;background:' + c[0] + ';color:' + c[1] }, fl);
    });
  }

  SCREENS['B27-City'] = function (C) {
    return class extends C {
      constructor(props) {
        super(props);
        if (NEW_CITIES[PARAMS.get('c')]) this.state.city = PARAMS.get('c');
        Object.assign(this.state, cityChoice(this.state.city));
        this.hi8Synced = {}; // what Supabase already has, per city
        Object.keys(NEW_CITIES).forEach(function (k) {
          var c = cityChoice(k);
          this.hi8Synced[k] = { in: c.in, cap: c.cap, csp: c.cap ? c.csp : null, cdays: c.cap ? c.cdays : null };
        }, this);
      }
      hi8Choice() { var st = this.state; return { in: !!st.in, cap: !!st.cap, csp: st.cap ? st.csp : null, cdays: st.cap ? st.cdays : null }; }
      renderVals() {
        var v = super.renderVals(), self = this, st = this.state, slug = NEW_CITIES[st.city];
        var keys = Object.keys(NEW_CITIES);
        v.cities.forEach(function (x, j) {
          x.go = function () { self.setState(Object.assign({ city: keys[j], copied: false }, cityChoice(keys[j]))); };
        });
        var goIn = v.inGo, goCap = v.capGo;
        v.inGo = function () {
          if (!self.state.in && !me().key) return self.hi8SignUpFirst({ in: true });
          goIn();
        };
        v.capGo = function () {
          if (!self.state.cap && !me().key) return self.hi8SignUpFirst({ cap: true });
          goCap();
        };
        v.otherCity = st.otherCity || '';
        v.setOther = function (e) { self.setState({ otherCity: e && e.target ? e.target.value : '', otherDone: false }); };
        v.otherT = st.otherDone ? 'ASKED ✓' : 'ASK FOR IT';
        v.otherBg = st.otherDone ? '#C8FF3D' : '#FFFFFF';
        v.otherGo = function () {
          var c = (self.state.otherCity || '').trim(), inp = root().querySelector('input[aria-label="Your city"]');
          if (c.length < 2) { nativeHint(inp, 'Type your city first.'); return; }
          if (!me().key) {
            store.set('pendingOther', { city: c, at: Date.now() });
            location.href = 'B27-Join.dc.html?next=city&c=' + self.state.city + '&city=' + ((store.get('pick', null) || {}).city || 'amsterdam');
            return;
          }
          withKey('hi8_city_request', { p_city: c }).then(function () { self.setState({ otherDone: true }); }, function (e) { nativeHint(inp, e.hint || "That didn't work. Try again."); });
        };
        v.week = cityWeek(slug) || v.week;
        v.copyGo = function () {
          var nm = CITY_NAMES[slug];
          share('https://hi8ctane.com/' + slug, 'Hi8ctane ' + nm, 'Help open Hi8ctane in ' + nm + ': 25 riders and 3 captains and the first crews go out.', function () { self.setState({ copied: true }); });
        };
        var cc = counts && counts.cities && counts.cities[slug];
        if (cc) {
          var srv = (store.get('cityMine', null) || {})[slug] || { in: false, cap: false };
          var r = Math.max(0, cc.riders - (srv.in ? 1 : 0) + (st.in || st.cap ? 1 : 0));
          var k = Math.max(0, cc.captains - (srv.cap ? 1 : 0) + (st.cap ? 1 : 0));
          var rg = cc.riders_goal || 25, kg = cc.captains_goal || 3, nm = CITY_NAMES[slug];
          v.rN = String(r); v.rGoal = String(rg); v.cN = String(k); v.cGoal = String(kg);
          v.rPct = 'width:' + Math.min(100, r / rg * 100) + '%';
          v.cPct = 'width:' + Math.min(100, k / kg * 100) + '%';
          v.needT = rg - r > 0
            ? (rg - r) + ' more riders and ' + Math.max(0, kg - k) + ' captain' + (kg - k === 1 ? '' : 's') + ' to open ' + nm
            : nm + ' has its ' + rg + ' riders';
        }
        return v;
      }
      hi8SignUpFirst(want) {
        store.set('pendingCity', Object.assign({ c: this.state.city, at: Date.now() }, want));
        location.href = 'B27-Join.dc.html?next=city&c=' + this.state.city + '&city=' + NEW_CITIES[this.state.city];
      }
      componentDidMount() {
        if (super.componentDidMount) super.componentDidMount();
        var self = this, pend = store.get('pendingCity', null);
        refreshOn(this);
        var other = store.get('pendingOther', null);
        if (PARAMS.get('from') === 'join' && other && Date.now() - other.at < 36e5) {
          store.del('pendingOther');
          ready.then(function () { if (me().key) withKey('hi8_city_request', { p_city: other.city }).then(function () { self.setState({ otherCity: other.city, otherDone: true }); }, noop); });
        }
        if (PARAMS.get('from') === 'join' && pend && pend.c === this.state.city && Date.now() - pend.at < 36e5) {
          store.del('pendingCity');
          ready.then(function () {
            if (!me().key) return;
            var up = { in: true };
            if (pend.cap) { up.cap = true; up.csp = self.state.csp; }
            self.setState(up);
          });
        }
      }
      componentDidUpdate() {
        if (super.componentDidUpdate) super.componentDidUpdate();
        var st = this.state, k = st.city, slug = NEW_CITIES[k], now = this.hi8Choice(), self = this;
        if (st.cap && !st.csp) return; // the design fills in the captain's sport on the next render
        var all = store.get('cities', null) || {};
        all[k] = { in: now.in, cap: now.cap, csp: st.csp, cdays: st.cdays };
        store.set('cities', all);
        if (sameJSON(now, this.hi8Synced[k]) || !me().key) return;
        this.hi8Synced[k] = now;
        clearTimeout(this.hi8T);
        this.hi8T = setTimeout(function () {
          var days = Object.keys(now.cdays || {}).filter(function (d) { return now.cdays[d] && CAPTAIN_DAYS[d]; }).map(function (d) { return CAPTAIN_DAYS[d]; });
          withKey('hi8_city', { p_city: slug, p_in: now.in, p_captain: now.cap, p_captain_sport: now.cap ? now.csp : null, p_captain_days: now.cap ? days : [] })
            .then(function (out) {
              var mine = store.get('cityMine', null) || {};
              mine[slug] = { in: out.in, cap: out.captain };
              store.set('cityMine', mine);
              var m = me(); m.plates = m.plates || {};
              if (out.plate != null) m.plates[slug] = out.plate; else delete m.plates[slug];
              store.set('me', m);
              var cities = Object.assign({}, (counts && counts.cities) || {});
              cities[slug] = out;
              counts = H.counts = Object.assign({}, counts || {}, { cities: cities });
              store.set('counts', counts);
              self.forceUpdate();
            }, noop);
        }, 400);
      }
    };
  };

  // ---- schools + rental shops ----
  SCREENS['B27-Schools'] = function (C) {
    return class extends C {
      componentDidMount() {
        if (super.componentDidMount) super.componentDidMount();
        var self = this;
        root().addEventListener('click', function (e) {
          var a = e.target.closest ? e.target.closest('a.big[href^="mailto:"]') : null; // the form's EMAIL US
          if (!a) return;
          var st = self.state, name = (st.name || '').trim(), contact = (st.contact || '').trim();
          if (!name) { e.preventDefault(); nativeHint(document.getElementById('sn'), 'Add your school or shop name.'); return; }
          if (contact.length < 3) { e.preventDefault(); nativeHint(document.getElementById('ct'), 'Add an email or phone number so we can reach you.'); return; }
          var offers = Object.keys(st.offer || {}).filter(function (o) { return st.offer[o]; });
          var args = { p_name: name, p_contact: contact, p_spot: (st.spot || '').trim() || null, p_offers: offers };
          var sig = JSON.stringify(args);
          if (store.get('leadSent', null) === sig) return; // the mail app opens again; the lead is already saved
          rpc('hi8_partner', args).then(function () { store.set('leadSent', sig); }, function (err) { if (unreachable(err)) later('hi8_partner', args); });
        }, true);
      }
    };
  };

  // hand the extensions to the player (support.js)
  window.DC_EXTEND = (window.DC_EXTEND || []).concat([function (C, name) {
    var f = SCREENS[name];
    return f ? f(C) : C;
  }]);
})();
