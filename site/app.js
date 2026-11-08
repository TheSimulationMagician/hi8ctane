/*
 * Hi8ctane 2.8: the live app at hi8ctane.com. Two things to do: JOIN A CREW or START A CREW.
 * Everything else (the live map, the forecast) is there to help you pick.
 *
 * Data: hi8.js (Supabase: crews, riders, the browser key), fx.js (Open-Meteo, rated per sport),
 * map.js (the live map), geo.js (coastlines). Routes: /?c=CODE a crew, #join, #start, #spot/<slug>, #me.
 */
(function () {
  'use strict';
  var HI8 = window.HI8, FX = window.FX;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var noop = function () {};

  // ---------------------------------------------------------------- words
  var SPORT = { kite: { name: 'Kite', em: '🪁' }, mtb: { name: 'MTB', em: '🚵' }, mx: { name: 'MX', em: '🏍️' }, wing: { name: 'Wing', em: '🪽' }, surf: { name: 'Surf', em: '🏄' }, sup: { name: 'SUP', em: '🛶' } };
  var LIVE_SPORTS = ['kite', 'mtb', 'mx'], SOON = ['wing', 'surf', 'sup'];
  var LEVEL = { rookie: 'LEARNING', regular: 'RIDER', ripper: 'RIPPER' };
  var LEVEL_SUB = { rookie: "can't ride on my own yet", regular: 'I ride on my own', ripper: 'strong, any conditions' };
  var CREW_LEVELS = { regular: 'RIDERS WHO RIDE SOLO', all: 'ALL LEVELS · ROOKIES WELCOME', rookie: 'ROOKIE SESSION' };
  var DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var ERR = {
    crew_full: 'This crew is full.', level: 'This crew is for riders who ride on their own.', crew_off: 'This crew was called off.', crew_past: 'This crew already happened.',
    car_full: 'That car is full: pick "any car" or own way.', bad_email: "That email doesn't look right.", name_required: "Add a rider name: it's what the crew sees.",
    bad_time: 'Check the times.', bad_day: 'Pick a day in the next two weeks.', not_captain: 'Only approved captains start crews right now.', captains_only: 'Crews with rookies are run by approved captains.',
    slow_down: 'Too many tries from here. Wait a few minutes.', not_today: 'That works on the day of the crew.', unknown_key: 'Sign up again on this phone.', not_in_crew: 'Join the crew first.',
    bad_link: 'Paste a Revolut, PayPal, Tikkie, bunq, Wise, Monzo, Rabobank or ING link.', bad_bizum: 'Bizum needs a Spanish mobile number, like 612 345 678.', bad_cost: 'Between €0 and €500.',
    offline_build: 'Crews need the live site.', no_crew: "This crew link doesn't exist.", sport_soon: 'That sport is coming soon.'
  };
  function errText(e) {
    if (!e) return 'Something went wrong.';
    if (HI8.unreachable(e)) return "Can't reach Hi8ctane right now. Check your connection and try again.";
    if (e.status === 404) return 'Hi8ctane is being updated. Try again in a little while.';
    return ERR[e.message] || e.hint || 'Something went wrong (' + esc(e.message) + ').';
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dDate(s) { return new Date(s + 'T12:00:00Z'); }
  function dayLong(s) { var d = dDate(s); return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
  function dayRel(s) { var t = S.today; if (s === t) return 'TODAY'; if (s === FX.addDays(t, 1)) return 'TOMORROW'; return dayLong(s); }
  function hm(x) { return x ? String(x).slice(0, 5) : ''; }
  function minutes(t) { var p = String(t).split(':'); return Number(p[0]) * 60 + Number(p[1] || 0); }
  function fromMin(m) { m = Math.max(0, Math.min(23 * 60 + 55, m)); return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function ago(iso) { var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 90 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : Math.round(s / 3600) + ' h ago'; }
  function arrow(dir, col) { // points where the wind blows to
    return '<svg class="a" viewBox="0 0 16 16" aria-hidden="true" style="transform:rotate(' + ((dir || 0) + 180) + 'deg)"><path d="M8 1 L13 13 L8 10 L3 13 Z" fill="' + (col || '#111') + '"/></svg>';
  }
  function tag(rate, extra) { var t = rate == null ? 'none' : FX.tone(rate.s != null ? rate.s : rate.score); return '<span class="tag ' + t + '">' + esc(extra || (rate ? rate.label : 'NO FORECAST')) + '</span>'; }

  // ---------------------------------------------------------------- state
  var P = new URLSearchParams(location.search);
  var S = {
    city: (P.get('city') || HI8.store.get('city28', null) || 'barcelona'),
    sport: (P.get('sport') || P.get('sp') || HI8.store.get('sport28', null) || 'kite'),
    variant: P.get('v') || 'map', settings: null, today: null, tz: 'Europe/Madrid', hi: null, layer: 'wind', playing: null,
    crew: null, sf: null, jf: null, joinDay: 'all', spotDay: 0, live: null, me: HI8.me()
  };
  if (LIVE_SPORTS.indexOf(S.sport) < 0) S.sport = 'kite';
  function kg() { return Number(HI8.store.get('kg', 75)) || 75; }
  function cityObj(slug) { return (HI8.placesNow().cities || []).filter(function (c) { return c.slug === slug; })[0] || { slug: slug, name: slug, tz: 'Europe/Madrid' }; }
  function spotsFor(city, sport) { return HI8.spotsOf(city).filter(function (s) { return (s.sports || []).indexOf(sport) >= 0; }); }
  function cityNow(tz) {
    try {
      var p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
        .formatToParts(new Date()).forEach(function (x) { p[x.type] = x.value; });
      return { date: p.year + '-' + p.month + '-' + p.day, h: Number(p.hour) % 24, m: Number(p.minute) };
    } catch (e) { var d = new Date(); return { date: d.toISOString().slice(0, 10), h: d.getHours(), m: d.getMinutes() }; }
  }
  function refreshToday() { S.tz = cityObj(S.city).tz || 'Europe/Madrid'; var n = cityNow(S.tz); S.today = n.date; S.nowH = n.h; S.nowM = n.m; }
  refreshToday();
  function src() { return HI8.store.get('src', null) || {}; }
  function signedIn() { return !!HI8.me().key; }
  function myPlate() { var m = HI8.me(), pl = m.plates || {}; return pl[S.city] || pl[m.city] || pl[Object.keys(pl)[0]] || null; }

  // ---------------------------------------------------------------- forecast access
  function fxSpot(slug) { var D = FX.data[S.city]; var sp = D && D.spots[slug]; if (sp && !sp._i) { sp._i = {}; sp.hours.forEach(function (r, i) { sp._i[r.t] = i; }); } return sp || null; }
  function rowAt(slug, t) { var sp = fxSpot(slug); return sp && sp._i[t] != null ? sp.hours[sp._i[t]] : null; }
  function rateAt(spot, t, sport) { var sp = fxSpot(spot.slug), r = rowAt(spot.slug, t); return r ? FX.rate(sport || S.sport, spot, r, sp.days[r.d], { kg: kg() }) : null; }
  function crewFx(c) {
    var spot = HI8.spot(c.spot), sp = fxSpot(c.spot);
    if (!spot || !sp) return null;
    var from = Number(hm(c.start).slice(0, 2)), to = c.end ? Math.max(from + 1, Number(hm(c.end).slice(0, 2)) + (hm(c.end).slice(3) > '00' ? 1 : 0)) : from + 3;
    return FX.span(sp, c.day, from, to, c.sport, spot, { kg: kg() });
  }
  function times() { var G = FX.gridData[S.city]; if (G) return G.time; var any = spotsFor(S.city, S.sport)[0], sp = any && fxSpot(any.slug); return sp ? sp.hours.filter(function (r) { return r.d >= S.today; }).map(function (r) { return r.t; }) : []; }
  function defaultHour() {
    var T = times(); if (!T.length) return 0;
    var want = S.nowH < 8 ? S.today + 'T12:00' : S.nowH >= 18 ? FX.addDays(S.today, 1) + 'T12:00' : S.today + 'T' + pad(S.nowH) + ':00';
    var i = T.indexOf(want); return i < 0 ? 0 : i;
  }

  // ---------------------------------------------------------------- the frame
  var app = $('#app');
  function frame() {
    if (S.variant !== 'map') app.classList.add('v-' + S.variant);
    app.innerHTML =
      '<header class="top"><a class="logo" href="./" aria-label="Hi8ctane home">Hi8<b>ctane</b></a>' +
      '<button class="city" data-act="city" aria-label="Change city"><span id="cityName"></span> <small id="cityTag"></small> ▾</button>' +
      '<button class="plate" id="plate" data-act="me" aria-label="Me: your plate and crews"></button></header>' +
      '<nav class="sports" aria-label="Sport" id="sports"></nav>' +
      '<section class="mapwrap" aria-label="Live map"><div id="map"></div>' +
      '<div class="mapnote" id="mapnote"></div>' +
      '<div class="mapbtns"><button class="mbtn" data-act="zoom" data-d="0.6" aria-label="Zoom in">+</button><button class="mbtn" data-act="zoom" data-d="-0.6" aria-label="Zoom out">−</button>' +
      '<button class="mbtn txt" id="layerBtn" data-act="layer" aria-pressed="false">RAIN</button></div>' +
      '<div class="legend" aria-hidden="true">0 <i id="legendBar"></i> 40 KT</div>' +
      '<div class="timebar"><button class="play" id="play" data-act="play" aria-label="Play the next hours">▶</button>' +
      '<div class="tl"><label class="sr" for="hour">Forecast time</label><input type="range" id="hour" min="0" max="0" value="0"><div class="days" id="tlDays"></div></div>' +
      '<div class="when" id="when"></div></div></section>' +
      '<main class="panel" id="panel">' +
      '<section class="sec s-best" id="best"></section>' +
      '<section class="sec s-crews" id="crews"></section>' +
      '<section class="sec s-live" id="live"></section>' +
      '<footer class="foot"><a href="B27-Night.dc.html">Founding Night</a><a href="B27-Schools.dc.html">Schools + rentals</a><a href="B27-City.dc.html">Other cities</a><a href="privacy/">Privacy</a><a href="terms/">Terms</a>' +
      '<p>Forecast: Open-Meteo (Météo-France AROME, ECMWF, DWD ICON, NOAA GFS). Coastlines: Natural Earth. Every session is your own call: check the spot and the rules there.</p></footer>' +
      '</main>' +
      '<div class="dock"><button class="big join" data-act="join">JOIN A CREW</button><button class="big start" data-act="start">START A CREW</button></div>' +
      '<div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="shTitle"></div><div class="toast" id="toast" role="status" aria-live="polite"></div>';
    if (S.variant !== 'map' && window.innerWidth < 960) { // the iterations: forecast-first, crews-first
      $('#panel').appendChild($('.mapwrap'));
    }
    var stops = [0, 5, 9, 13, 16, 19, 24, 28, 33, 38];
    $('#legendBar').style.background = 'linear-gradient(90deg,' + stops.map(function (k) { return window.HI8_WIND_COLOR(k) + ' ' + Math.round(k / 40 * 100) + '%'; }).join(',') + ')';
  }

  // ---------------------------------------------------------------- the map
  var map = null;
  function initMap() {
    var geo = (window.HI8_GEO || {})[S.city];
    if (map) { map.destroy(); map = null; }
    map = window.HI8Map($('#map'), { geo: geo, onSpot: function (slug) { go('#spot/' + slug); }, still: P.get('still') === '1' });
    fitMap();
  }
  function fitMap() {
    var pts = spotsFor(S.city, S.sport).map(function (s) { return [s.lat, s.lon]; }).concat(HI8.hubsOf(S.city).slice(0, 1).map(function (h) { return [h.lat, h.lon]; }));
    if (map && pts.length) map.fit(pts, { t: 44, r: 52, b: 80, l: 34 });
    keepOut();
  }
  // labels on the map stay clear of the buttons, the legend and the time bar
  function keepOut() {
    if (!map) return;
    var base = $('#map').getBoundingClientRect();
    map.setKeepOut(['.mapbtns', '.legend', '.timebar', '#mapnote .chip'].map(function (q) { return Array.prototype.slice.call(document.querySelectorAll(q)); })
      .reduce(function (a, b) { return a.concat(b); }, []).map(function (el) { var r = el.getBoundingClientRect(); return [r.left - base.left - 4, r.top - base.top - 4, r.right - base.left + 4, r.bottom - base.top + 4]; }));
  }
  function drawMapSpots() {
    if (!map) return;
    var T = times(), t = T[S.hi] || null, crews = upcoming(S.sport, 3), live = S.live;
    map.setSpots(spotsFor(S.city, S.sport).map(function (s) {
      var r = t ? rowAt(s.slug, t) : null, rt = t ? rateAt(s, t) : null, mine = crews.filter(function (c) { return c.spot === s.slug; });
      var here = live ? (live.crews || []).filter(function (c) { return c.spot === s.slug; }).reduce(function (n, c) { return n + (c.here || 0); }, 0) : 0;
      var o = { slug: s.slug, name: s.name, lat: s.lat, lon: s.lon, crews: mine.length, here: here, live: mine.some(function (c) { return c.live; }) };
      if (!r || !rt) { o.tone = 'none'; o.big = null; o.small = FX.error ? 'NO FORECAST' : ''; return o; }
      o.tone = rt.dark ? 'dark' : FX.tone(rt.s);
      if (S.sport === 'kite') { o.big = Math.round(r.w); o.small = rt.dark ? 'DARK' : FX.compass(r.dir) + ' · ' + rt.label; }
      else { o.big = rt.dark ? '–' : Math.round(rt.s); o.small = rt.dark ? 'DARK' : (rt.ground || '').toUpperCase() + ' · ' + Math.round(r.temp) + '°C'; }
      return o;
    }));
    map.setGrid(FX.gridData[S.city] || null);
    map.setHour(Math.max(0, (FX.gridData[S.city] ? FX.gridData[S.city].time.indexOf(t) : -1)));
    map.setLayer(effLayer());
    var note = [];
    var liveN = live ? (live.crews || []).filter(function (c) { return c.sport === S.sport && c.live; }).length : 0;
    if (liveN) note.push('<span class="chip"><span class="dot"></span>' + liveN + ' CREW' + (liveN > 1 ? 'S' : '') + ' ON NOW</span>');
    if (FX.error && !FX.data[S.city]) note.push('<span class="chip">FORECAST UNAVAILABLE</span>');
    else if (FX.data[S.city] && FX.data[S.city].stale) note.push('<span class="chip">FORECAST FROM ' + new Date(FX.data[S.city].at).toTimeString().slice(0, 5) + '</span>');
    $('#mapnote').innerHTML = note.join('');
    keepOut();
  }
  // wind for kite, rain for MTB and MX, unless the rider switched it
  function effLayer() { return S.layerSet ? S.layer : (S.sport === 'kite' ? 'wind' : 'rain'); }
  function drawTime() {
    var T = times(), el = $('#hour');
    if (!T.length) { $('#when').innerHTML = ''; $('#tlDays').innerHTML = ''; return; }
    if (S.hi == null || S.hi >= T.length) S.hi = defaultHour();
    el.max = T.length - 1; el.value = S.hi;
    var t = T[S.hi], isNow = t === S.today + 'T' + pad(S.nowH) + ':00';
    $('#when').innerHTML = esc(FX.dayName(t.slice(0, 10), S.today)) + ' ' + t.slice(11, 16) + (isNow ? '<small>NOW</small>' : '<small><button data-act="now">BACK TO NOW</button></small>');
    var ds = []; T.forEach(function (x, i) { if (x.slice(11, 13) === '12') ds.push(FX.dayName(x.slice(0, 10), S.today)); });
    $('#tlDays').innerHTML = ds.map(function (d) { return '<span>' + esc(d) + '</span>'; }).join('');
    $('#layerBtn').textContent = effLayer() === 'rain' ? 'WIND' : 'RAIN';
  }

  // ---------------------------------------------------------------- crews
  function allCrews() {
    var L = (S.live && S.live.crews) || [], C = HI8.crews || [], by = {};
    C.concat(L).forEach(function (c) { by[c.code] = Object.assign(by[c.code] || {}, c); });
    return Object.keys(by).map(function (k) { return by[k]; });
  }
  function upcoming(sport, days) {
    var last = FX.addDays(S.today, (days || 14) - 1), nowT = pad(S.nowH) + ':' + pad(S.nowM);
    return allCrews().filter(function (c) {
      if (c.city !== S.city || (sport && c.sport !== sport) || c.status !== 'on' || c.day < S.today || c.day > last) return false;
      if (c.day === S.today && !c.live && (c.end ? hm(c.end) : fromMin(minutes(c.start) + 180)) < nowT) return false;
      return true;
    }).sort(function (a, b) { return (a.day + a.start).localeCompare(b.day + b.start); });
  }
  function faces(c) {
    var I = c.initials || [], show = I.slice(0, 4);
    return '<span class="faces">' + show.map(function (x) { return '<i>' + esc(x) + '</i>'; }).join('') + (I.length > 4 ? '<i class="more">+' + (I.length - 4) + '</i>' : '') + '</span>';
  }
  function crewCard(c) {
    var f = crewFx(c), hub = c.meet_hub ? (HI8.hubsOf(c.city).filter(function (h) { return h.slug === c.meet_hub; })[0] || {}).name : null;
    var kiteTxt = f && c.sport === 'kite' ? f.w + ' KT ' + FX.compass(f.dir) + ' · ' : f && f.ground ? f.ground.toUpperCase() + ' · ' : '';
    return '<a class="card" href="?c=' + esc(c.code) + '" data-act="crew" data-code="' + esc(c.code) + '">' +
      '<div class="r1"><span>' + esc(dayRel(c.day)) + ' · ' + esc(hm(c.start)) + (c.end ? '–' + esc(hm(c.end)) : '') + '</span>' +
      (c.live ? '<span class="tag live">LIVE NOW</span>' : f ? tag(f, kiteTxt + f.label) : '<span class="tag none">FORECAST SOON</span>') + '</div>' +
      '<div class="nm">' + esc(SPORT[c.sport].em) + ' ' + esc(c.spot_name) + '</div>' +
      '<div class="r3">' + faces(c) + '<span>' + c.going + '/' + c.max + ' going</span>' +
      (c.seats_free > 0 ? '<span>· ' + c.seats_free + ' seat' + (c.seats_free > 1 ? 's' : '') + (hub ? ' from ' + esc(hub) : '') + (c.meet_time ? ' ' + esc(hm(c.meet_time)) : '') + '</span>' : '') +
      (c.here ? '<span>· ' + c.here + ' at the spot</span>' : '') + '</div>' +
      '<div class="r3" style="margin-top:4px">' + esc(CREW_LEVELS[c.levels] || '') + ' · ' + esc(c.host) + (c.host_plate ? ' #' + pad3(c.host_plate) : '') + '</div></a>';
  }
  function title(x) { return String(x || '').toLowerCase().replace(/(^|[\s'-])(\S)/g, function (m, a, b) { return a + b.toUpperCase(); }); }
  function pad3(n) { n = String(n); return n.length >= 3 ? n : ('00' + n).slice(-3); }

  // ---------------------------------------------------------------- landing sections
  function drawTop() {
    var c = cityObj(S.city);
    $('#cityName').textContent = (c.name || S.city).toUpperCase();
    $('#cityTag').textContent = S.settings && S.settings.pilot_city === S.city ? 'PILOT' : '';
    var pl = myPlate(), b = $('#plate');
    b.textContent = pl ? '#' + pad3(pl) : signedIn() ? 'ME' : 'ME';
    b.className = 'plate' + (pl ? '' : ' none');
    var live = (S.settings && S.settings.live_sports) || LIVE_SPORTS, soon = (S.settings && S.settings.soon_sports) || SOON;
    $('#sports').innerHTML = live.filter(function (k) { return SPORT[k]; }).map(function (k) {
      return '<button class="sp" data-act="sport" data-sport="' + k + '" aria-pressed="' + (k === S.sport) + '">' + SPORT[k].name.toUpperCase() + '</button>';
    }).join('') + (soon.length ? '<button class="sp soon" data-act="soon" data-sport="' + soon[0] + '">' + soon.map(function (k) { return SPORT[k] ? SPORT[k].name.toUpperCase() : k; }).join(' · ') + '<i>SOON</i></button>' : '');
  }
  function drawBest() {
    var el = $('#best'), spots = spotsFor(S.city, S.sport);
    if (!FX.data[S.city]) {
      el.innerHTML = '<h2>THE NEXT 3 DAYS</h2>' + (FX.error ? '<div class="empty"><h3>No forecast right now</h3><p>Open-Meteo can\'t be reached. Crews still work: join or start one.</p></div>' : '<div class="skel"></div>');
      return;
    }
    var days = FX.bestDays(S.city, spots, S.sport, { kg: kg() });
    var cand = days.filter(function (d) { return !d.none && d.score >= 4; }), top = Math.max.apply(null, cand.map(function (d) { return d.score; }).concat([0]));
    var good = cand.filter(function (d) { return d.score >= top - 0.7; })[0]; // the soonest one that's about as good as the best
    var hero = good ? '<button class="best" data-act="startwin" data-date="' + good.date + '" data-from="' + good.from + '" data-to="' + good.to + '" data-spot="' + good.spot.slug + '">' +
      '<div class="k">BEST WINDOW · NEXT 3 DAYS</div><div class="v">' + esc(dayRel(good.date)) + ' ' + pad(good.from) + '–' + pad(good.to) + '<br>' + esc(good.spot.name) + '</div>' +
      '<div class="s">' + (S.sport === 'kite' ? good.w + ' kt ' + FX.compass(good.dir) + ', gusts ' + good.g + ' · ' + (good.shore || '') + (good.kite ? ' · ' + good.kite + ' m kite for ' + kg() + ' kg' : '')
        : (good.ground || '') + ' · ' + good.temp + '°C') + (good.runTo - good.runFrom > good.to - good.from ? ' · good from ' + pad(good.runFrom) + ' to ' + pad(good.runTo) : '') + '</div>' +
      '<div class="foot2">' + tag(good) + '<span class="go">START A CREW FOR IT →</span></div></button>'
      : '<div class="empty"><h3>No good ' + esc(SPORT[S.sport].name) + ' window in 3 days</h3><p>' + (S.sport === 'kite' ? 'Not enough wind, or it blows offshore. ' : 'Rain or mud on the way. ') + 'You can still start a crew for any time.</p></div>';
    el.innerHTML = '<h2>' + esc(SPORT[S.sport].name) + ' FORECAST <small>' + esc(FX.MODEL_NAME[FX.CITY_MODEL[S.city]] || 'BEST MATCH') + ' + 3 MODELS</small></h2>' + hero +
      '<div class="days3">' + days.map(function (d) {
        if (d.none) return '<button class="dcard" data-act="seeday" data-date="' + d.date + '"><div class="k">' + esc(FX.dayName(d.date, S.today)) + '</div><div class="v">NO GO</div><div class="s">' + (S.sport === 'kite' ? 'too light or offshore' : 'rain or mud') + '</div></button>';
        return '<button class="dcard" data-act="seeday" data-date="' + d.date + '" data-from="' + d.from + '"><div class="k">' + esc(FX.dayName(d.date, S.today)) + ' ' + tag(d) + '</div>' +
          '<div class="v">' + pad(d.from) + '–' + pad(d.to) + '</div><div class="s">' + esc(d.spot.name) + '<br>' + (S.sport === 'kite' ? d.w + ' kt ' + FX.compass(d.dir) : esc(d.ground || '') + ' · ' + d.temp + '°C') + '</div></button>';
      }).join('') + '</div>';
  }
  function drawCrews() {
    var el = $('#crews');
    if (!HI8.live) { el.innerHTML = '<h2>CREWS</h2><div class="empty"><h3>Crews need the live site</h3><p>Open hi8ctane.com to see and start crews.</p></div>'; return; }
    var list = upcoming(S.sport, 14);
    var title = '<h2>' + esc(SPORT[S.sport].name) + ' CREWS <small>' + list.length + ' COMING UP</small>' + (list.length > 4 ? '<a href="#join" data-act="join">SEE ALL</a>' : '') + '</h2>';
    if (!HI8.crews && !S.live) { el.innerHTML = title + '<div class="crews"><div class="skel"></div><div class="skel"></div></div>'; return; }
    el.innerHTML = title + (list.length ? '<div class="crews">' + list.slice(0, 4).map(crewCard).join('') + '</div>' : emptyCrews());
  }
  function emptyCrews() {
    return '<div class="empty"><h3>No ' + esc(SPORT[S.sport].name) + ' crews yet in ' + esc(cityObj(S.city).name) + '</h3>' +
      '<p>Start the first one: pick a window, a spot, share it to your group chats. Takes 20 seconds.</p>' +
      '<button class="big start" data-act="start" style="width:100%">START A CREW</button>' + alertBox() + '</div>';
  }
  function alertBox() {
    var mine = (HI8.mine && HI8.mine.alerts) || [], on = mine.some(function (a) { return a.city === S.city && a.sport === S.sport; });
    if (signedIn()) {
      return '<p style="margin:14px 0 8px">' + (on ? 'You get an email when someone posts a ' + esc(SPORT[S.sport].name) + ' crew here.' : 'Get an email when someone posts a ' + esc(SPORT[S.sport].name) + ' crew here:') + '</p>' +
        '<button class="big ' + (on ? 'ghost' : 'dark') + '" data-act="alert" data-on="' + (!on) + '" style="width:100%;font-size:17px">' + (on ? 'STOP THESE EMAILS' : 'EMAIL ME NEW ' + esc(SPORT[S.sport].name.toUpperCase()) + ' CREWS') + '</button>';
    }
    return '<p style="margin:14px 0 8px">Or get an email when someone posts a ' + esc(SPORT[S.sport].name) + ' crew here:</p>' +
      '<form class="send" data-form="alert"><label class="sr" for="alertEmail">Email</label><input class="inp" id="alertEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com" required><button type="submit">ALERT ME</button></form>' +
      '<p class="hint">You get a founding plate with it. One click stops the emails.</p>';
  }
  function drawLive() {
    var el = $('#live'), L = S.live;
    var reps = L ? (L.reports || []).filter(function (r) { return r.sport === S.sport; }) : [];
    var on = upcoming(S.sport, 1).filter(function (c) { return c.live; });
    if (!reps.length && !on.length) { el.innerHTML = ''; return; }
    el.innerHTML = '<h2>AT THE SPOTS NOW</h2><div class="reports">' + on.map(function (c) {
      return '<a class="rep" href="?c=' + esc(c.code) + '" data-act="crew" data-code="' + esc(c.code) + '"><span class="tag live">LIVE</span><span>' + esc(c.spot_name) + ' · ' + c.going + ' going' + (c.here ? ', ' + c.here + ' there' : '') + '</span><small>' + esc(hm(c.start)) + '</small></a>';
    }).join('') + latestPerSpot(reps).map(function (r) {
      var s = HI8.spot(r.spot);
      return '<button class="rep" data-act="spot" data-spot="' + esc(r.spot) + '">' + '<span class="tag ' + (r.verdict === 'on' ? 'epic' : r.verdict === 'meh' ? 'ok' : 'no') + '">' + r.verdict.toUpperCase() + '</span><span>' + esc(s ? s.name : r.spot) +
        (r.kite ? ' · on a ' + r.kite + ' m' : '') + (r.ground ? ' · ' + esc(r.ground) : '') + (r.n > 1 ? ' · ' + r.n + ' reports' : '') + '</span><small>' + esc(ago(r.at)) + '</small></button>';
    }).join('') + '</div>';
  }
  function latestPerSpot(reps) { // newest first in, newest kept; counts the rest
    var by = {}, out = [];
    reps.forEach(function (r) { if (!by[r.spot]) { by[r.spot] = Object.assign({ n: 0 }, r); out.push(by[r.spot]); } by[r.spot].n++; });
    return out;
  }
  function drawAll() {
    refreshToday(); drawTop(); drawTime(); drawMapSpots(); drawBest(); drawCrews(); drawLive();
    if (S.view) renderSheet();
  }

  // ---------------------------------------------------------------- sheets (join, start, crew, spot, me, city, soon)
  var sheet = null;
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function closeSheet() {
    if (S.view === 'crew') { history.replaceState(null, '', location.pathname + (S.variant !== 'map' ? '?v=' + S.variant : '')); }
    S.view = null; S.crew = null; stopChat();
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    sheet.className = 'sheet'; sheet.innerHTML = ''; document.title = 'Hi8ctane · ride together';
  }
  function route() {
    var h = location.hash.replace(/^#/, ''), c = new URLSearchParams(location.search).get('c');
    if (c) { if (!S.crew || S.crew.code !== c.toUpperCase()) openCrew(c, h === 'chat'); return; }
    if (h === 'join') { S.view = 'join'; }
    else if (h === 'start') {
      S.view = 'start';
      if (!S.sf) { // from a link: ?spot=…&sport=…#start
        var q = new URLSearchParams(location.search), sp = q.get('sport') || q.get('sp');
        if (sp && LIVE_SPORTS.indexOf(sp) >= 0 && sp !== S.sport) setSport(sp);
        newStart({ spot: q.get('spot') || null, sport: sp && LIVE_SPORTS.indexOf(sp) >= 0 ? sp : null });
      }
    }
    else if (h === 'me') { S.view = 'me'; if (signedIn()) HI8.loadMine(true).then(renderSheet, noop); }
    else if (h === 'city') { S.view = 'city'; }
    else if (/^spot\//.test(h)) { S.view = 'spot'; S.spotSlug = h.slice(5); S.spotDay = S.spotDay || 0; }
    else if (/^soon\//.test(h)) { S.view = 'soon'; S.soonSport = h.slice(5); }
    else { if (S.view) closeSheet(); return; }
    renderSheet();
  }
  function renderSheet() {
    if (!S.view) return;
    var fn = { join: sheetJoin, start: sheetStart, crew: sheetCrew, spot: sheetSpot, me: sheetMe, city: sheetCity, soon: sheetSoon }[S.view];
    if (!fn) return;
    var keep = sheet.querySelector('.sh-body'), top = keep ? keep.scrollTop : 0, focus = document.activeElement && document.activeElement.id;
    var vals = {}; sheet.querySelectorAll('input[id],textarea[id]').forEach(function (i) { vals[i.id] = i.value; });
    sheet.innerHTML = fn();
    sheet.className = 'sheet on';
    Object.keys(vals).forEach(function (id) { var i = document.getElementById(id); if (i && !i.hasAttribute('data-fixed') && i.value === '' && vals[id]) i.value = vals[id]; });
    var b = sheet.querySelector('.sh-body'); if (b) b.scrollTop = top;
    if (focus && document.getElementById(focus) && /INPUT|TEXTAREA/.test(document.getElementById(focus).tagName)) document.getElementById(focus).focus();
  }
  function shell(title, body, foot, back) {
    return '<div class="sh-top"><button class="x" data-act="close" aria-label="' + (back ? 'Back' : 'Close') + '">' + (back ? '←' : '✕') + '</button><h1 id="shTitle">' + title + '</h1></div>' +
      '<div class="sh-body">' + body + '</div>' + (foot ? '<div class="sh-foot">' + foot + '</div>' : '');
  }

  // ---- JOIN A CREW
  function sheetJoin() {
    var list = upcoming(S.sport, 14), dates = [];
    list.forEach(function (c) { if (dates.indexOf(c.day) < 0) dates.push(c.day); });
    var shown = S.joinDay === 'all' ? list : list.filter(function (c) { return c.day === S.joinDay; });
    var tabs = '<div class="tabs" role="group" aria-label="Day"><button class="tab" data-act="joinday" data-day="all" aria-pressed="' + (S.joinDay === 'all') + '">ALL</button>' +
      dates.map(function (d) { return '<button class="tab" data-act="joinday" data-day="' + d + '" aria-pressed="' + (S.joinDay === d) + '">' + esc(dayRel(d)) + '</button>'; }).join('') + '</div>';
    var sp = '<div class="tabs" role="group" aria-label="Sport">' + LIVE_SPORTS.map(function (k) { return '<button class="tab" data-act="sport" data-sport="' + k + '" aria-pressed="' + (k === S.sport) + '">' + SPORT[k].name.toUpperCase() + '</button>'; }).join('') + '</div>';
    var body = sp + (list.length ? tabs + '<div class="sec"><div class="crews">' + shown.map(crewCard).join('') + '</div></div>' : '<div class="sec">' + emptyCrews() + '</div>');
    return shell('JOIN A CREW · ' + esc(cityObj(S.city).name), body, list.length ? '<button class="big start" data-act="start">OR START ONE</button>' : '');
  }

  // ---- START A CREW
  function nearestHub(spot) {
    var hubs = HI8.hubsOf(S.city), best = null;
    hubs.forEach(function (h) { var d = HI8.km(h, spot); if (!best || d < best.d) best = { h: h, d: d }; });
    return best ? best.h : null;
  }
  function newStart(o) {
    var sport = o.sport || S.sport, spots = spotsFor(S.city, sport), mine = HI8.mine || {};
    var f = { init: o, touched: false, sport: sport, date: o.date || null, from: o.from != null ? Number(o.from) : null, to: o.to != null ? Number(o.to) : null, custom: false, spot: o.spot || null,
      getting: 'drive', seats: 3, hub: null, meet: null, meetAuto: true, levels: 'regular', note: '', level: HI8.store.get('lv.' + sport, 'regular'), max: 8, force: false, err: null, dup: null, done: null, busy: false };
    if (!f.date) {
      var best = FX.data[S.city] ? FX.bestDays(S.city, spots, sport, { kg: kg() }).filter(function (d) { return !d.none && d.score >= 6; })[0] : null;
      if (best) { f.date = best.date; f.from = best.from; f.to = best.to; if (!f.spot) f.spot = best.spot.slug; }
      else { f.custom = true; f.date = S.nowH >= 15 ? FX.addDays(S.today, 1) : S.today; f.from = sport === 'kite' ? 13 : 10; f.to = f.from + 3; if (f.date === S.today && f.from <= S.nowH) { f.date = FX.addDays(S.today, 1); } }
    }
    if (!f.spot || !spots.some(function (s) { return s.slug === f.spot; })) {
      var rank = FX.rankSpots(S.city, spots, sport, f.date, f.from, f.to, { kg: kg() });
      f.spot = rank[0] ? rank[0].spot.slug : (spots[0] || {}).slug;
    }
    S.sf = f; autoMeet();
  }
  function autoMeet() {
    var f = S.sf, spot = HI8.spot(f.spot); if (!spot) return;
    if (!f.hub || !HI8.hubsOf(S.city).some(function (h) { return h.slug === f.hub; })) { var h = nearestHub(spot); f.hub = h ? h.slug : null; }
    if (f.meetAuto) {
      var hub = HI8.hubsOf(S.city).filter(function (h) { return h.slug === f.hub; })[0];
      if (hub) { var m = f.from * 60 - HI8.driveMin(hub, spot) - 10; m = Math.floor(m / 5) * 5; f.meet = fromMin(Math.max(5 * 60, m)); }
    }
  }
  function whenChips(f) {
    var spots = spotsFor(S.city, f.sport), days = FX.data[S.city] ? FX.bestDays(S.city, spots, f.sport, { kg: kg() }) : [];
    var chips = days.filter(function (d) { return !d.none; }).map(function (d) {
      var on = !f.custom && f.date === d.date && f.from === d.from && f.to === d.to;
      return '<button class="opt" data-act="sfwin" data-date="' + d.date + '" data-from="' + d.from + '" data-to="' + d.to + '" aria-pressed="' + on + '">' + esc(dayRel(d.date)) + ' ' + pad(d.from) + '–' + pad(d.to) +
        '<small>' + (f.sport === 'kite' ? d.w + ' kt ' + FX.compass(d.dir) + ' · ' : esc(d.ground || '') + ' · ') + esc(d.label) + ' at ' + esc(d.spot.name) + '</small></button>';
    });
    chips.push('<button class="opt" data-act="sfcustom" aria-pressed="' + f.custom + '">OTHER TIME<small>any day, any hour</small></button>');
    var out = '<div class="row">' + chips.join('') + '</div>';
    if (f.custom) {
      var ds = []; for (var i = 0; i < 14; i++) ds.push(FX.addDays(S.today, i));
      var hrs = []; for (var h = 6; h <= 21; h++) hrs.push(h);
      out += '<div class="row" style="margin-top:10px;overflow-x:auto;flex-wrap:nowrap">' + ds.map(function (d) { return '<button class="tab" data-act="sfday" data-date="' + d + '" aria-pressed="' + (f.date === d) + '">' + esc(dayRel(d)) + '</button>'; }).join('') + '</div>' +
        '<div class="two" style="margin-top:10px"><label><span class="sr">From</span><select class="inp" id="sfFrom" data-change="sffrom">' + hrs.map(function (h) { return '<option value="' + h + '"' + (h === f.from ? ' selected' : '') + '>FROM ' + pad(h) + ':00</option>'; }).join('') + '</select></label>' +
        '<label><span class="sr">Until</span><select class="inp" id="sfTo" data-change="sfto">' + hrs.concat([22]).filter(function (h) { return h > f.from; }).map(function (h) { return '<option value="' + h + '"' + (h === f.to ? ' selected' : '') + '>UNTIL ' + pad(h) + ':00</option>'; }).join('') + '</select></label></div>';
    }
    return out;
  }
  function sheetStart() {
    var f = S.sf;
    if (f.done) return startDone(f.done);
    var spots = spotsFor(S.city, f.sport), rank = FX.rankSpots(S.city, spots, f.sport, f.date, f.from, f.to, { kg: kg() });
    var cap = HI8.mine && HI8.mine.captain, me = signedIn();
    var body = '<div class="f"><span class="lb">SPORT</span><div class="row">' + LIVE_SPORTS.map(function (k) { return '<button class="opt" data-act="sfsport" data-sport="' + k + '" aria-pressed="' + (f.sport === k) + '">' + esc(SPORT[k].em + ' ' + SPORT[k].name.toUpperCase()) + '</button>'; }).join('') + '</div></div>' +
      '<div class="f"><span class="lb">WHEN <small>the best windows from the forecast</small></span>' + whenChips(f) + '</div>' +
      '<div class="f"><span class="lb">WHERE <small>ranked for ' + esc(dayRel(f.date)) + ' ' + pad(f.from) + '–' + pad(f.to) + '</small></span><div class="row">' + rank.map(function (x) {
        var s = x.spot, fx = x.fx, hub = nearestHub(s);
        var sub = fx ? (f.sport === 'kite' ? fx.w + ' kt ' + FX.compass(fx.dir) + ', gusts ' + fx.g + (fx.shore ? ' · ' + fx.shore : '') : (fx.ground || '') + ' · ' + fx.temp + '°C') : 'no forecast that far yet';
        return '<button class="opt wide" data-act="sfspot" data-spot="' + s.slug + '" aria-pressed="' + (f.spot === s.slug) + '"><span>' + esc(s.name.toUpperCase()) + '<small>' + esc(sub) + (hub ? ' · ' + HI8.driveMin(hub, s) + ' min from ' + esc(title(hub.name)) : '') + '</small></span>' + (fx ? tag(fx) : '<span class="tag none">–</span>') + '</button>';
      }).join('') + '</div>' + (HI8.spot(f.spot) && HI8.spot(f.spot).note ? '<p class="hint">' + esc(HI8.spot(f.spot).note) + '</p>' : '') + '</div>' +
      '<div class="f"><span class="lb">HOW YOU GET THERE</span><div class="row">' +
      [['drive', "I'M DRIVING", 'others can ride with you'], ['own', 'OWN WAY', 'meet at the spot'], ['seat', 'I NEED A SEAT', 'a driver picks you up']].map(function (o) {
        return '<button class="opt" data-act="sfget" data-v="' + o[0] + '" aria-pressed="' + (f.getting === o[0]) + '">' + o[1] + '<small>' + o[2] + '</small></button>';
      }).join('') + '</div>' +
      (f.getting === 'drive' ? '<div class="row" style="margin-top:10px;align-items:center"><span class="lb" style="margin:0 6px 0 0">FREE SEATS</span><span class="step"><button data-act="sfseats" data-d="-1" aria-label="Fewer seats">−</button><b>' + f.seats + '</b><button data-act="sfseats" data-d="1" aria-label="More seats">+</button></span></div>' : '') +
      (f.getting !== 'own' ? '<div style="margin-top:12px"><span class="lb">' + (f.getting === 'drive' ? 'PICK UP AT' : 'MEET AT') + '</span><div class="row">' + HI8.hubsOf(S.city).map(function (h) {
        return '<button class="opt" data-act="sfhub" data-hub="' + h.slug + '" aria-pressed="' + (f.hub === h.slug) + '">' + esc(h.name) + '<small>' + esc(h.sub || '') + '</small></button>';
      }).join('') + '</div><div class="two" style="margin-top:10px;align-items:center"><label class="lb" for="sfMeet" style="margin:0">LEAVING AT</label><input class="inp" id="sfMeet" data-fixed type="time" step="300" value="' + esc(f.meet || '') + '" data-change="sfmeet"></div>' +
        '<p class="hint">Set from the drive time. Change it if you like.</p></div>' : '') + '</div>' +
      '<div class="f"><span class="lb">WHO CAN JOIN</span><div class="row">' + (cap ? [['regular', 'RIDE SOLO', 'riders who ride on their own'], ['all', 'ALL LEVELS', 'rookies welcome, you look after them'], ['rookie', 'ROOKIE SESSION', 'for learners']] : [['regular', 'RIDERS WHO RIDE SOLO', 'everyone rides on their own']]).map(function (o) {
        return '<button class="opt" data-act="sflevels" data-v="' + o[0] + '" aria-pressed="' + (f.levels === o[0]) + '">' + o[1] + '<small>' + o[2] + '</small></button>';
      }).join('') + '</div>' + (cap ? '' : '<p class="hint">Crews with rookies are run by our captains.</p>') + '</div>' +
      '<div class="f"><label for="sfNote">NOTE <small style="font-weight:400;letter-spacing:0;text-transform:none;color:var(--mute)">optional</small></label><textarea class="inp" id="sfNote" maxlength="280" placeholder="' + esc({ kite: 'Launching at the north end. Bring a 9.', mtb: 'Loop of about 30 km, 800 m up. Lights for the way back.', mx: 'Open practice. Bring your licence or buy day insurance.' }[f.sport]) + '"></textarea></div>' +
      (me ? '' : '<div class="f"><span class="lb">YOU <small>your founding plate comes with it</small></span><div style="display:grid;gap:8px">' +
        '<label class="sr" for="sfEmail">Email</label><input class="inp" id="sfEmail" type="email" inputmode="email" autocomplete="email" placeholder="Email (only the app sees it)">' +
        '<label class="sr" for="sfName">Rider name</label><input class="inp" id="sfName" autocomplete="nickname" maxlength="40" placeholder="Rider name (what the crew sees)"></div>' +
        '<span class="lb" style="margin-top:12px">YOUR LEVEL</span><div class="row">' + ['regular', 'ripper'].map(function (l) { return '<button class="opt" data-act="sflevel" data-v="' + l + '" aria-pressed="' + (f.level === l) + '">' + LEVEL[l] + '<small>' + LEVEL_SUB[l] + '</small></button>'; }).join('') + '</div></div>') +
      (f.dup ? '<div class="warn" id="dup"><b>Already up:</b> ' + esc(String(f.dup.hint || '').replace(/^There's already a crew for that: /, '')) + '<div class="row"><button class="opt" data-act="crew" data-code="' + esc(f.dup.code) + '">JOIN IT</button><button class="opt" data-act="sfforce">POST MINE ANYWAY</button></div></div>' : '') +
      (f.err ? '<div class="err" role="alert">' + f.err + '</div>' : '') +
      '<p class="note">By posting you agree to the <a href="terms/">terms</a>: every session is each rider\'s own call. The spot\'s rules apply.</p>';
    return shell('START A CREW', body, '<button class="big start" data-act="sfpost"' + (f.busy ? ' disabled' : '') + '>' + (f.busy ? '<span class="spin"></span>' : 'POST THE CREW') + '</button>');
  }
  function crewUrl(code) { return location.origin + location.pathname.replace(/[^/]*$/, '') + '?c=' + code; }
  function shareText(c) {
    var f = crewFx(c), hub = c.meet_hub ? (HI8.hubsOf(c.city).filter(function (h) { return h.slug === c.meet_hub; })[0] || {}).name : null;
    var L = [SPORT[c.sport].em + ' ' + SPORT[c.sport].name.toUpperCase() + ' CREW · ' + dayRel(c.day) + ' ' + hm(c.start) + (c.end ? '–' + hm(c.end) : ''), '📍 ' + c.spot_name];
    if (f) L.push(c.sport === 'kite' ? '🌬️ ' + f.w + ' kt ' + FX.compass(f.dir) + ', gusts ' + f.g + ' · ' + f.label : '🌤️ ' + (f.ground ? f.ground + ' · ' : '') + f.temp + '°C · ' + f.label);
    if (c.seats_free > 0) L.push('🚗 ' + c.seats_free + ' seat' + (c.seats_free > 1 ? 's' : '') + ' free' + (hub ? ' from ' + title(hub) : '') + (c.meet_time ? ' at ' + hm(c.meet_time) : ''));
    L.push('👥 ' + c.going + '/' + c.max + ' going · ' + (CREW_LEVELS[c.levels] || '').toLowerCase());
    L.push('Join in one tap: ' + crewUrl(c.code));
    return L.join('\n');
  }
  function startDone(c) {
    var txt = shareText(c);
    return shell('YOUR CREW IS UP', '<div class="ok-box"><b>' + esc(SPORT[c.sport].em + ' ' + c.spot_name.toUpperCase() + ' · ' + dayRel(c.day) + ' ' + hm(c.start)) + '</b><br>Now get people in: share it to your group chats. They join in one tap, no app to install.</div>' +
      '<div class="f"><span class="lb">THE MESSAGE</span><pre class="box" style="margin:0;white-space:pre-wrap;font:400 12.5px/1.5 var(--mono)">' + esc(txt) + '</pre></div>' +
      '<div class="f"><div style="display:grid;gap:8px"><a class="big wa" href="https://wa.me/?text=' + encodeURIComponent(txt) + '" target="_blank" rel="noopener" data-act="shared">SHARE TO WHATSAPP</a>' +
      '<button class="big ghost" data-act="copy" data-text="' + esc(txt) + '">COPY THE MESSAGE</button>' + (navigator.share ? '<button class="big ghost" data-act="nshare" data-code="' + esc(c.code) + '">MORE APPS</button>' : '') + '</div></div>',
      '<button class="big join" data-act="crew" data-code="' + esc(c.code) + '">OPEN THE CREW</button>');
  }

  // ---- A CREW
  function openCrew(code, chat) {
    code = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    S.view = 'crew'; S.crew = { code: code, data: null, err: null, msgs: [], after: 0, chat: !!chat, confirm: null };
    S.jf = null;
    if (new URLSearchParams(location.search).get('c') !== code) history.pushState(null, '', '?c=' + code + (chat ? '#chat' : ''));
    renderSheet(); loadCrew();
  }
  function loadCrew() {
    var C = S.crew; if (!C) return Promise.resolve();
    var k = HI8.me().key;
    return HI8.rpc('hi8_crew', { p_code: C.code, p_key: k || null }).catch(function (e) {
      if (e.message === 'unknown_key') { HI8.store.del('me'); return HI8.rpc('hi8_crew', { p_code: C.code, p_key: null }); }
      throw e;
    }).then(function (d) {
      if (!S.crew || S.crew.code !== C.code) return;
      C.data = d; C.err = null;
      document.title = SPORT[d.sport].name + ' crew · ' + d.spot_name + ' · ' + dayRel(d.day) + ' ' + hm(d.start);
      if (d.city !== S.city) { S.city = d.city; drawAll(); initMap(); loadForecast(); }
      if (d.me) startChat();
      renderSheet();
      if (C.chat && d.me) setTimeout(function () { var el = $('#chatBox'); if (el) el.scrollIntoView({ block: 'center' }); }, 60);
    }, function (e) { if (S.crew === C) { C.err = errText(e); renderSheet(); } });
  }
  var chatTimer = null, crewTimer = null;
  function startChat() {
    if (chatTimer) return;
    pollChat();
    chatTimer = setInterval(function () { if (!document.hidden) pollChat(); }, 7000);
    crewTimer = setInterval(function () { if (!document.hidden) loadCrew(); }, 30000);
  }
  function stopChat() { clearInterval(chatTimer); clearInterval(crewTimer); chatTimer = crewTimer = null; }
  function pollChat() {
    var C = S.crew; if (!C || !C.data || !C.data.me) return;
    HI8.withKey('hi8_messages', { p_code: C.code, p_after: C.after }, { noQueue: true }).then(function (m) {
      if (S.crew !== C || !m || !m.length) return;
      C.msgs = C.msgs.concat(m.filter(function (x) { return x.id > C.after; })); C.after = C.msgs[C.msgs.length - 1].id;
      var box = $('#chatBox'); if (box) { box.innerHTML = chatHtml(C.msgs); box.scrollTop = box.scrollHeight; }
      if (m.some(function (x) { return x.kind !== 'msg'; })) loadCrew();
    }, noop);
  }
  function chatHtml(ms) {
    if (!ms.length) return '<div class="msg sys">No messages yet. Say hi, sort the cars, share the meeting point.</div>';
    return ms.map(function (x) {
      if (x.kind !== 'msg') return '<div class="msg sys">' + esc(x.body) + ' · ' + esc(new Date(x.at).toTimeString().slice(0, 5)) + '</div>';
      return '<div class="msg' + (x.mine ? ' mine' : '') + '">' + (x.mine ? '' : '<b>' + esc(x.name) + '</b>') + esc(x.body) + '</div>';
    }).join('');
  }
  function crewStrip(c, f) {
    if (!f) return '<p class="hint" style="padding:10px 16px 0">' + (FX.error ? 'No forecast right now.' : FX.data[S.city] ? 'The forecast reaches 3 days out: it shows here closer to the day.' : '<span class="spin"></span> Loading the forecast…') + '</p>';
    return '<div class="strip">' + f.rows.map(function (r) {
      var col = r.rate ? 'var(--' + (FX.tone(r.rate.s) === 'none' ? 'no' : FX.tone(r.rate.s)) + ')' : 'var(--no)';
      return '<div class="hcell"><div class="t">' + pad(r.h) + ':00</div>' + (c.sport === 'kite' ? '<div class="w" style="color:' + window.HI8_WIND_COLOR(r.w) + ';-webkit-text-stroke:.5px #111">' + Math.round(r.w) + '</div><div class="g">G' + Math.round(r.g || r.w) + '</div>' + arrow(r.dir)
        : '<div class="w">' + Math.round(r.temp) + '°</div><div class="g">' + (r.mm ? r.mm + 'MM' : 'DRY') + '</div>' + arrow(r.dir)) + '<div class="bar" style="background:' + col + '"></div></div>';
    }).join('') + '</div><div class="facts">' + tag(f) +
      (c.sport === 'kite' ? '<span class="tag">' + f.w + ' KT ' + FX.compass(f.dir) + '</span><span class="tag">GUSTS ' + f.g + '</span>' + (f.shore ? '<span class="tag">' + esc(f.shore.toUpperCase()) + '</span>' : '') + (f.kite ? '<span class="tag">' + f.kite + ' M KITE FOR ' + kg() + ' KG</span>' : '')
        : '<span class="tag">' + esc((f.ground || '').toUpperCase()) + '</span><span class="tag">' + f.temp + '°C</span>') +
      (f.agree ? '<span class="tag">' + (f.agree === 'agree' ? '4 MODELS AGREE' : f.agree === 'roughly' ? 'MODELS ROUGHLY AGREE' : 'MODELS DISAGREE: CHECK AGAIN') + '</span>' : '') + '</div>' +
      (f.why && f.why.length ? '<p class="hint" style="padding:0 16px">' + esc(f.why.join(' · ')) + '</p>' : '');
  }
  function membersHtml(c) {
    var M = c.members || [], cars = M.filter(function (m) { return m.getting === 'drive'; });
    var hubName = c.meet_hub ? (HI8.hubsOf(c.city).filter(function (h) { return h.slug === c.meet_hub; })[0] || {}).name : null;
    var who = '<div class="who">' + M.map(function (m) {
      var how = m.getting === 'drive' ? 'drives · ' + m.seats + ' seat' + (m.seats === 1 ? '' : 's') : m.getting === 'seat' ? (m.car_with ? 'rides with ' + esc((M.filter(function (x) { return x.member_id === m.car_with; })[0] || {}).name || 'a driver') : 'needs a seat') : 'own way';
      return '<div class="p"><span class="av' + (m.here ? ' here' : '') + '">' + esc(String(m.name).slice(0, 2).toUpperCase()) + '</span><span><b>' + esc(m.name) + '</b>' + (m.host ? ' · captain' : '') + (m.me ? ' · you' : '') + '<br><span style="color:var(--mute)">' + esc(LEVEL[m.level] || '') + (m.here ? ' · at the spot' : '') + '</span></span><small>' + how + '</small></div>';
    }).join('') + '</div>';
    var carHtml = cars.map(function (d) {
      var ps = M.filter(function (m) { return m.car_with === d.member_id; });
      return '<div class="car">🚗 <b>' + esc(d.name) + '</b>' + (hubName ? ' from ' + esc(hubName) : '') + (c.meet_time ? ' at ' + esc(hm(c.meet_time)) : '') + ' · ' + (ps.length ? 'with ' + ps.map(function (p) { return esc(p.name); }).join(', ') : 'nobody yet') + ' · ' + Math.max(0, d.seats - ps.length) + ' free</div>';
    }).join('');
    return who + carHtml;
  }
  function payHtml(c) {
    var me = c.me, M = c.members || [];
    if (me.getting === 'drive') {
      var ps = M.filter(function (m) { return m.car_with === me.member_id; });
      if (!ps.length) return '';
      return '<div class="box"><h3>SETTLE UP <small style="font-weight:400;letter-spacing:0">fuel + tolls + parking</small></h3>' +
        '<div class="two"><label><span class="sr">What the car cost (€)</span><input class="inp" id="payCost" type="number" inputmode="decimal" min="0" max="500" step="0.5" placeholder="€ total" value="' + (me.trip_cost != null ? me.trip_cost : '') + '"></label>' +
        '<label><span class="sr">Bizum number</span><input class="inp" id="payBizum" inputmode="tel" placeholder="Bizum 6XX XXX XXX" value="' + esc(me.bizum ? me.bizum.replace(/^\+34/, '') : '') + '"></label></div>' +
        '<label class="sr" for="payLink">Payment link</label><input class="inp" id="payLink" style="margin-top:8px" inputmode="url" placeholder="or a Revolut / PayPal link" value="' + esc(me.pay_link || '') + '">' +
        '<p class="hint">Split between you and ' + ps.length + ' rider' + (ps.length > 1 ? 's' : '') + ': €' + (me.trip_cost != null ? (me.trip_cost / (ps.length + 1)).toFixed(2) : '–') + ' each. Your Bizum number is shown only to the riders in your car. Paid: ' +
        ps.map(function (p) { return esc(p.name) + (p.paid ? ' ✓' : ' ·'); }).join(' ') + '</p>' +
        '<button class="big dark" data-act="settle" style="width:100%;margin-top:6px;font-size:17px">SAVE + TELL MY CAR</button></div>';
    }
    if (me.car_with) {
      var d = M.filter(function (m) { return m.member_id === me.car_with; })[0];
      if (!d || d.share == null) return d ? '<div class="box"><h3>YOUR RIDE</h3><p class="hint" style="margin:0">You ride with ' + esc(d.name) + '. When they add what the car cost, your share shows here.</p></div>' : '';
      return '<div class="box"><h3>YOUR SHARE <span class="tag ' + (me.paid ? 'epic' : 'ok') + '">' + (me.paid ? 'PAID' : '€' + Number(d.share).toFixed(2)) + '</span></h3>' +
        '<p class="hint" style="margin:0 0 10px">' + esc(d.name) + "'s car: €" + Number(d.trip_cost).toFixed(2) + ' split ' + Math.round(d.trip_cost / d.share) + ' ways.</p><div style="display:grid;gap:8px">' +
        (d.bizum ? '<button class="big ghost" data-act="copy" data-text="' + esc(d.bizum.replace(/^\+34/, '')) + '" style="font-size:17px">BIZUM ' + esc(d.bizum.replace(/^\+34(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3')) + ' · COPY</button>' : '') +
        (d.pay_link ? '<a class="big ghost" href="' + esc(d.pay_link) + '" target="_blank" rel="noopener" style="font-size:17px">PAY €' + Number(d.share).toFixed(2) + ' →</a>' : '') +
        '<button class="big ' + (me.paid ? 'ghost' : 'join') + '" data-act="paid" data-v="' + (!me.paid) + '" style="font-size:17px">' + (me.paid ? 'UNDO "PAID"' : "I'VE PAID") + '</button></div></div>';
    }
    return '';
  }
  function joinForm(c) {
    var f = S.jf, me = signedIn();
    var lvls = c.levels === 'rookie' ? ['rookie'] : c.levels === 'all' ? ['rookie', 'regular', 'ripper'] : ['regular', 'ripper'];
    if (lvls.indexOf(f.level) < 0) f.level = lvls[0];
    return '<div class="box" id="joinForm"><h3>' + (c.me ? 'CHANGE HOW YOU\'RE IN' : 'JOIN THIS CREW') + '</h3>' +
      (me || c.me ? '' : '<div style="display:grid;gap:8px;margin-bottom:12px"><label class="sr" for="jfEmail">Email</label><input class="inp" id="jfEmail" type="email" inputmode="email" autocomplete="email" placeholder="Email (only the app sees it)">' +
        '<label class="sr" for="jfName">Rider name</label><input class="inp" id="jfName" autocomplete="nickname" maxlength="40" placeholder="Rider name (what the crew sees)"></div>') +
      '<span class="lb">YOUR LEVEL</span><div class="row">' + lvls.map(function (l) { return '<button class="opt" data-act="jflevel" data-v="' + l + '" aria-pressed="' + (f.level === l) + '">' + LEVEL[l] + '<small>' + LEVEL_SUB[l] + '</small></button>'; }).join('') + '</div>' +
      (c.levels === 'regular' ? '<p class="hint">This crew is for riders who ride on their own.</p>' : '') +
      '<span class="lb" style="margin-top:12px">HOW YOU GET THERE</span><div class="row">' +
      [['seat', 'NEED A SEAT', c.seats_free > 0 ? c.seats_free + ' free now' : 'no free seats yet'], ['drive', "I'LL DRIVE", 'take others'], ['own', 'OWN WAY', 'meet at the spot']].map(function (o) {
        return '<button class="opt" data-act="jfget" data-v="' + o[0] + '" aria-pressed="' + (f.getting === o[0]) + '">' + o[1] + '<small>' + o[2] + '</small></button>';
      }).join('') + '</div>' +
      (f.getting === 'drive' ? '<div class="row" style="margin-top:10px;align-items:center"><span class="lb" style="margin:0 6px 0 0">FREE SEATS</span><span class="step"><button data-act="jfseats" data-d="-1" aria-label="Fewer seats">−</button><b>' + f.seats + '</b><button data-act="jfseats" data-d="1" aria-label="More seats">+</button></span></div>' : '') +
      (f.getting === 'seat' && !c.seats_free ? '<p class="hint">No free seat yet: you\'ll be on the list, and the first driver who joins takes you.</p>' : '') +
      (f.err ? '<div class="err" role="alert" style="margin:10px 0 0">' + f.err + '</div>' : '') +
      '<button class="big join" data-act="jfgo" style="width:100%;margin-top:12px"' + (f.busy ? ' disabled' : '') + '>' + (f.busy ? '<span class="spin"></span>' : c.me ? 'SAVE' : "I'M IN") + '</button>' +
      (me || c.me ? '' : '<p class="hint">Your founding plate comes with it. By joining you agree to the <a href="terms/">terms</a>.</p>') + '</div>';
  }
  function sheetCrew() {
    var C = S.crew;
    if (!C.data) return shell('CREW', C.err ? '<div class="err" role="alert">' + esc(C.err) + '</div><div class="f"><button class="big join" data-act="join" style="width:100%">SEE THE CREWS COMING UP</button></div>' : '<div class="sec"><div class="skel"></div><div class="skel" style="margin-top:10px;height:200px"></div></div>', '', true);
    var c = C.data, f = crewFx(c), spot = HI8.spot(c.spot) || {}, isToday = c.day === S.today, member = !!c.me;
    var status = c.status === 'off' ? '<span class="tag off">CALLED OFF</span>' : c.past ? '<span class="tag off">DONE</span>' : c.live ? '<span class="tag live">LIVE NOW</span>' : '';
    var maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((c.maps || spot.maps || c.spot_name) + '');
    var hub = c.meet_hub ? HI8.hubsOf(c.city).filter(function (h) { return h.slug === c.meet_hub; })[0] : null;
    var body = '<div class="hero"><div class="k">' + esc(SPORT[c.sport].em + ' ' + SPORT[c.sport].name.toUpperCase() + ' CREW') + ' ' + status + '</div><h2>' + esc(c.spot_name) + '</h2>' +
      '<div class="when2">' + esc(dayRel(c.day)) + ' · ' + esc(hm(c.start)) + (c.end ? '–' + esc(hm(c.end)) : '') + '</div>' +
      '<div class="when2" style="color:var(--mint);font-weight:400;margin-top:4px">' + esc(CREW_LEVELS[c.levels] || '') + ' · captain ' + esc(c.host) + (c.host_plate ? ' #' + pad3(c.host_plate) : '') + '</div></div>' +
      (c.status === 'off' ? '<div class="err">Called off: ' + esc(c.off_reason || 'the captain called it off') + '</div>' : '') +
      crewStrip(c, f) +
      (c.note ? '<div class="box"><h3>FROM THE CAPTAIN</h3><div style="font-size:13px">' + esc(c.note) + '</div></div>' : '') +
      '<div class="box"><h3>WHO\'S GOING <span class="tag' + (c.going >= c.max ? ' off' : '') + '">' + c.going + '/' + c.max + '</span></h3>' +
      (member ? membersHtml(c) : '<div style="display:flex;align-items:center;gap:10px">' + faces(c) + '<span style="font-size:12.5px;color:var(--mute)">' +
        (c.seats_free ? c.seats_free + ' seat' + (c.seats_free > 1 ? 's' : '') + ' free' + (hub ? ' from ' + esc(hub.name) : '') + (c.meet_time ? ' at ' + esc(hm(c.meet_time)) : '') : c.drivers ? 'cars are full' : 'no car yet') +
        (c.need_seat ? ' · ' + c.need_seat + ' need' + (c.need_seat > 1 ? '' : 's') + ' a seat' : '') + (c.here ? ' · ' + c.here + ' at the spot' : '') + '</span></div><p class="hint">Names, cars and the chat are for the crew.</p>') + '</div>';
    if (member) {
      body += '<div class="box"><h3>MEETING POINT</h3><div style="font-size:13px">' + (hub ? '<b>' + esc(hub.name) + '</b> · ' + esc(hub.sub || '') + (c.meet_time ? ' at <b>' + esc(hm(c.meet_time)) + '</b>' : '') + '<br>' : '') +
        (c.meet_note ? esc(c.meet_note) + '<br>' : '') + 'Spot: ' + esc(c.spot_name) + '</div><div class="row" style="margin-top:10px">' +
        (hub ? '<a class="opt" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + hub.lat + ',' + hub.lon + '">PICK-UP ON MAPS</a>' : '') +
        '<a class="opt" target="_blank" rel="noopener" href="' + esc(maps) + '">DIRECTIONS TO THE SPOT</a><button class="opt" data-act="ics">ADD TO CALENDAR</button></div></div>';
      if (isToday && c.status === 'on') {
        body += '<div class="box"><h3>AT THE SPOT ' + (c.me.here ? '<span class="tag live">YOU\'RE THERE</span>' : '') + '</h3>' +
          (c.me.here ? '<p class="hint" style="margin:0 0 8px">How is it? Your crew and everyone checking the map see it (without your name).</p><div class="row">' +
            [['on', 'ON'], ['meh', 'MEH'], ['off', 'OFF']].map(function (v) { return '<button class="opt" data-act="report" data-v="' + v[0] + '">' + v[1] + '</button>'; }).join('') + '</div>' +
            (c.sport === 'kite' ? '<div class="row" style="margin-top:8px">' + [7, 9, 10, 12, 14].map(function (k) { return '<button class="opt" data-act="rkite" data-v="' + k + '" aria-pressed="' + (S.crew.rkite === k) + '">' + k + ' M</button>'; }).join('') + '</div>' :
              '<div class="row" style="margin-top:8px">' + (c.sport === 'mx' ? ['dry', 'tacky', 'muddy'] : ['dry', 'wet', 'muddy']).map(function (k) { return '<button class="opt" data-act="rground" data-v="' + k + '" aria-pressed="' + (S.crew.rground === k) + '">' + k.toUpperCase() + '</button>'; }).join('') + '</div>') +
            '<button class="opt" data-act="checkout" style="margin-top:10px">I\'VE LEFT</button>'
            : '<button class="big start" data-act="checkin" style="width:100%">I\'M AT THE SPOT</button><p class="hint">Lets the crew (and the map) know someone\'s there.</p>') + '</div>';
      }
      body += payHtml(c);
      body += '<div class="box" id="chatAnchor"><h3>CREW CHAT</h3><div class="chat" id="chatBox">' + chatHtml(C.msgs) + '</div>' +
        '<form class="send" data-form="chat"><label class="sr" for="chatIn">Message</label><input class="inp" id="chatIn" maxlength="500" autocomplete="off" placeholder="Message the crew"><button type="submit">SEND</button></form></div>';
      body += S.jf ? joinForm(c) : '<div class="f"><div class="row"><button class="opt" data-act="jfopen">CHANGE LEVEL OR RIDE</button><button class="opt" data-act="leave">' +
        (C.confirm === 'leave' ? (c.host_is_me ? 'TAP AGAIN: CALL IT OFF' : 'TAP AGAIN TO LEAVE') : c.host_is_me ? 'CALL IT OFF' : 'LEAVE THE CREW') + '</button></div></div>';
    } else if (c.status === 'on' && !c.past) {
      body += S.jf ? joinForm(c) : '';
      body += '<div class="box"><h3>THE SPOT</h3><div style="font-size:12.5px">' + esc(spot.note || '') + '</div><div class="row" style="margin-top:10px"><a class="opt" target="_blank" rel="noopener" href="' + esc(maps) + '">DIRECTIONS</a><button class="opt" data-act="spot" data-spot="' + esc(c.spot) + '">FULL FORECAST</button></div></div>';
    }
    if (c.reports && c.reports.length) {
      body += '<div class="box"><h3>REPORTS FROM THE SPOT</h3><div class="reports">' + c.reports.slice(0, 5).map(function (r) {
        return '<div class="rep"><span class="tag ' + (r.verdict === 'on' ? 'epic' : r.verdict === 'meh' ? 'ok' : 'no') + '">' + r.verdict.toUpperCase() + '</span><span>' + (r.name ? esc(r.name) + ' · ' : '') + (r.kite ? r.kite + ' m' : '') + (r.ground ? esc(r.ground) : '') + (r.note ? ' · ' + esc(r.note) : '') + '</span><small>' + esc(ago(r.at)) + '</small></div>';
      }).join('') + '</div></div>';
    }
    var foot = !member && c.status === 'on' && !c.past ? '<button class="big join" data-act="' + (S.jf ? 'jfgo' : 'jfopen') + '"' + (S.jf && S.jf.busy ? ' disabled' : '') + '>' + (S.jf && S.jf.busy ? '<span class="spin"></span>' : 'I\'M IN') + '</button><button class="big ghost" data-act="share" style="flex:0 0 34%;color:var(--cream);box-shadow:inset 0 0 0 2px var(--cream)">SHARE</button>'
      : '<a class="big wa" href="https://wa.me/?text=' + encodeURIComponent(shareText(c)) + '" target="_blank" rel="noopener">SHARE TO WHATSAPP</a>';
    return shell(esc(SPORT[c.sport].name.toUpperCase()) + ' CREW', body, foot, true);
  }

  // ---- A SPOT: the forecast table, crews there, reports
  function sheetSpot() {
    var spot = HI8.spot(S.spotSlug);
    if (!spot) return shell('SPOT', '<div class="err">That spot isn\'t on the map.</div>', '', true);
    var sport = (spot.sports || []).indexOf(S.sport) >= 0 ? S.sport : spot.sports[0], sp = fxSpot(spot.slug);
    var dates = [0, 1, 2].map(function (n) { return FX.addDays(S.today, n); }), date = dates[S.spotDay] || dates[0];
    var tabs = '<div class="tabs" role="group" aria-label="Day">' + dates.map(function (d, i) { return '<button class="tab" data-act="spotday" data-i="' + i + '" aria-pressed="' + (i === S.spotDay) + '">' + esc(FX.dayName(d, S.today)) + '</button>'; }).join('') + '</div>';
    var table = '';
    if (!sp) table = '<p class="hint" style="padding:12px 16px">' + (FX.error ? 'No forecast right now.' : '<span class="spin"></span> Loading…') + '</p>';
    else {
      var rows = FX.dayRows(sp, date, sport, spot, { kg: kg() }, 6, 21), nowT = S.today + 'T' + pad(S.nowH) + ':00';
      var cell = function (r, html, style) { return '<td' + (r.t === nowT ? ' class="now"' : '') + (style ? ' style="' + style + '"' : '') + '>' + html + '</td>'; };
      var tr = function (label, fn, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th scope="row">' + label + '</th>' + rows.map(fn).join('') + '</tr>'; };
      var windCell = function (w) { return w == null ? '' : 'background:' + window.HI8_WIND_COLOR(w) + ';color:' + (w > 33 ? '#fff' : '#111'); };
      var mname = FX.MODEL_NAME[sp.model] || 'BEST';
      var T = [tr('', function (r) { return cell(r, pad(r.h)); }, 'h')];
      if (sport === 'kite') {
        T.push(tr('WIND KT · ' + mname, function (r) { return cell(r, Math.round(r.w), windCell(r.w)); }));
        T.push(tr('GUSTS', function (r) { return cell(r, Math.round(r.g), windCell(r.g)); }));
        T.push(tr('DIRECTION', function (r) { return cell(r, arrow(r.dir) + '<span class="sr">' + FX.compass(r.dir) + '</span>'); }));
        ['ecmwf_ifs025', 'icon_seamless', 'gfs_seamless'].forEach(function (m) {
          if (rows.some(function (r) { return r.m && r.m[m]; })) T.push(tr(FX.MODEL_NAME[m], function (r) { var x = r.m && r.m[m]; return cell(r, x ? Math.round(x.w) : '', x ? windCell(x.w) + ';opacity:.8' : ''); }));
        });
        if (rows.some(function (r) { return r.wv != null; })) T.push(tr('WAVES M', function (r) { return cell(r, r.wv != null ? r.wv.toFixed(1) : ''); }));
      } else {
        T.push(tr('GROUND', function (r) { return cell(r, r.rate && r.rate.ground ? r.rate.ground.slice(0, 5).toUpperCase() : ''); }));
        T.push(tr('RAIN 24H MM', function (r) { return cell(r, r.r24 != null ? r.r24 : ''); }));
        T.push(tr('WIND · GUSTS', function (r) { return cell(r, Math.round(r.w) + '·' + Math.round(r.g)); }));
      }
      T.push(tr('RAIN MM', function (r) { return cell(r, r.mm ? r.mm : '', r.mm >= 0.2 ? 'background:#cfe0ff' : ''); }));
      T.push(tr('TEMP °C', function (r) { return cell(r, r.temp != null ? Math.round(r.temp) : ''); }));
      T.push(tr('RATING', function (r) { var t = r.rate ? FX.tone(r.rate.s) : 'none'; return cell(r, r.rate ? (r.rate.dark ? '·' : Math.round(r.rate.s)) : '', 'background:var(--' + (t === 'none' ? 'no' : t) + ')'); }, 'rate'));
      if (sport === 'kite') T.push(tr('KITE M · ' + kg() + ' KG', function (r) { return cell(r, r.rate && r.rate.kite && !r.rate.dark && r.rate.s > 0 ? r.rate.kite : ''); }));
      var ws = FX.windows(sp, date, sport, spot, { kg: kg() }), day = sp.days[date] || {};
      table = '<div class="tbl-wrap"><table class="fx"><caption class="sr">Hourly forecast for ' + esc(spot.name) + '</caption>' + T.join('') + '</table></div>' +
        '<p class="legend2">' + (ws[0] ? 'Best: ' + pad(ws[0].from) + '–' + pad(ws[0].to) + ' · ' + esc(ws[0].label) + (ws[0].why && ws[0].why.length ? ' · ' + esc(ws[0].why.join(', ')) : '') : 'No good window this day.') +
        (day.sunrise ? ' · Light ' + esc(day.sunrise) + '–' + esc(day.sunset) : '') + '. ' + (sport === 'kite' ? 'Wind in knots. Arrows point where it blows. ' + (spot.lake ? 'Lagoon: any direction works.' : 'This beach faces ' + FX.compass(spot.face) + '.') : 'Rating: rain now, mud from the last 24 h of rain, heat and wind.') + '</p>';
    }
    var crews = upcoming(sport, 14).filter(function (c) { return c.spot === spot.slug; });
    var reps = S.live ? (S.live.reports || []).filter(function (r) { return r.spot === spot.slug; }) : [];
    var body = '<div class="hero"><div class="k">' + esc((spot.sports || []).filter(function (k) { return LIVE_SPORTS.indexOf(k) >= 0; }).map(function (k) { return SPORT[k].name.toUpperCase(); }).join(' · ')) + '</div><h2>' + esc(spot.name) + '</h2>' +
      (spot.note ? '<div class="when2" style="font-weight:400">' + esc(spot.note) + '</div>' : '') + '</div>' + tabs + table +
      (reps.length ? '<div class="box"><h3>REPORTS · LAST HOURS</h3><div class="reports">' + reps.map(function (r) { return '<div class="rep"><span class="tag ' + (r.verdict === 'on' ? 'epic' : r.verdict === 'meh' ? 'ok' : 'no') + '">' + r.verdict.toUpperCase() + '</span><span>' + (r.kite ? 'on a ' + r.kite + ' m' : '') + (r.ground ? esc(r.ground) : '') + '</span><small>' + esc(ago(r.at)) + '</small></div>'; }).join('') + '</div></div>' : '') +
      '<div class="sec"><h2>CREWS HERE <small>' + crews.length + ' COMING UP</small></h2>' + (crews.length ? '<div class="crews">' + crews.map(crewCard).join('') + '</div>' : '<p class="lede">None yet.</p>') + '</div>' +
      '<div class="f"><a class="big ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(spot.maps || spot.name) + '">DIRECTIONS</a></div>';
    return shell(esc(spot.name.toUpperCase()), body, '<button class="big start" data-act="startspot" data-spot="' + esc(spot.slug) + '" data-sport="' + esc(sport) + '">START A CREW HERE</button>', true);
  }

  // ---- ME
  function sheetMe() {
    var m = HI8.mine || {}, pl = myPlate();
    if (!signedIn()) {
      return shell('ME', '<div class="sec"><h2>NO PLATE YET</h2><p class="lede">Your founding plate comes with your first crew. Join one or start one: no separate sign-up.</p>' +
        '<div style="display:grid;gap:8px"><button class="big join" data-act="join">JOIN A CREW</button><button class="big start" data-act="start">START A CREW</button></div>' + alertBox() + '</div>' + kgBox(), '');
    }
    var crews = (m.crews || []), up = crews.filter(function (c) { return c.day >= S.today && c.status === 'on'; }).reverse(), past = crews.filter(function (c) { return !(c.day >= S.today && c.status === 'on'); });
    var al = m.alerts || [];
    var body = '<div class="sec" style="display:flex;gap:16px;align-items:center">' + (pl ? '<div class="bigplate"><b>#' + pad3(pl) + '</b><small>' + esc((cityObj(S.city).name || '').toUpperCase()) + '</small></div>' : '') +
      '<div><div style="font:400 30px/1 var(--big)">' + esc(m.name || '') + '</div><div class="hint">' + esc(m.email_hint || '') + (m.captain ? ' · captain' : '') + '</div></div></div>' +
      '<div class="box"><h3>EMAIL ME NEW CREWS</h3><div class="row">' + LIVE_SPORTS.map(function (k) {
        var on = al.some(function (a) { return a.city === S.city && a.sport === k; });
        return '<button class="opt" data-act="alert" data-sport="' + k + '" data-on="' + (!on) + '" aria-pressed="' + on + '">' + SPORT[k].name.toUpperCase() + '</button>';
      }).join('') + '</div><p class="hint">In ' + esc(cityObj(S.city).name) + ', at most 3 a day. Every email has a stop link.</p></div>' + kgBox() +
      '<div class="sec"><h2>MY CREWS <small>' + up.length + ' COMING UP</small></h2>' + (up.length ? '<div class="crews">' + up.map(crewCard).join('') + '</div>' : '<p class="lede">None coming up.</p>') +
      (past.length ? '<h2 style="margin-top:18px;font-size:20px">BEFORE</h2><div class="crews">' + past.slice(0, 8).map(crewCard).join('') + '</div>' : '') + '</div>' +
      '<div class="f"><p class="hint">Switching phones? Sign up with the same email there: your plate comes with you. To delete everything, email <a href="mailto:hello@hi8ctane.com">hello@hi8ctane.com</a>.</p>' +
      '<button class="opt" data-act="signout">' + (S.confirmOut ? 'TAP AGAIN: FORGET ME ON THIS PHONE' : 'NOT YOU? FORGET ME ON THIS PHONE') + '</button></div>';
    return shell('ME', body, '');
  }
  function kgBox() {
    return '<div class="box"><h3>KITE SIZE</h3><div class="two" style="align-items:center"><label for="kgIn" style="font-size:12.5px">Your weight (kg), for the kite size in the forecast. Stays on this phone.</label>' +
      '<input class="inp" id="kgIn" data-fixed type="number" inputmode="numeric" min="35" max="140" value="' + kg() + '" data-change="kg"></div></div>';
  }
  function sheetCity() {
    var cs = (HI8.placesNow().cities || []);
    return shell('CITY', '<div class="sec"><div class="row">' + cs.filter(function (c) { return c.status === 'open'; }).map(function (c) {
      return '<button class="opt wide" data-act="setcity" data-city="' + c.slug + '" aria-pressed="' + (c.slug === S.city) + '"><span>' + esc(c.name.toUpperCase()) + '<small>' + (S.settings && S.settings.pilot_city === c.slug ? 'the pilot: live now' : 'open') + '</small></span></button>';
    }).join('') + '</div><p class="lede" style="margin-top:16px">Want Hi8ctane in your city? <a href="B27-City.dc.html">Put your city on the list</a>.</p></div>', '', true);
  }
  function sheetSoon() {
    var soon = (S.settings && S.settings.soon_sports) || SOON, k = soon.indexOf(S.soonSport) >= 0 ? S.soonSport : soon[0], nm = (SPORT[k] || { name: k }).name;
    return shell('COMING SOON', '<div class="sec"><h2>' + soon.map(function (x) { return esc((SPORT[x] || { name: x }).name); }).join(', ') + '</h2><p class="lede">We\'re starting with kite, MTB and MX in ' + esc(cityObj(S.city).name) + '. Get an email when crews for these open.</p>' +
      '<div class="row" style="margin-bottom:12px">' + soon.map(function (x) { return '<button class="opt" data-act="soonpick" data-sport="' + x + '" aria-pressed="' + (x === k) + '">' + esc((SPORT[x] || { name: x }).name.toUpperCase()) + '</button>'; }).join('') + '</div>' +
      (signedIn() ? '<button class="big dark" data-act="alert" data-sport="' + esc(k) + '" data-on="true" style="width:100%">EMAIL ME ABOUT ' + esc(nm.toUpperCase()) + '</button>'
        : '<form class="send" data-form="alert" data-sport="' + esc(k) + '"><label class="sr" for="soonEmail">Email</label><input class="inp" id="soonEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com" required><button type="submit">EMAIL ME</button></form>') + '</div>', '', true);
  }

  // ---------------------------------------------------------------- actions
  var toastT = null;
  function toast(msg, ms) { var t = $('#toast'); t.innerHTML = msg; t.className = 'toast on'; clearTimeout(toastT); toastT = setTimeout(function () { t.className = 'toast'; }, ms || 3200); }
  function copy(text) {
    var done = function () { toast('Copied.'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    else fallback();
    function fallback() { var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed: select the text instead.'); } ta.remove(); }
  }
  function ics(c) {
    var d = c.day.replace(/-/g, ''), st = hm(c.start).replace(':', '') + '00', en = (c.end ? hm(c.end) : fromMin(minutes(c.start) + 180)).replace(':', '') + '00';
    var hub = c.meet_hub ? (HI8.hubsOf(c.city).filter(function (h) { return h.slug === c.meet_hub; })[0] || {}).name : null;
    var txt = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hi8ctane//Crews//EN', 'BEGIN:VEVENT', 'UID:' + c.code + '@hi8ctane.com', 'DTSTAMP:' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z',
      'DTSTART:' + d + 'T' + st, 'DTEND:' + d + 'T' + en, 'SUMMARY:' + SPORT[c.sport].name + ' crew · ' + c.spot_name,
      'LOCATION:' + c.spot_name, 'DESCRIPTION:' + (hub ? 'Pick-up ' + hub + (c.meet_time ? ' ' + hm(c.meet_time) : '') + '. ' : '') + crewUrl(c.code), 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/calendar' })); a.download = 'hi8ctane-' + c.code + '.ics'; document.body.appendChild(a); a.click(); a.remove();
  }
  function after(p, ok) {
    return p.then(ok, function (e) { toast(errText(e), 4500); throw e; });
  }
  function joinGo() {
    var C = S.crew, c = C.data, f = S.jf;
    if (f.busy) return;
    var email = ($('#jfEmail') || {}).value, name = ($('#jfName') || {}).value;
    f.err = null;
    HI8.store.set('lv.' + c.sport, f.level);
    var args = { p_code: c.code, p_level: f.level, p_getting: f.getting, p_seats: f.getting === 'drive' ? f.seats : 0 };
    var p;
    if (signedIn()) p = HI8.withKey('hi8_join_crew', Object.assign({ p_car_with: null }, args), { noQueue: true });
    else {
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { f.err = "That email doesn't look right."; renderSheet(); return; }
      if (!name || !name.trim()) { f.err = "Add a rider name: it's what the crew sees."; renderSheet(); return; }
      p = HI8.rpc('hi8_quick_join', Object.assign({ p_email: email.trim(), p_name: name.trim(), p_car_with: null, p_source: src().source || 'crew-link', p_ref: src().ref || null }, args))
        .then(function (out) { HI8.saveMe(out); return out; });
    }
    f.busy = true; renderSheet();
    p.then(function (d) {
      var was = !!c.me; f.busy = false; S.jf = null; C.data = d; S.me = HI8.me(); drawTop();
      HI8.loadCrews(true).catch(noop); HI8.loadMine(true).catch(noop); loadLive();
      startChat(); renderSheet();
      if (!was) {
        var al = (HI8.mine && HI8.mine.alerts) || [];
        toast("You're in" + (d.plate ? ': founding plate #' + pad3(d.plate) : '') + '.' + (al.some(function (a) { return a.sport === c.sport; }) ? '' : ' <button class="opt" data-act="alert" data-sport="' + c.sport + '" data-on="true" style="margin-left:8px">EMAIL ME NEW ' + esc(SPORT[c.sport].name.toUpperCase()) + ' CREWS</button>'), 7000);
      } else toast('Saved.');
    }, function (e) { f.busy = false; f.err = errText(e); renderSheet(); });
  }
  function startPost() {
    var f = S.sf; if (f.busy) return;
    var note = ($('#sfNote') || {}).value || '', email = ($('#sfEmail') || {}).value, name = ($('#sfName') || {}).value;
    f.note = note; f.err = null;
    var args = { p_sport: f.sport, p_spot: f.spot, p_day: f.date, p_start: pad(f.from) + ':00', p_end: f.to ? pad(Math.min(f.to, 23)) + ':' + (f.to >= 24 ? '59' : '00') : null,
      p_levels: f.levels, p_max: f.max, p_meet_hub: f.getting === 'own' ? null : f.hub, p_meet_time: f.getting === 'own' ? null : f.meet, p_meet_note: null, p_note: note || null,
      p_getting: f.getting, p_seats: f.getting === 'drive' ? f.seats : 0, p_force: !!f.force };
    var p;
    if (signedIn()) p = HI8.withKey('hi8_start_crew', Object.assign({ p_level: HI8.store.get('lv.' + f.sport, 'regular') }, args), { noQueue: true });
    else {
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { f.err = "Add your email: that's how the crew reaches you through the app."; renderSheet(); return; }
      if (!name || !name.trim()) { f.err = "Add a rider name: it's what the crew sees."; renderSheet(); return; }
      HI8.store.set('lv.' + f.sport, f.level);
      p = HI8.rpc('hi8_quick_start', Object.assign({ p_email: email.trim(), p_name: name.trim(), p_level: f.level, p_source: src().source || 'start', p_ref: src().ref || null }, args))
        .then(function (out) { HI8.saveMe(out); return out; });
    }
    f.busy = true; f.dup = null; renderSheet();
    p.then(function (c) {
      f.busy = false; f.done = c; f.force = false; drawTop();
      HI8.loadCrews(true).then(drawAll, noop); HI8.loadMine(true).catch(noop); loadLive();
      renderSheet();
    }, function (e) {
      f.busy = false;
      if (e.message === 'duplicate') f.dup = { code: e.details, hint: e.hint };
      else f.err = errText(e);
      renderSheet();
      setTimeout(function () { var el = $('#dup') || sheet.querySelector('.err'); if (el) el.scrollIntoView({ block: 'center' }); }, 30);
    });
  }
  function setSport(k) {
    if (LIVE_SPORTS.indexOf(k) < 0) return;
    S.sport = k; HI8.store.set('sport28', k); S.layerSet = false; fitMap(); drawAll();
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]'); if (!t) return;
    var a = t.getAttribute('data-act'), d = t.dataset;
    if (/^sf/.test(a) && S.sf) S.sf.touched = true;
    if (t.tagName === 'A' && (a === 'shared' || t.target === '_blank')) { if (a === 'shared') toast('Paste it in your group chats. Every share brings riders.'); return; }
    if (t.tagName === 'A' || t.tagName === 'BUTTON') e.preventDefault();
    switch (a) {
      case 'close': closeSheet(); break;
      case 'join': if (S.view === 'crew') closeSheet(); go('#join'); break;
      case 'start': if (S.view === 'crew') closeSheet(); newStart({}); go('#start'); break;
      case 'startwin': newStart({ date: d.date, from: d.from, to: d.to, spot: d.spot }); go('#start'); break;
      case 'startspot': if (d.sport !== S.sport) setSport(d.sport); newStart({ spot: d.spot, sport: d.sport }); go('#start'); break;
      case 'me': go('#me'); break;
      case 'city': go('#city'); break;
      case 'setcity': S.city = d.city; HI8.store.set('city28', d.city); S.hi = null; closeSheet(); initMap(); loadForecast(); loadLive(); drawAll(); break;
      case 'sport': setSport(d.sport); break;
      case 'soon': go('#soon/' + d.sport); break;
      case 'soonpick': S.soonSport = d.sport; history.replaceState(null, '', '#soon/' + d.sport); renderSheet(); break;
      case 'spot': closeSheet(); go('#spot/' + d.spot); break;
      case 'crew': e.preventDefault(); openCrew(d.code); break;
      case 'zoom': if (map) map.zoom(Number(d.d)); break;
      case 'layer': S.layer = effLayer() === 'rain' ? 'wind' : 'rain'; S.layerSet = true; drawTime(); drawMapSpots(); break;
      case 'play': togglePlay(); break;
      case 'now': S.hi = Math.max(0, times().indexOf(S.today + 'T' + pad(S.nowH) + ':00')); drawTime(); drawMapSpots(); break;
      case 'seeday': { var T = times(), i = T.indexOf(d.date + 'T' + pad(Number(d.from || 12)) + ':00'); if (i >= 0) { S.hi = i; drawTime(); drawMapSpots(); var mw = $('.mapwrap'); if (mw && mw.getBoundingClientRect().top < 0) mw.scrollIntoView({ behavior: 'smooth' }); } break; }
      case 'joinday': S.joinDay = d.day; renderSheet(); break;
      case 'sfsport': newStart({ sport: d.sport }); if (d.sport !== S.sport) setSport(d.sport); renderSheet(); break;
      case 'sfwin': S.sf.date = d.date; S.sf.from = Number(d.from); S.sf.to = Number(d.to); S.sf.custom = false; S.sf.dup = null; rerank(); break;
      case 'sfcustom': S.sf.custom = true; renderSheet(); break;
      case 'sfday': S.sf.date = d.date; S.sf.dup = null; rerank(); break;
      case 'sfspot': S.sf.spot = d.spot; S.sf.spotPicked = true; S.sf.dup = null; S.sf.hub = null; autoMeet(); renderSheet(); break;
      case 'sfget': S.sf.getting = d.v; autoMeet(); renderSheet(); break;
      case 'sfseats': S.sf.seats = Math.max(1, Math.min(7, S.sf.seats + Number(d.d))); renderSheet(); break;
      case 'sfhub': S.sf.hub = d.hub; S.sf.meetAuto = true; autoMeet(); renderSheet(); break;
      case 'sflevels': S.sf.levels = d.v; renderSheet(); break;
      case 'sflevel': S.sf.level = d.v; renderSheet(); break;
      case 'sfforce': S.sf.force = true; startPost(); break;
      case 'sfpost': startPost(); break;
      case 'jfopen': {
        var c = S.crew.data, me = c.me;
        S.jf = { level: me ? me.level : HI8.store.get('lv.' + c.sport, 'regular'), getting: me ? me.getting : (c.seats_free > 0 ? 'seat' : 'own'), seats: me && me.getting === 'drive' ? me.seats : 3, err: null, busy: false };
        renderSheet(); setTimeout(function () { var el = $('#joinForm'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); var i = $('#jfEmail'); if (i) i.focus(); }, 40); break;
      }
      case 'jflevel': S.jf.level = d.v; renderSheet(); break;
      case 'jfget': S.jf.getting = d.v; renderSheet(); break;
      case 'jfseats': S.jf.seats = Math.max(1, Math.min(7, S.jf.seats + Number(d.d))); renderSheet(); break;
      case 'jfgo': joinGo(); break;
      case 'leave': {
        var C = S.crew;
        if (C.confirm !== 'leave') { C.confirm = 'leave'; renderSheet(); setTimeout(function () { if (S.crew === C && C.confirm === 'leave') { C.confirm = null; renderSheet(); } }, 4000); break; }
        C.confirm = null;
        after(HI8.withKey('hi8_leave_crew', { p_code: C.code, p_reason: null }, { noQueue: true }), function (dd) { C.data = dd; stopChat(); HI8.loadCrews(true).then(drawAll, noop); HI8.loadMine(true).catch(noop); renderSheet(); toast(dd.status === 'off' ? 'Called off. The crew gets an email.' : 'You left the crew.'); }).catch(noop);
        break;
      }
      case 'checkin': case 'checkout':
        after(HI8.withKey('hi8_checkin', { p_code: S.crew.code, p_here: a === 'checkin' }, { noQueue: true }), function (dd) { S.crew.data = dd; renderSheet(); loadLive(); pollChat(); }).catch(noop); break;
      case 'rkite': S.crew.rkite = Number(d.v); renderSheet(); break;
      case 'rground': S.crew.rground = d.v; renderSheet(); break;
      case 'report':
        after(HI8.withKey('hi8_report', { p_code: S.crew.code, p_verdict: d.v, p_kite: S.crew.data.sport === 'kite' ? (S.crew.rkite || null) : null, p_ground: S.crew.data.sport !== 'kite' ? (S.crew.rground || null) : null, p_note: null }, { noQueue: true }),
          function (dd) { S.crew.data = dd; renderSheet(); loadLive(); pollChat(); toast('Thanks: the crew and the map have it.'); }).catch(noop); break;
      case 'settle': {
        var cost = Number(($('#payCost') || {}).value), link = ($('#payLink') || {}).value, bz = ($('#payBizum') || {}).value;
        if (!(cost >= 0)) { toast('Add what the car cost.'); break; }
        after(HI8.withKey('hi8_settle', { p_code: S.crew.code, p_cost: cost, p_link: link || null, p_bizum: bz || null }, { noQueue: true }), function (dd) { S.crew.data = dd; renderSheet(); pollChat(); toast('Saved. Your car can pay you now.'); }).catch(noop); break;
      }
      case 'paid': after(HI8.withKey('hi8_paid', { p_code: S.crew.code, p_paid: d.v === 'true' }, { noQueue: true }), function (dd) { S.crew.data = dd; renderSheet(); }).catch(noop); break;
      case 'ics': ics(S.crew.data); break;
      case 'share': {
        var cc = S.crew.data, txt = shareText(cc);
        if (navigator.share) navigator.share({ title: 'Hi8ctane crew', text: txt }).catch(noop);
        else window.open('https://wa.me/?text=' + encodeURIComponent(txt), '_blank', 'noopener');
        break;
      }
      case 'nshare': { var c2 = S.sf.done; navigator.share({ title: 'Hi8ctane crew', text: shareText(c2) }).catch(noop); break; }
      case 'copy': copy(d.text); break;
      case 'spotday': S.spotDay = Number(d.i); renderSheet(); break;
      case 'alert': {
        var sp = d.sport || S.sport, on = d.on !== 'false';
        if (!signedIn()) { go('#soon/' + sp); break; }
        after(HI8.withKey('hi8_alert', { p_city: S.city, p_sport: sp, p_on: on }, { noQueue: true }), function (r) {
          HI8.mine = Object.assign({}, HI8.mine || {}, { alerts: r.alerts }); HI8.store.set('mine', HI8.mine);
          toast(on ? 'Done: you get an email when someone posts a ' + SPORT[sp].name + ' crew.' : 'Stopped.'); drawCrews(); if (S.view) renderSheet();
        }).catch(noop); break;
      }
      case 'signout':
        if (!S.confirmOut) { S.confirmOut = true; renderSheet(); setTimeout(function () { S.confirmOut = false; if (S.view === 'me') renderSheet(); }, 4000); break; }
        S.confirmOut = false; ['me', 'mine', 'rsvp', 'cities', 'cityMine'].forEach(HI8.store.del); HI8.mine = null; closeSheet(); drawAll(); toast('Forgotten on this phone.'); break;
    }
  });
  function rerank() { var f = S.sf, rank = FX.rankSpots(S.city, spotsFor(S.city, f.sport), f.sport, f.date, f.from, f.to, { kg: kg() }); if (rank[0] && rank[0].fx && !f.spotPicked) f.spot = rank[0].spot.slug; f.hub = null; autoMeet(); renderSheet(); }
  document.addEventListener('change', function (e) {
    var t = e.target, a = t.getAttribute('data-change');
    if (!a) return;
    if (/^sf/.test(a) && S.sf) S.sf.touched = true;
    if (a === 'sffrom') { S.sf.from = Number(t.value); if (S.sf.to <= S.sf.from) S.sf.to = S.sf.from + 2; rerank(); }
    if (a === 'sfto') { S.sf.to = Number(t.value); rerank(); }
    if (a === 'sfmeet') { S.sf.meet = t.value; S.sf.meetAuto = false; }
    if (a === 'kg') { var v = Math.max(35, Math.min(140, Number(t.value) || 75)); HI8.store.set('kg', v); drawAll(); }
  });
  document.addEventListener('input', function (e) { if (e.target.id === 'hour') { S.hi = Number(e.target.value); stopPlay(); drawTime(); drawMapSpots(); } });
  document.addEventListener('submit', function (e) {
    var fm = e.target.closest('[data-form]'); if (!fm) return;
    e.preventDefault();
    var kind = fm.getAttribute('data-form');
    if (kind === 'chat') {
      var inp = $('#chatIn'), body = inp.value.trim(); if (!body) return;
      inp.value = '';
      after(HI8.withKey('hi8_send', { p_code: S.crew.code, p_body: body }, { noQueue: true }), function () { pollChat(); }).catch(function () { inp.value = body; });
    }
    if (kind === 'alert') {
      var em = fm.querySelector('input[type=email]').value.trim(), sp = fm.getAttribute('data-sport') || S.sport;
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { toast("That email doesn't look right."); return; }
      after(HI8.rpc('hi8_alert_signup', { p_email: em, p_city: S.city, p_sport: sp, p_source: src().source || 'alert', p_ref: src().ref || null }), function (out) {
        HI8.saveMe(out); HI8.mine = Object.assign({}, HI8.mine || {}, { alerts: out.alerts }); drawTop(); drawCrews(); HI8.loadMine(true).catch(noop);
        toast('Done: founding plate #' + pad3(out.plate || 0) + '. You get an email when someone posts a ' + SPORT[sp].name + ' crew.', 6000);
        if (S.view) renderSheet();
      }).catch(noop);
    }
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('popstate', function () { var c = new URLSearchParams(location.search).get('c'); if (!c && S.view === 'crew') closeSheet(); else route(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && S.view) closeSheet(); });

  var playT = null;
  function togglePlay() { if (playT) return stopPlay(); var T = times(); $('#play').textContent = '❚❚'; playT = setInterval(function () { S.hi = (S.hi + 1) % T.length; drawTime(); drawMapSpots(); }, 650); }
  function stopPlay() { if (playT) { clearInterval(playT); playT = null; var b = $('#play'); if (b) b.textContent = '▶'; } }

  // ---------------------------------------------------------------- data
  function loadForecast(force) {
    var spots = HI8.spotsOf(S.city).filter(function (s) { return (s.sports || []).some(function (k) { return LIVE_SPORTS.indexOf(k) >= 0; }); });
    var city = S.city;
    FX.load(city, spots, force).then(function () {
      if (city !== S.city) return;
      // the start form was opened before the forecast came in: give it the forecast's best window
      if (S.view === 'start' && S.sf && !S.sf.touched && !S.sf.done) newStart(S.sf.init || {});
      drawAll();
    }, function () { drawAll(); });
    FX.grid(city, force).then(function () { if (city === S.city) { drawTime(); drawMapSpots(); } }, noop);
  }
  function loadLive() {
    if (!HI8.live) return Promise.resolve();
    return HI8.rpc('hi8_live', { p_city: S.city }).then(function (l) { S.live = l; drawMapSpots(); drawCrews(); drawLive(); if (S.view && S.view !== 'start') renderSheet(); }, noop);
  }
  function boot() {
    frame(); sheet = $('#sheet');
    var stop = P.get('stop');
    if (stop && HI8.live) HI8.rpc('hi8_unsubscribe', { p_token: stop }).then(function (r) { toast(r.stopped ? 'Stopped: no more ' + esc((SPORT[r.sport] || { name: r.sport }).name) + ' crew emails.' : 'Already stopped.', 6000); }, function () { toast('That stop link didn\'t work. Email hello@hi8ctane.com and we\'ll do it.'); });
    drawAll(); initMap();
    if (HI8.live) {
      HI8.rpc('hi8_settings', {}).then(function (s) { S.settings = s; if (!P.get('city') && !HI8.store.get('city28', null) && s.pilot_city) S.city = s.pilot_city; drawTop(); }, noop);
      HI8.onData(function () { drawTop(); drawCrews(); drawMapSpots(); if (S.view === 'join' || S.view === 'me') renderSheet(); });
      HI8.loadPlaces().then(function () { fitMap(); loadForecast(); drawAll(); }, function () { loadForecast(); });
      loadLive();
      setInterval(function () { if (!document.hidden) { loadLive(); HI8.loadCrews(true).catch(noop); } }, 60000);
    } else loadForecast();
    setInterval(function () { if (!document.hidden) loadForecast(); }, 30 * 60e3);
    setInterval(function () { var h = S.nowH; refreshToday(); if (h !== S.nowH) drawTime(); }, 60000);
    route();
  }
  boot();
})();
