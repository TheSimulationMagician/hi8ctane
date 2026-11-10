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
  var SPORT = { kite: { name: 'Kite', em: '🪁' }, mtb: { name: 'MTB', em: '🚵' }, mx: { name: 'MX', em: '🏍️' }, wing: { name: 'Wing', em: '🪽' }, surf: { name: 'Surf', em: '🏄' }, sup: { name: 'SUP', em: '🛶' }, windsurf: { name: 'Windsurf', em: '🏄' } };
  var LIVE_SPORTS = ['kite', 'mtb', 'mx'], SOON = ['wing', 'surf', 'sup', 'windsurf'];
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
    offline_build: 'Crews need the live site.', no_crew: "This crew link doesn't exist.", sport_soon: 'That sport is coming soon.',
    no_plan: "That plan isn't on any more.", bad_people: 'Between 1 and 12 people.',
    payments_off: 'Paying in the app opens soon. Pay the driver directly for now.', no_funds: 'Not enough in your wallet: top up first.', already_paid: 'Your seat is already paid.',
    not_ready: "Your driver hasn't added what the car costs yet.", wallet_full: 'Your wallet holds up to €100.', pass_active: 'Your Hi8 Pass is already on.', payout_min: 'You can withdraw from €5.', payout_failed: "The transfer didn't go through: your money is back in your wallet."
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
    city: (P.get('city') || HI8.store.get('city28', null) || tzCity() || 'amsterdam'),
    sport: (P.get('sport') || P.get('sp') || HI8.store.get('sport28', null) || 'kite'),
    variant: P.get('v') || 'map', settings: null, today: null, tz: 'Europe/Madrid', hi: null, layer: 'wind', playing: null,
    crew: null, sf: null, jf: null, joinDay: 'all', spotDay: 0, live: null, me: HI8.me()
  };
  if (LIVE_SPORTS.indexOf(S.sport) < 0) S.sport = 'kite';
  // landing iterations: ?v=1 conditions up top, ?v=2 one list to join or start, default 3 (both, polished, set-up inline)
  var V = { '1': 1, '2': 2 }[P.get('v')] || 3;
  // a first visit opens on the region of the rider's time zone: Spain → Barcelona, the Low Countries (and the rest) → Amsterdam
  function tzCity() { try { var z = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; return { 'Europe/Amsterdam': 'amsterdam', 'Europe/Brussels': 'amsterdam', 'Europe/Madrid': 'barcelona' }[z] || null; } catch (e) { return null; } }
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

  // ---------------------------------------------------------------- the 2.7 look: tiles, ribbons, verdicts
  var SCOL = { kite: '#2A6F86', wing: '#5B3F99', surf: '#2297AA', sup: '#2A8C74', mtb: '#1F4FA0', mx: '#5C6B2F', windsurf: '#B4472E', wake: '#0E7A8C', other: '#4A4538' };
  var ICON = {
    kite: '<path d="M3 11l18-8-8 18-2-8z"/>',
    wing: '<path d="M3.5 16 C5 9 11 5 20 4.5 C17 9 15.5 13.5 15.5 19.5 C12 17.5 8 16.3 3.5 16 Z"/><path d="M9.8 10.4 L15.5 19.5"/>',
    surf: '<path d="M3 17.5 C3 10.5 8.3 6 14 6 C18 6 21 8.6 21 11.6 C21 14 19 15.4 17 14.6 C15.6 14 15.4 12.2 16.8 11.6"/><path d="M3 20.5 H21"/>',
    sup: '<circle cx="12.6" cy="4.4" r="2"/><path d="M12.2 7.4 L9.6 16.4 M12.2 7.4 L15.4 11 M17.6 6.2 L13.4 21"/><path d="M3 17.4 C7.4 19.4 14.6 19.6 21 16"/>',
    mtb: '<circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/><path d="M5.5 16 L9.5 8.5 L15.5 8.5 L18.5 16 M9.5 8.5 L12 16"/>',
    mx: '<circle cx="5.5" cy="16.5" r="3.6"/><circle cx="18.5" cy="16.5" r="3.6"/><path d="M5.5 16.5 L8.8 11.4 H14 L18.5 16.5 M7.2 9 H12.2 L14 11.4 L16.2 6.2 M14.6 6.2 H18.2 M16.8 9.6 L20.8 10.6"/>',
    windsurf: '<path d="M12 3 V17 H19 Z"/><path d="M12 3 C8 7 7.4 12 8.6 17"/><path d="M3 20 H21"/>',
    wake: '<path d="M3 19.5 C8 21.5 16 21.5 21 19.5"/><circle cx="8.5" cy="6.5" r="2"/><path d="M8.5 9.5 L9.5 16.5 M9 11.5 L15 8 M13.5 4 L20.5 10"/>',
    other: '<circle cx="12" cy="12" r="8"/><path d="M12 7 V12 L15 14"/>'
  };
  // a sport tile: colour square, white inner square, the line icon (framed = with the black outline, for buttons)
  function tile(k, size, framed) {
    var c = SCOL[k] || SCOL.other, ic = ICON[k] || ICON.other;
    return '<svg class="tile" width="' + size + '" height="' + size + '" viewBox="0 0 48 48" aria-hidden="true">' +
      (framed ? '<rect x="1.5" y="1.5" width="45" height="45" fill="' + c + '" stroke="#111" stroke-width="3"/><rect x="8" y="8" width="32" height="32" fill="#fff"/><g transform="translate(12 12)"'
        : '<rect width="48" height="48" fill="' + c + '"/><rect x="7" y="7" width="34" height="34" fill="#fff"/><g transform="translate(11 11) scale(1.0833)"') +
      ' fill="none" stroke="' + c + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">' + ic + '</g></svg>';
  }
  // the ransom-note wordmark: one cut-out letter each
  function logo() {
    return '<span class="ransom" role="img" aria-label="Hi8ctane">' + [['H', 'r1'], ['I', 'r2'], ['8', 'r3'], ['c', 'r4'], ['T', 'r5'], ['A', 'r6'], ['N', 'r7'], ['E', 'r8']].map(function (x) {
      return '<span class="' + x[1] + '" aria-hidden="true">' + x[0] + '</span>';
    }).join('') + '</span>';
  }
  var LVL = { rookie: ['ROOKIE CREW', '#FFE14D'], all: ['ALL LEVELS', '#FFFFFF'], regular: ['RIDE SOLO', '#C8FF3D'] };
  var AVC = ['#FFE14D', '#FFC2D6', '#8DF5E8', '#C8FF3D', '#FFFFFF'];
  var BARS = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M5 19 V15 M10 19 V11 M15 19 V7 M20 19 V4"/></svg>';
  var CLOCK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M12 1.5a10.5 10.5 0 1 0 0 21 10.5 10.5 0 0 0 0-21zm-1.4 4.5h2.8v5.3l4 2.4-1.4 2.4-5.4-3.2z"/></svg>';
  var CAR = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M2.5 18v-6l2.8-5.5h13.4L21.5 12v6h-2.3a2.6 2.6 0 0 1-5.2 0h-4a2.6 2.6 0 0 1-5.2 0zM7.2 11.3h9.6l-1.5-3H8.7z"/></svg>';
  var SHIELD = '<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8 3.5 5v6.2c0 5.2 3.6 9.6 8.5 11 4.9-1.4 8.5-5.8 8.5-11V5z" fill="#111"/><path d="M7.6 12.2l3 3 5.8-6" fill="none" stroke="#F3EFE3" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ---------------------------------------------------------------- the money: fuel, the share, the Hi8 fee
  // Fuel for the round trip (HI8.FUEL: 7 L/100 km with boards on, at the region's pump price; roads 30% longer than the crow flies), split evenly.
  // Riders add the Hi8 fee on top of their share (15%, set in Supabase); the driver gets the full share.
  // During the pilot the fee is shown but not charged (fee_live false).
  function feePct() { var v = S.settings && S.settings.ride_fee_pct; return v == null ? 15 : Number(v); }
  function feeLive() { return !!(S.settings && S.settings.fee_live === true); }
  function tripCost(a, b) { return a && b ? HI8.tripCost(a, b, S.city) : null; }
  function money(x) { return '€' + (Math.round(x * 100) / 100).toFixed(2); }
  // what one rider pays in a car of n people: { share, fee, pay (what leaves your pocket now), solo, save }
  function seatMath(cost, n) {
    var share = cost / Math.max(1, n), fee = n > 1 ? share * feePct() / 100 : 0, pay = share + (feeLive() ? fee : 0);
    return { share: share, fee: fee, pay: pay, solo: cost, save: cost - pay, feeFree: !feeLive() };
  }
  function feeLine(m) {
    return m.fee ? (m.feeFree ? '<s>' + money(m.fee) + '</s> Hi8 fee: free during the pilot' : money(m.fee) + ' Hi8 fee (' + feePct() + '%)') : '';
  }
  function hubOf(c) { return c && c.meet_hub ? HI8.hubsOf(c.city).filter(function (h) { return h.slug === c.meet_hub; })[0] || null : null; }

  // ---------------------------------------------------------------- where you start from (it stays on this phone)
  // A region has its spots; crews leave from wherever riders live. The first crew from a town puts it on the list.
  var REGION = { amsterdam: 'Netherlands', barcelona: 'Catalonia', tarifa: 'Tarifa' };
  function regionName(slug) { var c = cityObj(slug || S.city); return c.region || REGION[c.slug] || c.name || slug; }
  function home() { var h = HI8.store.get('home29.' + S.city, null); return h && h.lat != null ? h : null; }
  function setHome(h) { if (h) HI8.store.set('home29.' + S.city, h); else HI8.store.del('home29.' + S.city); }
  function nearestTo(pt, list) { var best = null, bd = 1e9; (list || HI8.hubsOf(S.city)).forEach(function (x) { var d = HI8.km(x, pt); if (d < bd) { bd = d; best = x; } }); return best; }
  // the rider's start as a pick-up point: an existing one within 1.5 km, or a new one ('__home') added when a crew is posted
  function homeHub() {
    var h = home(); if (!h) return null;
    var near = nearestTo(h); if (near && HI8.km(near, h) < 1.5) return near;
    return { city: S.city, slug: '__home', name: h.name, sub: 'NEW · WHERE YOU START', lat: h.lat, lon: h.lon, kind: 'new' };
  }
  function startHubs() {
    var hh = homeHub(), h = home(), L = HI8.hubsOf(S.city).slice();
    if (hh && hh.slug === '__home') L.unshift(hh);
    if (h) L.sort(function (a, b) { return HI8.km(a, h) - HI8.km(b, h); });
    return L;
  }
  function hubBy(slug) { return startHubs().filter(function (h) { return h.slug === slug; })[0] || null; }
  function towns() { var g = (window.HI8_GEO || {})[S.city]; return g && g.towns ? g.towns.map(function (t) { return { name: t[0].toUpperCase(), lat: t[1], lon: t[2], rank: t[3] }; }) : []; }
  // how far a crew leaves from you: to its pick-up point, or to the spot for own-way crews
  function nearMe(c) { var h = home(); if (!h) return null; var hb = hubOf(c), sp = HI8.spot(c.spot); return hb ? HI8.km(hb, h) : sp ? HI8.km(sp, h) : null; }
  function isNear(c) { var d = nearMe(c); return d == null || (hubOf(c) ? d <= 35 : d <= 120); }
  function inRegion(pt) { return spotsFor(S.city, 'kite').concat(spotsFor(S.city, 'mtb'), spotsFor(S.city, 'mx')).some(function (s) { return HI8.km(s, pt) <= 160; }); }

  // ---------------------------------------------------------------- the frame
  var app = $('#app');
  var BUDDY = {
    safe: [['eye', 'Someone sees you go out', 'and sees you come back in. Nobody rides out of sight.'],
      ['hand', 'Launch, land, push-start', 'A second pair of hands at the kite, the bike, the gate.'],
      ['tool', 'A spare tube, a tow, a first-aid kit', 'Mechanicals and tumbles end the day sooner alone.'],
      ['pin', 'Checked in at the spot', 'Your crew sees you got there, and when you\'ve left.']],
    fun: [['up', 'Push past your line', 'The jump you\'d skip alone, the session that goes an hour longer.'],
      ['cam', 'Someone films it', 'The best one is never the one nobody saw.'],
      ['car', 'The drive is half the day', 'Music, snacks, the forecast argument. A quarter of the fuel.'],
      ['cup', 'Stories after', 'A beer at the beach bar beats a lonely drive home.']]
  };
  var BI = {
    eye: '<path d="M1.5 12S5.5 5 12 5s10.5 7 10.5 7-4 7-10.5 7S1.5 12 1.5 12z"/><circle cx="12" cy="12" r="3"/>',
    hand: '<path d="M7 11V5.5a1.5 1.5 0 0 1 3 0V10M10 10V4a1.5 1.5 0 0 1 3 0v6M13 10V5a1.5 1.5 0 0 1 3 0v6M16 11V8a1.5 1.5 0 0 1 3 0v6c0 4-2.5 7-6.5 7S7 19 5 16l-2-3.5a1.4 1.4 0 0 1 2.3-1.6L7 13"/>',
    tool: '<path d="M14.5 5.5a4 4 0 0 0 4.9 4.9l-9 9a2.1 2.1 0 0 1-3-3l9-9a4 4 0 0 0-1.9-1.9z"/><path d="M15 3.5 17.5 6 20.5 3"/>',
    pin: '<path d="M12 21.5S4.5 14.4 4.5 9a7.5 7.5 0 0 1 15 0c0 5.4-7.5 12.5-7.5 12.5z"/><path d="M9 9.2l2 2 4-4"/>',
    up: '<path d="M4 20 L12 4 L20 20"/><path d="M8.5 13 H15.5"/>',
    cam: '<rect x="2.5" y="7" width="13" height="11"/><path d="M15.5 11 21.5 7.5V17.5L15.5 14"/>',
    car: '<path d="M3 17v-5l2.5-5h13L21 12v5"/><circle cx="7" cy="17.5" r="2"/><circle cx="17" cy="17.5" r="2"/><path d="M3 12h18"/>',
    cup: '<path d="M6 3h12l-1.5 17h-9z"/><path d="M6.6 9h10.8"/>'
  };
  function bico(k, bg) { return '<span class="bico" style="background:' + bg + '"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + BI[k] + '</svg></span>'; }
  function frame() {
    app.innerHTML =
      '<header class="tb"><a class="logo" href="./" aria-label="Hi8ctane home">' + logo() + '</a>' +
      '<button class="tbcity" data-act="city" aria-label="Change city"><span id="cityName"></span><small id="cityTag"></small> ▾</button>' +
      '<button class="tbme" id="plate" data-act="me" aria-label="Me: your plate and crews"></button></header>' +
      '<section class="mapwrap" aria-label="Live map"><div id="map"></div>' +
      '<div class="mapnote" id="mapnote"></div>' +
      '<div class="mapbtns"><button class="mbtn" data-act="zoom" data-d="0.6" aria-label="Zoom in">+</button><button class="mbtn" data-act="zoom" data-d="-0.6" aria-label="Zoom out">−</button>' +
      '<button class="mbtn txt" id="layerBtn" data-act="layer" aria-pressed="false">RAIN</button></div>' +
      '<div class="legend" aria-hidden="true">0 <i id="legendBar"></i> 40 KT</div>' +
      '<div class="timebar"><button class="play" id="play" data-act="play" aria-label="Play the next hours">▶</button>' +
      '<div class="tl"><label class="sr" for="hour">Forecast time</label><input type="range" id="hour" min="0" max="0" value="0"><div class="days" id="tlDays"></div></div>' +
      '<div class="when" id="when"></div></div></section>' +
      '<main class="panel" id="panel">' +
      '<section class="hero ht" id="hero"><canvas class="herofx" id="heroFx" aria-hidden="true"></canvas>' +
      '<div class="kick"><span class="blink pdot"></span><span id="heroKick">LIVE CREWS · KITE · MTB · MX</span></div>' +
      '<h1 class="hl">THE FORECAST SAYS GO.<br><span>WE GET YOU THERE.</span></h1>' +
      '<p class="lede0">Good sessions near you, a crew at your level and a seat in the car. Tap <b>I\'M GOING</b>. No app to install.</p>' +
      '<div class="herowind" id="heroWind"></div><div class="herostat" id="heroStat"></div></section>' +
      '<div class="ctx" id="ctx"><div class="sps" id="sports"></div><button class="ctxfrom" data-act="from" id="ctxFrom"></button></div>' +
      '<div class="pg">' +
      (V === 1 ? '<section class="blk" id="crews"></section>' : '<section class="blk" id="sessions"></section>') +
      '<section class="blk" id="live"></section>' +
      '<section class="blk mapsec" id="mapsec"><div class="sec2"><b>THE LIVE MAP</b><span>WIND · CREWS · WHO\'S THERE</span></div><div class="mapbox" id="mapslot"></div></section>' +
      (V !== 2 ? '<section class="blk" id="now"></section>' : '') +
      '<section class="blk" id="how">' + howHtml() + '</section>' +
      '<section class="blk" id="night"></section>' +
      '<section class="blk more" id="more"><div class="sec2"><b>MORE</b><span>WHEN YOU WANT IT</span></div>' +
      '<details class="mo" id="moWeek"><summary><b>THE WEEK AHEAD</b><span>Every sport, every day, and the best window</span></summary><section class="blk" id="week"></section><section class="blk" id="best"></section></details>' +
      '<details class="mo" id="moSafe"><summary><b>SAFETY AND THE SPLIT</b><span>The buddy rule, riding with people you don\'t know yet, the fuel</span></summary><section class="blk" id="buddy">' + buddyHtml() + '</section><section class="blk" id="save"></section><section class="blk" id="trust">' + trustHtml() + '</section></details>' +
      '<details class="mo" id="moPlans"><summary><b>DAYS OUT</b><span>Plans with our partners</span></summary><section class="blk" id="plans"></section></details>' +
      '<details class="mo" id="moWhere"><summary><b>WHERE NEXT</b><span>Your town, other regions, trips</span></summary><div id="towns"></div><div id="where"></div></details>' +
      '<details class="mo" id="moSoon"><summary><b>MORE SPORTS SOON</b><span>Get an email when yours opens</span></summary><div class="sps soonr" id="soonSports"></div></details>' +
      '<a class="mo" href="B27-Schools.dc.html"><b>FOR SCHOOLS + RENTAL SHOPS</b><span>We send you riders who already have a crew →</span></a>' +
      '</section>' +
      '</div>' +
      '<footer class="seeyou"><span class="st" style="left:78%;top:30px"></span><span class="st" style="left:88%;top:64px"></span><span class="st" style="left:67%;top:90px"></span><span class="st" style="left:9%;top:120px"></span>' +
      '<div class="sy">SEE YOU<br><span>OUT THERE.</span></div>' +
      '<svg class="sun" viewBox="0 0 390 120" preserveAspectRatio="xMaxYMax meet" aria-hidden="true"><defs><linearGradient id="sun29" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE14D"/><stop offset=".55" stop-color="#FF8FB6"/><stop offset="1" stop-color="#FF2D78"/></linearGradient><clipPath id="hz29"><rect x="0" y="0" width="390" height="86"/></clipPath></defs>' +
      '<circle cx="292" cy="86" r="66" fill="url(#sun29)" clip-path="url(#hz29)"/><rect x="218" y="48" width="148" height="3" fill="#FF4F8E"/><rect x="218" y="60" width="148" height="4" fill="#FF4F8E"/><rect x="218" y="72" width="148" height="5" fill="#FF4F8E"/>' +
      '<rect x="0" y="86" width="390" height="34" fill="#111"/><path d="M0 98 Q24 92 48 98 T96 98 T144 98 T192 98 T240 98 T288 98 T336 98 T384 98 T432 98" fill="none" stroke="#8DF5E8" stroke-width="2.5"/><path d="M-24 110 Q0 104 24 110 T72 110 T120 110 T168 110 T216 110 T264 110 T312 110 T360 110 T408 110" fill="none" stroke="#C8FF3D" stroke-width="2.5"/></svg></footer>' +
      '<div class="credits">Forecast: Open-Meteo (CC BY 4.0): a local model for the first days (KNMI HARMONIE in the Netherlands, Météo-France AROME in Spain), then ECMWF, ICON and GFS, compared hour by hour for the "models agree" line. Waves and water temperature: Open-Meteo Marine. Coastlines: Natural Earth. A model forecast, not a beach sensor: every session is your own call. 18+.<br>' +
      '<a href="terms/">Terms</a> · <a href="privacy/">Privacy</a> · <a href="B27-Schools.dc.html">Schools + rental shops</a> · <a href="B27-City.dc.html">Other cities</a> · hi8ctane.com</div>' +
      '</main>' +
      '<div class="dock one"><button class="big join" data-act="goingbest" id="dockGo">I\'M GOING</button></div>' +
      '<div class="sheet" id="sheet" role="dialog" aria-modal="true" aria-labelledby="shTitle"></div><div class="toast" id="toast" role="status" aria-live="polite"></div>';
    var stops = [0, 5, 9, 13, 16, 19, 24, 28, 33, 38];
    $('#legendBar').style.background = 'linear-gradient(90deg,' + stops.map(function (k) { return window.HI8_WIND_COLOR(k) + ' ' + Math.round(k / 40 * 100) + '%'; }).join(',') + ')';
    placeMap();
  }
  // phones: the map sits in the page, under the crews; wide screens: it fills the left
  var wide = window.matchMedia ? window.matchMedia('(min-width: 960px)') : { matches: false };
  function placeMap() {
    var mw = $('.mapwrap'); if (!mw) return;
    var want = wide.matches ? app : $('#mapslot');
    if (mw.parentNode !== want) { want.appendChild(mw); if (map) setTimeout(fitMap, 30); }
  }
  if (wide.addEventListener) wide.addEventListener('change', placeMap);

  function buddyHtml() {
    var col = function (k, head, bg, icbg) {
      return '<div class="bud ' + k + '"><div class="bud-h" style="background:' + bg + '">' + head + '</div>' + BUDDY[k].map(function (x) {
        return '<div class="bud-i">' + bico(x[0], icbg) + '<span><b>' + esc(x[1]) + '</b><br>' + esc(x[2]) + '</span></div>';
      }).join('') + '</div>';
    };
    return '<div class="sec2"><b>RIDE WITH A BUDDY.</b><span>SAFER · MORE FUN</span></div>' +
      '<div class="buds">' + col('safe', 'SAFER', '#FF2D78', '#FFC2D6') + col('fun', 'MORE FUN', '#C8FF3D', '#DFFF7A') + '</div>' +
      '<div class="budcta"><span>Nobody free this weekend? <span class="mark">That\'s what crews are for.</span></span><button class="jn lm" data-act="join">FIND YOUR CREW</button></div>';
  }
  function trustHtml() {
    var cells = [['#C8FF3D', '<circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.4"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5M15 14c3 0 6 1.5 6 4"/>', 'Real riders', 'A founding plate and a level per sport on everyone.'],
      ['#FFE14D', '<path d="M4 4h16v16H4z"/><path d="M9 7v8h6"/>', 'A captain on every crew', 'Whoever starts it runs it. Rookie crews ride with an approved captain.'],
      ['#8DF5E8', '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>', 'Leave any time', 'Plans change: leave in one tap. The captain can call it off.'],
      ['#FFC2D6', '<path d="M5 21V3"/><path d="M5 4h13l-3 4.5 3 4.5H5"/>', 'Report', 'From every crew page, straight to our team. Only we see it.'],
      ['#FFFFFF', '<path d="M12 21.5S4.5 14.4 4.5 9a7.5 7.5 0 0 1 15 0c0 5.4-7.5 12.5-7.5 12.5z"/><path d="M9 9.2l2 2 4-4"/>', 'Check in at the spot', 'The crew sees who got there. Riders report how it really is.'],
      ['#E7E2D4', '<path d="M3 11 12 3l9 8"/><path d="M5 10v10h14V10"/>', 'Pickup hubs, not addresses', 'Nobody sees where you live. Names and cars are for the crew. 18+.']];
    return '<div class="sec2"><b>RIDING WITH STRANGERS?</b><span>HOW WE KEEP IT GOOD</span></div><div class="trust">' + cells.map(function (c) {
      return '<div class="tr"><span class="bico" style="background:' + c[0] + '"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + c[1] + '</svg></span><span><b>' + c[2] + '</b><br>' + c[3] + '</span></div>';
    }).join('') + '</div>';
  }
  function howHtml() {
    return '<div class="sec2"><b>HOW IT WORKS</b><span>NO APP · NO ACCOUNT UNTIL YOU GO</span></div><ol class="how3">' +
      '<li><i>1</i><span><b>We rate every spot,</b> hour by hour, for your level.</span></li>' +
      '<li><i>2</i><span><b>Tap I\'M GOING.</b> Drive and fill your car, take a seat, or meet there.</span></li>' +
      '<li><i>3</i><span><b>Check in at the spot.</b> Ride together. The fuel is split and the driver never profits.</span></li></ol>';
  }
  function drawNight() {
    var el = $('#night'); if (!el) return;
    if (S.city !== 'barcelona') { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = '<a class="night" href="B27-Night.dc.html"><div class="k">THE LAUNCH · SAT 23 JAN · BARCELONA · FREE</div><div class="t">FOUNDING NIGHT</div>' +
      '<p>Crews out by day, a party by night, the first 100 founding plates as patches.</p><div class="f"><span class="pill">150 SPOTS · FREE</span><span class="jn pk">RSVP FREE</span></div></a>';
  }
  // ---------------------------------------------------------------- the hero moves with the real wind
  // Streaks cross the hero in the direction and at the pace of the forecast wind of the next good session.
  var HW = { dir: 250, kt: 0, parts: [], raf: 0, on: true, still: !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) };
  function heroWind(o) {
    var f = o && o.fx, el = $('#heroWind'), has = f && f.w != null && f.dir != null;
    HW.kt = has ? f.w : 6; if (has) HW.dir = f.dir;
    if (el) el.innerHTML = has ? '<b>' + f.w + '</b> KT ' + esc(FX.compass(f.dir)) + '<i style="transform:rotate(' + ((f.dir + 180) % 360) + 'deg)">↑</i><span>' + esc(o.spot.name.toUpperCase()) + ' · ' + esc(dayRel(o.date)) + ' ' + pad(o.from) + '–' + pad(o.to) + '</span>' : '';
    heroFx();
  }
  function heroFx() {
    var cv = $('#heroFx'), box = $('#hero'); if (!cv || !box || !cv.getContext) return;
    var dpr = Math.min(2, window.devicePixelRatio || 1), w = box.clientWidth, h = box.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); HW.parts = []; }
    var n = Math.round(Math.min(90, w * h / 2600));
    while (HW.parts.length < n) HW.parts.push({ x: Math.random() * w, y: Math.random() * h, l: 14 + Math.random() * 46, s: .55 + Math.random() * .9, a: .2 + Math.random() * .4, lime: Math.random() < .2 });
    HW.parts.length = n;
    if (!HW.io && window.IntersectionObserver) { HW.io = new IntersectionObserver(function (e) { HW.on = e[0].isIntersecting; if (HW.on) heroKick(); }); HW.io.observe(box); }
    if (HW.still) heroFrame(true); else heroKick();
  }
  function heroKick() { if (!HW.raf && !HW.still) HW.raf = requestAnimationFrame(function () { HW.raf = 0; heroFrame(); }); }
  function heroFrame(once) {
    var cv = $('#heroFx'); if (!cv) return;
    var ctx = cv.getContext('2d'), dpr = cv.width / Math.max(1, cv.clientWidth), w = cv.clientWidth, h = cv.clientHeight;
    var th = (HW.dir + 180) * Math.PI / 180, dx = Math.sin(th), dy = -Math.cos(th), v = .5 + Math.min(40, HW.kt) * .13;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h); ctx.lineCap = 'round';
    for (var i = 0; i < HW.parts.length; i++) {
      var p = HW.parts[i], len = p.l * (.5 + Math.min(40, HW.kt) / 30);
      if (!once) { p.x += dx * v * p.s; p.y += dy * v * p.s; }
      if (p.x < -70) p.x = w + 60; else if (p.x > w + 70) p.x = -60;
      if (p.y < -70) p.y = h + 60; else if (p.y > h + 70) p.y = -60;
      var g = ctx.createLinearGradient(p.x - dx * len, p.y - dy * len, p.x, p.y), c = p.lime ? '200,255,61' : '255,255,255';
      g.addColorStop(0, 'rgba(' + c + ',0)'); g.addColorStop(1, 'rgba(' + c + ',' + p.a + ')');
      ctx.strokeStyle = g; ctx.lineWidth = p.lime ? 2.4 : 1.6;
      ctx.beginPath(); ctx.moveTo(p.x - dx * len, p.y - dy * len); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    if (!once && HW.on && !document.hidden) heroKick();
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && HW.on) heroKick(); });
  window.addEventListener('resize', function () { if ($('#heroFx')) heroFx(); });

  // the one button at the bottom: I'M GOING on the next good session
  function drawDock(L) {
    var b = $('#dockGo'); if (!b) return;
    var o = (L || sessions())[0];
    heroWind(o);
    b.innerHTML = 'I\'M GOING<small>' + (o ? 'NEXT: ' + esc(dayRel(o.date)) + ' ' + pad(o.from) + '–' + pad(o.to) + ' · ' + esc(o.spot.name.toUpperCase()) : 'PICK A DAY AND A SPOT') + '</small>';
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
    return '<span class="avs">' + show.map(function (x, i) { return '<span style="background:' + AVC[i % AVC.length] + '">' + esc(x) + '</span>'; }).join('') + (I.length > 4 ? '<span style="background:#E7E2D4">+' + (I.length - 4) + '</span>' : '') + '</span>';
  }
  function verdict(f, c) {
    if (c && c.live) return '<span class="vd t-live"><span class="blink wdot"></span>LIVE NOW</span>';
    if (!f) return '<span class="vd t-none">FORECAST SOON</span>';
    var key = c && c.sport === 'kite' ? f.w + ' KT ' + FX.compass(f.dir) : f.ground ? f.ground.toUpperCase() : '';
    return '<span class="vd t-' + FX.tone(f.score != null ? f.score : f.s) + '">' + esc(f.label) + (key ? ' · ' + esc(key) : '') + '</span>';
  }
  function mineCodes() { return ((HI8.mine && HI8.mine.crews) || []).map(function (x) { return x.code; }); }
  // a crew, the way 2.7 drew them: sport tile, the spot on the halftone, chips, who's going, the seat price
  function crewCard(c) {
    var f = crewFx(c), hub = hubOf(c), spot = HI8.spot(c.spot), free = c.max - c.going, inIt = mineCodes().indexOf(c.code) >= 0;
    var min = hub && spot ? HI8.driveMin(hub, spot) : null, lv = LVL[c.levels] || LVL.regular;
    var cost = hub && spot ? tripCost(hub, spot) : null, seat = cost ? seatMath(cost, 4) : null;
    var key = f ? (c.sport === 'kite' ? f.w + ' KT' : (f.ground || '').toUpperCase()) : '';
    return '<a class="sc" href="?c=' + esc(c.code) + '" data-act="crew" data-code="' + esc(c.code) + '" aria-label="' + esc(SPORT[c.sport].name + ' crew at ' + c.spot_name + ', ' + dayRel(c.day) + ' ' + hm(c.start)) + '">' +
      '<span class="sc-h"><span class="sc-t" style="background:' + SCOL[c.sport] + '">' + tile(c.sport, 40) + '<span>' + esc(SPORT[c.sport].name.toUpperCase()) + '</span></span>' +
      '<span class="sc-a art a-' + c.sport + '">' + (c.day === S.today ? '<span class="rib">TODAY</span>' : '') + '<span>' + verdict(f, c) + '</span><span class="sc-n">' + esc(c.spot_name.toUpperCase()) + '</span></span></span>' +
      '<span class="chips">' + (min ? '<span class="chip" style="background:#8DF5E8">' + CLOCK + min + ' MIN FROM ' + esc(String(hub.name).toUpperCase()) + '</span>' : '') +
      '<span class="chip" style="background:' + lv[1] + '">' + BARS + lv[0] + '</span><span class="chip">CAPTAIN ' + esc(String(c.host || '').toUpperCase()) + (c.host_plate ? ' #' + pad3(c.host_plate) : '') + '</span></span>' +
      '<span class="sc-f"><span class="sc-l"><span class="sc-w">' + esc(dayRel(c.day)) + ' ' + esc(hm(c.start)) + (key ? ' <em>' + esc(key) + '</em>' : '') + '</span>' +
      '<span class="sc-g">' + faces(c) + '<span>' + c.going + ' going' + (free > 0 && free <= 3 ? ' · ' + free + ' left' : '') + (c.here ? ' · ' + c.here + ' there' : '') + '</span>' +
      (c.seats_free > 0 && seat ? '<span class="seat" title="A seat, fuel split four ways">' + CAR + '<b>' + money(seat.pay) + '</b></span>' : '') + '</span></span>' +
      '<span class="jn' + (inIt ? ' wh' : free <= 0 ? ' wh' : '') + '">' + (inIt ? "YOU'RE IN" : free <= 0 ? 'FULL' : 'JOIN NOW') + '</span></span></a>';
  }
  function title(x) { return String(x || '').toLowerCase().replace(/(^|[\s'-])(\S)/g, function (m, a, b) { return a + b.toUpperCase(); }); }
  function pad3(n) { n = String(n); return n.length >= 3 ? n : ('00' + n).slice(-3); }
  function sec(t, tagTxt, more) { return '<div class="sec2"><b>' + t + '</b><span>' + (tagTxt || '') + '</span>' + (more || '') + '</div>'; }

  // ---------------------------------------------------------------- landing sections
  function drawTop() {
    var c = cityObj(S.city);
    $('#cityName').textContent = regionName().toUpperCase();
    $('#cityTag').textContent = S.settings && S.settings.pilot_city === S.city ? ' · PILOT' : '';
    var pl = myPlate(), b = $('#plate');
    b.textContent = pl ? '#' + pad3(pl) : signedIn() ? 'ME' : 'SIGN IN';
    b.className = 'tbme' + (pl ? ' plate' : '');
    var live = (S.settings && S.settings.live_sports) || LIVE_SPORTS, soon = (S.settings && S.settings.soon_sports) || SOON;
    $('#sports').innerHTML = live.filter(function (k) { return SPORT[k]; }).map(function (k) {
      return '<button class="stile mini" data-act="sport" data-sport="' + k + '" aria-pressed="' + (k === S.sport) + '" aria-label="' + SPORT[k].name + '">' + tile(k, 20) + '<span>' + SPORT[k].name.toUpperCase() + '</span></button>';
    }).join('');
    var ssEl = $('#soonSports'); if (ssEl) ssEl.innerHTML = soon.filter(function (k) { return SPORT[k]; }).map(function (k) {
      return '<button class="stile mini soon" data-act="soon" data-sport="' + k + '" aria-label="' + SPORT[k].name + ', coming soon">' + tile(k, 20) + '<span>' + SPORT[k].name.toUpperCase() + '</span><i>SOON</i></button>';
    }).join('');
    var hm0 = home(); $('#ctxFrom').innerHTML = hm0 ? 'FROM <b>' + esc(hm0.name) + '</b> ▾' : '<b>WHERE FROM?</b> ▸';
    $('#heroKick').textContent = 'LIVE CREWS · ' + live.map(function (k) { return (SPORT[k] || { name: k }).name.toUpperCase(); }).join(' · ') + ' · ' + regionName().toUpperCase();
    var all = upcoming(null, 7), riders = all.reduce(function (n, x) { return n + (x.going || 0); }, 0);
    $('#heroStat').innerHTML = all.length >= 5 ? '<b>' + all.length + '</b> CREW' + (all.length > 1 ? 'S' : '') + ' THIS WEEK · <b>' + riders + '</b> RIDER' + (riders === 1 ? '' : 'S') + ' GOING' : 'FREE · NO APP · FOUNDING PLATES OPEN';
  }
  function drawCrews() {
    var el = $('#crews'), h = home(); if (!el) return;
    var from = '<button class="fromb" data-act="from">' + (h ? 'FROM ' + esc(h.name) + ' ▾' : 'SET WHERE YOU START ▸') + '</button>';
    var head = function (n, note) { return '<div class="h2"><span class="pdot"></span>CREWS NEAR YOU</div><div class="h2s">' + n + ' COMING UP · ' + esc(SPORT[S.sport].name.toUpperCase()) + ' · ' + from + (n > 1 ? ' · SWIPE →' : '') + '</div>' + (note ? '<p class="lede" style="margin:6px 0 0 19px">' + note + '</p>' : ''); };
    if (!HI8.live) { el.innerHTML = head(0) + '<div class="rail"><div class="nocrew"><b>Crews need the live site</b><br>Open hi8ctane.com to see and start crews.</div></div>'; return; }
    var all = upcoming(S.sport, 14);
    if (!HI8.crews && !S.live) { el.innerHTML = head(0) + '<div class="rail"><div class="skel sc"></div><div class="skel sc"></div></div>'; return; }
    var near = h ? all.filter(isNear) : all, list = near.length ? near : all;
    var note = h && !near.length && all.length ? 'None from near ' + esc(title(h.name)) + ' yet: here are the ' + all.length + ' in the ' + esc(regionName()) + '. Or start the first one from ' + esc(title(h.name)) + '.' : '';
    el.innerHTML = head(list.length, note) + '<div class="rail">' + (list.length ? list.slice(0, 8).map(crewCard).join('') + (list.length > 8 ? '<button class="nocrew more" data-act="join"><b>+' + (list.length - 8) + ' MORE</b><br>See them all →</button>' : '') : emptyCrews()) + '</div>' +
      (list.length ? '<div class="two2"><button class="hbtn" data-act="join">SEE ALL CREWS</button><button class="hbtn lime" data-act="start">START A CREW</button></div>' : '');
  }
  function emptyCrews() {
    var h = home();
    return '<div class="nocrew"><b>No ' + esc(SPORT[S.sport].name) + ' crew yet</b><br>Start the first one' + (h ? ' from ' + esc(title(h.name)) : '') + ': pick a window, a spot, share it to your group chats. 20 seconds.' +
      '<br><button class="jn lm" data-act="start" style="margin-top:12px">START ONE</button>' + alertBox() + '</div>';
  }
  function alertBox() {
    var mine = (HI8.mine && HI8.mine.alerts) || [], on = mine.some(function (a) { return a.city === S.city && a.sport === S.sport; });
    if (signedIn()) {
      return '<p class="ab">' + (on ? 'You get an email when someone posts a ' + esc(SPORT[S.sport].name) + ' crew here.' : 'Or get an email when someone posts a ' + esc(SPORT[S.sport].name) + ' crew here:') + '</p>' +
        '<button class="hbtn ' + (on ? '' : 'ink') + '" data-act="alert" data-on="' + (!on) + '" style="width:100%">' + (on ? 'STOP THESE EMAILS' : 'EMAIL ME NEW ' + esc(SPORT[S.sport].name.toUpperCase()) + ' CREWS') + '</button>';
    }
    return '<p class="ab">Or get an email when someone posts a ' + esc(SPORT[S.sport].name) + ' crew here:</p>' +
      '<form class="send" data-form="alert"><label class="sr" for="alertEmail">Email</label><input class="inp" id="alertEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com" required><button type="submit">ALERT ME</button></form>' +
      '<p class="hint">You get a founding plate with it. One click stops the emails.</p>';
  }
  function drawLive() {
    var el = $('#live'), L = S.live;
    var reps = L ? (L.reports || []).filter(function (r) { return r.sport === S.sport; }) : [];
    var on = upcoming(S.sport, 1).filter(function (c) { return c.live; });
    if (!reps.length && !on.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = sec('AT THE SPOTS NOW', 'LIVE · FROM RIDERS THERE') + '<div class="reports">' + on.map(function (c) {
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

  // THE WEEK AHEAD: every live sport x 7 days, at its best spot that day
  function drawWeek() {
    var el = $('#week'), live = ((S.settings && S.settings.live_sports) || LIVE_SPORTS).filter(function (k) { return LIVE_SPORTS.indexOf(k) >= 0; });
    var head = sec('THE WEEK AHEAD', 'THE GOOD-DAY METER · ' + esc((cityObj(S.city).name || '').toUpperCase()));
    if (!FX.data[S.city]) { el.innerHTML = head + '<div class="wk">' + (FX.error ? '<p class="wkn">No forecast right now: Open-Meteo can\'t be reached. Crews still work.</p>' : '<div class="skel" style="height:150px;background:#222"></div>') + '</div>'; return; }
    var dates = []; for (var i = 0; i < 7; i++) dates.push(FX.addDays(S.today, i));
    var rows = live.map(function (k) {
      var D = FX.bestDays(S.city, spotsFor(S.city, k), k, { kg: kg() }, 7), top = Math.max.apply(null, D.map(function (d) { return d.none ? 0 : d.score; }));
      return '<span class="wl' + (k === S.sport ? ' on' : '') + '">' + tile(k, 20) + SPORT[k].name.toUpperCase() + '</span>' + D.map(function (d, i) {
        if (d.nodata) return '<span class="wc t-none">–</span>';
        var t = d.none ? 'no' : FX.tone(d.score), best = !d.none && d.score === top && d.score >= 6;
        var a = SPORT[k].name + ' ' + FX.dayName(d.date, S.today) + ': ' + (d.none ? 'no go' : d.label + ' ' + Math.round(d.score) + ' out of 10 at ' + d.spot.name + ', ' + pad(d.from) + ' to ' + pad(d.to));
        return '<button class="wc t-' + t + (best ? ' best' : '') + '" data-act="wkcell" data-sport="' + k + '" data-i="' + i + '" data-spot="' + (d.spot ? d.spot.slug : '') + '" aria-label="' + esc(a) + '">' +
          (d.none ? 'NO' : esc(d.label)) + '<small>' + (d.none ? '·' : (k === 'kite' ? d.w + 'KT' : Math.round(d.score))) + '</small></button>';
      }).join('');
    }).join('');
    el.innerHTML = head + '<div class="wk"><div class="wkg"><span></span>' + dates.map(function (d, i) { return '<span class="wkh' + (i === 0 ? ' td' : '') + '">' + (i === 0 ? 'TODAY' : FX.dayShort(d)) + '<small>' + Number(d.slice(8)) + '</small></span>'; }).join('') + rows + '</div>' +
      '<p class="wkn">Every sport, every day, at its best spot, rated hour by hour. Outlined: the best day. Days 1-2 from ' + esc(FX.MODEL_NAME[FX.CITY_MODEL[S.city]] || 'the best model') + ' (Météo-France, 1.3 km), then ECMWF, ICON and GFS. Tap a day for the hour-by-hour.</p></div>';
  }

  // THE BEST WINDOW for the chosen sport in the next 7 days, with the numbers behind it
  function drawBest() {
    var el = $('#best'), spots = spotsFor(S.city, S.sport);
    if (!FX.data[S.city]) { el.innerHTML = ''; return; }
    var days = FX.bestDays(S.city, spots, S.sport, { kg: kg() }, 7);
    var cand = days.filter(function (d) { return !d.none && d.score >= 4; }), top = Math.max.apply(null, cand.map(function (d) { return d.score; }).concat([0]));
    var good = cand.filter(function (d) { return d.score >= top - 0.7; })[0]; // the soonest one that's about as good as the best
    var head = sec('THE BEST WINDOW', esc(SPORT[S.sport].name.toUpperCase()) + ' · NEXT 7 DAYS');
    if (!good) {
      el.innerHTML = head + '<div class="card pad"><b class="t15">No good ' + esc(SPORT[S.sport].name) + ' window this week</b><p class="hint">' + (S.sport === 'kite' ? 'Not enough wind, or it blows offshore.' : 'Rain or mud on the way.') + ' You can still start a crew for any time.</p></div>';
      return;
    }
    var sp = fxSpot(good.spot.slug), info = FX.dayInfo(sp, good.date) || {}, m = good.models, kite = S.sport === 'kite';
    var stat = function (k, v, s) { return v == null || v === '' ? '' : '<div class="st"><span>' + k + '</span><b>' + v + '</b>' + (s ? '<small>' + s + '</small>' : '') + '</div>'; };
    var stats = kite ? [stat('WIND', good.w + ' KT', FX.compass(good.dir)), stat('GUSTS', good.g + ' KT', '+' + Math.max(0, good.g - good.w)), (good.kite ? '<button class="st st-kg" data-act="kg" aria-label="Your kite: ' + good.kite + ' metres for ' + kg() + ' kilos. Change your weight"><span>YOUR KITE</span><b>' + good.kite + ' M</b><small>' + kg() + ' KG · CHANGE</small></button>' : ''),
      stat('WAVES', info.wave != null ? info.wave + ' M' : '', info.period ? info.period + ' S' : ''), stat('WATER', info.sst != null ? info.sst + '°C' : '', info.sst != null ? (info.sst < 15 ? '4/3 + boots' : info.sst < 18 ? '4/3 wetsuit' : info.sst < 21 ? '3/2 wetsuit' : 'shorty') : ''),
      stat('RAIN', info.pop != null ? info.pop + '%' : '', info.cloud != null ? 'cloud ' + info.cloud + '%' : '')]
      : [stat('GROUND', (good.ground || '').toUpperCase(), 'rain 24 h: ' + ((rowAt(good.spot.slug, good.date + 'T' + pad(good.from) + ':00') || {}).r24 || 0) + ' mm'), stat('TEMP', info.tmin != null ? (info.tmin === info.tmax ? info.tmax : info.tmin + '-' + info.tmax) + '°' : '', ''),
        stat('RAIN', info.pop != null ? info.pop + '%' : '', info.cloud != null ? 'cloud ' + info.cloud + '%' : ''), stat('WIND', info.w != null ? info.w + ' KT' : '', 'gusts ' + (info.g || '–'))];
    stats.push(stat('LIGHT', info.sunrise || '', info.sunset ? 'to ' + info.sunset : ''));
    stats.push(stat('MODELS', m ? m.n + ' OF ' + m.of : '', m ? m.label : ''));
    el.innerHTML = head + '<div class="bw"><div class="bw-t ht"><div class="kick" style="color:#C8FF3D">' + esc(FX.dayName(good.date, S.today)) + ' · ' + esc(dayLong(good.date)) + '</div>' +
      '<span class="stamp t-' + FX.tone(good.score) + '">' + esc(good.label) + '</span>' +
      '<div class="bw-v">' + pad(good.from) + ':00-' + pad(good.to) + ':00<br><span>' + esc(good.spot.name.toUpperCase()) + '</span></div>' +
      (good.runTo - good.runFrom > good.to - good.from ? '<div class="bw-s">' + (good.shore ? esc(title(good.shore)) + '. ' : '') + 'Good from ' + pad(good.runFrom) + ' to ' + pad(good.runTo) + '. ' : '<div class="bw-s">' + (good.shore ? esc(title(good.shore)) + '. ' : '')) + esc((good.why || []).join(' · ')) + '</div></div>' +
      '<div class="bw-g">' + stats.join('') + '</div>' +
      '<div class="bw-src">' + SHIELD + '<span>' + esc(FX.sourceFor(S.city, good.date, S.today)) + (m ? ' · ' + (m.n === m.of ? 'ECMWF, ICON and GFS all agree' : m.n ? esc(m.names.join(' and ')) + ' agree' + (m.n === 1 ? 's' : '') + ', the others don\'t' : 'the other models disagree: check again') : '') + '.</span></div>' +
      '<div class="bw-b"><button class="jn pk lg" data-act="startwin" data-date="' + good.date + '" data-from="' + good.from + '" data-to="' + good.to + '" data-spot="' + good.spot.slug + '">START A CREW FOR IT</button>' +
      '<button class="hbtn" data-act="spotat" data-spot="' + good.spot.slug + '" data-date="' + good.date + '">HOURLY →</button></div></div>';
  }

  // FILL THE CAR: what a seat costs, solo vs shared, with the Hi8 fee
  function drawSave() {
    var el = $('#save'), hubs = startHubs().slice(0, 5), spots = spotsFor(S.city, S.sport);
    if (!hubs.length || !spots.length) { el.innerHTML = ''; return; }
    var sv = S.save || (S.save = {});
    if (!sv.hub || !hubs.some(function (h) { return h.slug === sv.hub; })) sv.hub = hubs[0].slug;
    if (!sv.spot || !spots.some(function (s) { return s.slug === sv.spot; })) { // the furthest-but-popular one makes the point: pick the second furthest
      var by = spots.slice().sort(function (a, b) { return HI8.km(hubs[0], b) - HI8.km(hubs[0], a); }); sv.spot = (by[1] || by[0]).slug;
    }
    var hub = hubs.filter(function (h) { return h.slug === sv.hub; })[0], spot = HI8.spot(sv.spot), cost = tripCost(hub, spot);
    if (!cost) { el.innerHTML = ''; return; }
    var M = [1, 2, 3, 4].map(function (n) { return seatMath(cost, n); }), mx = M[0].solo, full = M[3];
    var bars = M.map(function (m, i) {
      var h = Math.max(10, Math.round(84 * m.share / mx)), fh = Math.round(84 * m.fee / mx);
      return '<div class="bar' + (i === 3 ? ' on' : '') + '"><span class="v">' + money(m.share + m.fee) + '</span>' + (m.fee ? '<span class="fee" style="height:' + Math.max(3, fh) + 'px" title="Hi8 fee"></span>' : '') + '<span class="b" style="height:' + h + 'px"></span></div>';
    }).join('');
    el.innerHTML = sec('FILL THE CAR. PAY A QUARTER.', 'YOUR SAVINGS') +
      '<div class="card sv"><div class="svc"><span class="lb1">FROM</span><div class="row">' + hubs.map(function (h) { return '<button class="opt sm" data-act="svhub" data-hub="' + h.slug + '" aria-pressed="' + (h.slug === sv.hub) + '">' + esc(h.name) + '</button>'; }).join('') + '</div>' +
      '<span class="lb1">TO</span><div class="row">' + spots.map(function (s) { return '<button class="opt sm" data-act="svspot" data-spot="' + s.slug + '" aria-pressed="' + (s.slug === sv.spot) + '">' + esc(s.name.toUpperCase()) + '</button>'; }).join('') + '</div></div>' +
      '<div class="bars">' + bars + '</div><div class="barl"><span>SOLO</span><span>2 IN</span><span>3 IN</span><span class="pk">FULL CAR</span></div>' +
      '<div class="svs"><div><span>A DAY OUT</span><b>' + money(full.save) + '</b><small>saved, full car</small></div><div><span>20 DAYS OUT</span><b>' + money(full.save * 20) + '</b><small>a season</small></div><div><span>DRIVING?</span><b>' + money(full.share * 3) + '</b><small>back from 3 riders</small></div></div>' +
      '<p class="svn">' + esc(title(hub.name)) + ' to ' + esc(spot.name) + ' and back: about ' + Math.round(HI8.km(hub, spot) * 2.6) + ' km, ' + money(cost) + ' of fuel. In a full car you pay ' + money(full.share) + (full.fee ? ' + ' + feeLine(full) : '') + '. Tolls and parking split the same way.</p>' +
      '<div class="feebox">' + SHIELD + '<span><b>How Hi8ctane stays free:</b> riders add ' + feePct() + '% to their share of the car. The driver always gets the full share, no ads, nothing to install. <span class="mark">' + (feeLive() ? 'Paid in the app when you settle up.' : 'Free during the pilot.') + '</span></span></div></div>';
  }

  // PLANS: days out, better with others (from Supabase: public.plans)
  function planCard(p) {
    var mine = !!p.mine;
    return '<button class="pc" data-act="plan" data-plan="' + esc(p.slug) + '" aria-label="' + esc(p.title + ' at ' + p.place) + '">' +
      '<span class="pc-h art a-' + esc(p.kind) + '">' + (p.badge ? '<span class="rib y">' + esc(p.badge) + '</span>' : '') + '<span class="pc-k">' + tile(p.kind, 30) + '<i>' + esc((p.kind === 'wake' ? 'WAKE' : (SPORT[p.kind] || { name: p.kind }).name).toUpperCase()) + '</i></span>' +
      '<span class="pc-n">' + esc(p.title.toUpperCase()) + '</span><span class="pc-p">' + esc(p.place) + '</span></span>' +
      '<span class="pc-b"><span class="pc-d">' + esc(p.blurb) + '</span><span class="chips">' + (p.includes || []).slice(0, 3).map(function (x, i) { return '<span class="chip" style="background:' + ['#FFFFFF', '#8DF5E8', '#FFE14D'][i] + '">' + esc(x.toUpperCase()) + '</span>'; }).join('') + '</span>' +
      '<span class="pc-f"><span class="pc-pr">' + (p.price_from != null ? 'FROM <b>€' + Math.round(p.price_from) + '</b>' : 'PRICE ON REQUEST') + '<small>' + (p.interested ? p.interested + ' IN' : 'BE THE FIRST') + '</small></span><span class="jn ' + (mine ? 'wh' : 'lm') + '">' + (mine ? "YOU'RE IN" : "I'M IN") + '</span></span></span></button>';
  }
  function drawPlans() {
    var el = $('#plans'), P = (S.plans || []).filter(function (p) { return p.city === S.city; });
    if (!P.length) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = sec('PLANS', 'DAYS OUT · BETTER WITH OTHERS') + '<p class="lede">Something different for a day: say you\'re in, pick a day, and we put you together with the others going.</p><div class="rail">' + P.map(planCard).join('') + '</div>';
  }
  // WHERE NEXT? Tarifa (live), the regions coming soon, kite trips any partner lists, and how to list one
  var WHERE = {
    tarifa: { tag: 'OPEN NOW', place: 'Andalusia, Spain', blurb: "Europe's kite capital: Levante and Poniente at Los Lances and Valdevaqueros, surf at El Palmar. Crews from Tarifa, Algeciras and Cádiz.", chips: ['KITE', 'WING', 'SURF'] },
    tatajuba: { tag: 'COMING SOON', place: 'Ceará, Brazil', blurb: 'Flat lagoons and steady trade winds, roughly July to January. Tell us you want in and you hear first when trips and crews open.', chips: ['KITE', 'LAGOONS', 'TRIPS'] }
  };
  function whereCard(c) {
    var w = WHERE[c.slug] || { tag: c.status === 'open' ? 'OPEN NOW' : 'COMING SOON', place: c.region || '', blurb: '', chips: [] }, open = c.status === 'open';
    var head = '<span class="pc-h art a-' + (c.slug === 'tatajuba' ? 'surf' : 'kite') + '"><span class="rib ' + (open ? 'y' : '') + '">' + esc(w.tag) + '</span><span class="pc-k">' + tile('kite', 30) + '<i>' + esc(open ? 'LIVE REGION' : 'WAITLIST') + '</i></span>' +
      '<span class="pc-n">' + esc(c.name.toUpperCase()) + '</span><span class="pc-p">' + esc(w.place) + '</span></span>';
    var chips = '<span class="chips">' + w.chips.map(function (x, i) { return '<span class="chip" style="background:' + ['#FFFFFF', '#8DF5E8', '#FFE14D'][i % 3] + '">' + esc(x) + '</span>'; }).join('') + '</span>';
    if (open) return '<button class="pc" data-act="setcity" data-city="' + esc(c.slug) + '" aria-label="Go to ' + esc(c.name) + '">' + head + '<span class="pc-b"><span class="pc-d">' + esc(w.blurb) + '</span>' + chips +
      '<span class="pc-f"><span class="pc-pr">CREWS · SPOTS · FORECAST</span><span class="jn lm">' + (S.city === c.slug ? "YOU'RE HERE" : 'GO') + '</span></span></span></button>';
    var on = (S.waitlisted || {})[c.slug];
    return '<div class="pc">' + head + '<span class="pc-b"><span class="pc-d">' + esc(w.blurb) + '</span>' + chips + '<span class="pc-f" style="flex-direction:column;align-items:stretch">' +
      (on ? '<span class="jn wh">YOU\'RE ON THE LIST</span>'
        : signedIn() ? '<button class="jn lm" data-act="waitlist" data-city="' + esc(c.slug) + '">' + (S.wlBusy === c.slug ? '<span class="spin"></span>' : 'TELL ME FIRST') + '</button>'
        : '<form class="send" data-form="where" data-city="' + esc(c.slug) + '"><label class="sr" for="wl-' + esc(c.slug) + '">Email</label><input class="inp" id="wl-' + esc(c.slug) + '" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com" required><button type="submit">TELL ME</button></form>') +
      '</span></span></div>';
  }
  function drawWhere() {
    var el = $('#where'); if (!el) return;
    var cs = (HI8.placesNow().cities || []).filter(function (c) { return WHERE[c.slug] && (c.slug !== S.city); });
    var trips = (S.trips || []);
    var list = '<a class="pc" href="mailto:hello@hi8ctane.com?subject=List%20our%20trip%20on%20Hi8ctane"><span class="pc-h art a-mx"><span class="pc-k">' + tile('kite', 30) + '<i>FOR TRIP OPERATORS</i></span><span class="pc-n">LIST YOUR TRIP</span><span class="pc-p">Kite camps, surf trips, MTB and moto tours</span></span>' +
      '<span class="pc-b"><span class="pc-d">Run trips? Put them in front of riders who already ride together. Free to list; we take 10% only on bookings we send.</span><span class="pc-f"><span class="pc-pr">HELLO@HI8CTANE.COM</span><span class="jn lm">GET LISTED</span></span></span></a>';
    el.innerHTML = sec('WHERE NEXT?', 'TRIPS · NEW REGIONS') + '<p class="lede">Ride further: a new region, a trip with your crew, or a spot on the list for the next one.</p>' +
      '<div class="rail">' + cs.map(whereCard).join('') + trips.map(planCard).join('') + list + '</div>';
  }
  // ---------------------------------------------------------------- iteration 3: set up inline, conditions now, one list
  // MAKE IT YOURS: where you start (once). Shown until it's set; nothing pops up.
  function drawSetup() {
    var el = $('#setup'); if (!el) return;
    if (home()) { el.innerHTML = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    var T = HI8.hubsOf(S.city).slice(0, 4).concat(towns().filter(function (t) { return t.rank <= 2 && !HI8.hubsOf(S.city).some(function (h) { return HI8.km(h, t) < 1.5; }); }).slice(0, 4));
    el.innerHTML = '<div class="setupc"><b>WHERE DO YOU START FROM?</b><span>Your spots, drive times, crews and seat prices from there. Stays on this phone.</span>' +
      '<div class="row"><button class="opt dk" data-act="geo">' + (S.geoBusy ? '<span class="spin"></span>' : 'USE MY LOCATION') + '</button>' +
      T.map(function (x) { return '<button class="opt sm" data-act="sethome" data-name="' + esc(x.name) + '" data-lat="' + x.lat + '" data-lon="' + x.lon + '">' + esc(x.name) + '</button>'; }).join('') +
      '<button class="opt sm" data-act="from">MORE…</button></div>' + (S.geoErr && !S.view ? '<p class="hint">' + esc(S.geoErr) + '</p>' : '') + '</div>';
  }
  function driveFromMe(spot) { var h = home() || HI8.hubsOf(S.city)[0]; return h ? HI8.driveMin(h, spot) : null; }
  function spotsNear() {
    var L = spotsFor(S.city, S.sport).map(function (sp) { return { spot: sp, min: driveFromMe(sp) }; });
    L.sort(function (a, b) { return (a.min || 0) - (b.min || 0); });
    return L;
  }
  // RIGHT NOW AT YOUR SPOTS: the nearest spots, as they are this hour (or the next daylight hour)
  function drawNow() {
    var el = $('#now'); if (!el) return;
    var head = sec('RIGHT NOW AT YOUR SPOTS', home() ? 'NEAREST FIRST · FROM ' + esc(home().name) : 'NEAREST FIRST');
    if (!FX.data[S.city]) { el.innerHTML = head + '<div class="rail">' + (FX.error ? '<div class="nocrew">No forecast right now: Open-Meteo can\'t be reached.</div>' : '<div class="skel nowc"></div><div class="skel nowc"></div><div class="skel nowc"></div>') + '</div>'; return; }
    var t = S.today + 'T' + pad(Math.max(8, Math.min(S.nowH, 17))) + ':00', reps = S.live ? (S.live.reports || []) : [], live = upcoming(S.sport, 1);
    el.innerHTML = head + '<div class="rail nowr">' + spotsNear().map(function (x) {
      var sp = x.spot, r = rowAt(sp.slug, t), rt = rateAt(sp, t), rep = reps.filter(function (q) { return q.spot === sp.slug && q.sport === S.sport; })[0];
      var crews = live.filter(function (c) { return c.spot === sp.slug; }).length, tone = rt ? (rt.dark ? 'none' : FX.tone(rt.s)) : 'none';
      var big = !r || !rt ? '–' : S.sport === 'kite' ? Math.round(r.w) : Math.round(rt.s), unit = S.sport === 'kite' ? 'KT' : '/10';
      var sub = !r || !rt ? 'no forecast' : S.sport === 'kite' ? FX.compass(r.dir) + ' · gusts ' + Math.round(r.g) + (rt.shore ? ' · ' + rt.shore : '') : (rt.ground || '') + ' · ' + Math.round(r.temp) + '°C' + (r.mm ? ' · rain' : '');
      return '<button class="nowc" data-act="spot" data-spot="' + sp.slug + '" aria-label="' + esc(sp.name + ' now: ' + (rt ? rt.label : 'no forecast')) + '">' +
        '<span class="nv t-' + tone + '">' + esc(rt ? (rt.dark ? 'DARK' : rt.label) : '–') + '</span><span class="nn">' + esc(sp.name.toUpperCase()) + '</span>' +
        '<span class="nb">' + big + '<small>' + unit + '</small>' + (S.sport === 'kite' && r ? arrow(r.dir) : '') + '</span><span class="ns">' + esc(sub) + '</span>' +
        '<span class="nf">' + (x.min ? CLOCK + x.min + ' MIN' : '') + (crews ? ' · <b>' + crews + ' CREW' + (crews > 1 ? 'S' : '') + ' TODAY</b>' : '') + (rep ? ' · <b class="rp">' + esc(rep.verdict.toUpperCase()) + ' ' + esc(ago(rep.at)) + '</b>' : '') + '</span></button>';
    }).join('') + '</div><p class="wkn" style="color:var(--mute);margin:0">' + (S.nowH > 17 ? 'Late today: showing 17:00. ' : S.nowH < 8 ? 'Early: showing 08:00. ' : '') + 'Tap a spot for its 7-day, hour-by-hour forecast.</p>';
  }
  // NEXT GOOD SESSIONS: one list to join or start. A good window with a crew = JOIN; without = START IT.
  function sessions() {
    var near = spotsNear(), bySpot = {}; near.forEach(function (x) { bySpot[x.spot.slug] = x; });
    var out = [], crews = upcoming(S.sport, 14).filter(home() ? isNear : function () { return true; });
    if (FX.data[S.city]) for (var i = 0; i < 7; i++) {
      var date = FX.addDays(S.today, i), best = [];
      near.forEach(function (x) { var sp = fxSpot(x.spot.slug); var w = sp ? FX.windows(sp, date, S.sport, x.spot, { kg: kg() })[0] : null; if (w && w.score >= 6) best.push(Object.assign({ spot: x.spot, min: x.min }, w)); });
      if (i === 0) best = best.filter(function (w) { return S.nowH * 60 + S.nowM + (w.min || 0) <= w.to * 60 - 90; }); // today: only if you'd still get 90 minutes
      best.sort(function (a, b) { return b.score - a.score || a.min - b.min; });
      best.slice(0, 2).forEach(function (w) { out.push({ date: date, from: w.from, to: w.to, spot: w.spot, min: w.min, fx: w, crews: [] }); });
    }
    crews.forEach(function (c) {
      var f0 = Number(hm(c.start).slice(0, 2)), hit = out.filter(function (o) { return o.date === c.day && o.spot.slug === c.spot && f0 < o.to && f0 + 3 > o.from; })[0];
      if (hit) hit.crews.push(c);
      else { var sp = HI8.spot(c.spot); if (sp) out.push({ date: c.day, from: f0, to: c.end ? Number(hm(c.end).slice(0, 2)) : f0 + 3, spot: sp, min: driveFromMe(sp), fx: crewFx(c), crews: [c] }); }
    });
    out.sort(function (a, b) { return (a.date + pad(a.from)).localeCompare(b.date + pad(b.from)) || b.crews.length - a.crews.length; });
    return out.slice(0, 8);
  }
  function hourBars(o) {
    var sp = fxSpot(o.spot.slug); if (!sp) return '';
    var rows = FX.dayRows(sp, o.date, S.sport, o.spot, { kg: kg() }, Math.max(6, o.from - 2), Math.min(21, o.to + 1));
    return '<span class="hb">' + rows.map(function (r) {
      var v = S.sport === 'kite' ? Math.min(1, (r.w || 0) / 30) : Math.min(1, (r.rate ? r.rate.s : 0) / 10), t = r.rate ? (r.rate.dark ? 'none' : FX.tone(r.rate.s)) : 'none', inw = r.h >= o.from && r.h < o.to;
      return '<i class="t-' + t + (inw ? ' in' : '') + '" style="height:' + Math.max(8, Math.round(v * 30)) + 'px" title="' + pad(r.h) + ':00' + (S.sport === 'kite' ? ' · ' + Math.round(r.w) + ' kt' : '') + '"></i>';
    }).join('') + '</span><span class="hbl"><span>' + pad(Math.max(6, o.from - 2)) + '</span><span>' + pad(Math.min(21, o.to + 1)) + '</span></span>';
  }
  function drawSessions() {
    var el = $('#sessions'); if (!el) return;
    var h = home(), L = sessions();
    var head = '<div class="h2"><span class="pdot"></span>NEXT GOOD SESSIONS</div><div class="h2s">' + esc(SPORT[S.sport].name.toUpperCase()) + ' · ' + (h ? 'FROM ' + esc(h.name) : esc(regionName().toUpperCase())) + ' · JOIN THE CREW GOING, OR BE THE FIRST</div>';
    if (!FX.data[S.city] && !L.length) { el.innerHTML = head + '<div class="sess"><div class="skel" style="height:150px"></div></div>'; return; }
    if (!L.length) { el.innerHTML = head + '<div class="sess">' + emptyCrews() + '</div>'; return; }
    var shown = S.allSess ? L : L.slice(0, 4);
    el.innerHTML = head + '<div class="sess">' + shown.map(function (o, i) {
      var f = o.fx, c = o.crews[0], kite = S.sport === 'kite';
      var key = f ? (kite ? f.w + ' KT ' + FX.compass(f.dir) + (f.g ? ' · G' + f.g : '') : (f.ground || '').toUpperCase() + (f.temp != null ? ' · ' + f.temp + '°C' : '')) : 'FORECAST SOON';
      var crewLine = c ? (function () { var hub = hubOf(c), cost = hub ? tripCost(hub, o.spot) : null, m = cost ? seatMath(cost, 4) : null, more = o.crews.length - 1;
        return '<span class="sg">' + faces(c) + '<span><b>' + esc(c.host) + '\'s crew</b> · ' + c.going + ' going' + (c.seats_free > 0 ? ' · ' + c.seats_free + ' seat' + (c.seats_free > 1 ? 's' : '') + (hub ? ' from ' + esc(title(hub.name)) : '') + (m ? ' ' + money(m.pay) : '') : '') + (more ? ' · +' + more + ' more' : '') + '</span></span>'; })()
        : '<span class="sg none">Nobody yet. Go first: everyone near you sees it.</span>';
      return '<div class="ss' + (c ? ' has' : '') + (i === 0 ? ' top' : '') + '">' +
        '<div class="ss-t"><span class="ss-d">' + esc(dayRel(o.date)) + ' <b>' + pad(o.from) + '–' + pad(o.to) + '</b></span>' + (f ? '<span class="vd t-' + FX.tone(f.score != null ? f.score : f.s) + '">' + esc(f.label) + '</span>' : '') + (c && c.live ? '<span class="vd t-live">LIVE</span>' : '') + '</div>' +
        '<button class="ss-n" data-act="spotat" data-spot="' + o.spot.slug + '" data-date="' + o.date + '">' + esc(o.spot.name.toUpperCase()) + ' <small>' + (o.min ? o.min + ' MIN' : '') + ' ›</small></button>' +
        '<div class="ss-m"><span class="ss-k">' + esc(key) + (f && f.kite && kite ? ' · ' + f.kite + ' M KITE' : '') + (f && f.models && f.models.label ? ' · ' + f.models.label : '') + '</span>' + hourBars(o) + '</div>' +
        '<div class="ss-f">' + crewLine + (c ? '<button class="jn lm" data-act="going" data-code="' + esc(c.code) + '">I\'M GOING</button>'
          : '<button class="jn lm" data-act="startwin" data-date="' + o.date + '" data-from="' + o.from + '" data-to="' + o.to + '" data-spot="' + o.spot.slug + '">I\'M GOING</button>') + '</div></div>';
    }).join('') + '</div>' + (L.length > shown.length ? '<button class="hbtn wide" data-act="allsess">MORE GOOD SESSIONS · +' + (L.length - shown.length) + '</button>' : '') +
      '<div class="two2"><button class="hbtn" data-act="join">ALL CREWS</button><button class="hbtn" data-act="start">START A CREW</button></div>' +
      (L.some(function (o) { return o.crews.length; }) ? '' : '<div class="alertw">' + alertBox() + '</div>');
    drawDock(L);
  }

  // NO CREW FROM YOUR TOWN YET? Crews leave from wherever riders live: the first one from a town puts it on the list
  function drawTowns() {
    var el = $('#towns'); if (!el) return;
    var h = home(), A = HI8.hubsOf(S.city).slice().sort(function (a, b) { return (b.crews || 0) - (a.crews || 0) || (a.kind === 'town') - (b.kind === 'town'); });
    var hasMine = h && A.some(function (x) { return HI8.km(x, h) < 1.5; });
    el.innerHTML = '<div class="ycard"><div class="yh"><b>' + (h && !hasMine ? 'NO CREW FROM ' + esc(h.name) + ' YET?' : 'NO CREW FROM YOUR TOWN YET?') + '</b><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="#111" stroke-width="2.4"><circle cx="12" cy="12" r="9.6"/><path d="M2.4 12h19.2M12 2.4c3.3 3.2 3.3 16 0 19.2M12 2.4c-3.3 3.2-3.3 16 0 19.2"/></g></svg></div>' +
      '<p>Crews leave from wherever riders live. Start the first one from your town and it\'s on the list for everyone near you. The spots are the same for the whole ' + esc(regionName()) + '.</p>' +
      '<div class="lb1" style="margin-top:10px">CREWS LEAVE FROM</div><div class="cities">' + A.slice(0, 6).map(function (x) { return '<span>' + esc(x.name) + '<small>' + (x.crews ? x.crews + ' CREW' + (x.crews > 1 ? 'S' : '') : x.kind === 'town' ? 'STARTED BY RIDERS' : 'PICK-UP POINT') + '</small></span>'; }).join('') + '</div>' +
      (h ? '<button class="go" data-act="startfrom">START ONE FROM ' + esc(h.name) + ' →</button>' : '<button class="go" data-act="from">SET WHERE YOU START →</button>') +
      '<a class="go2" href="B27-City.dc.html">Outside the Netherlands and Catalonia? Ask for your region →</a></div>';
  }
  function drawAll() {
    refreshToday(); drawTop(); drawTime(); drawMapSpots(); drawSetup(); drawNow(); drawSessions(); drawCrews(); drawLive(); drawWeek(); drawBest(); drawSave(); drawPlans(); drawTowns(); drawWhere(); drawNight();
    if (S.view) renderSheet();
  }

  // ---------------------------------------------------------------- sheets (join, start, crew, spot, me, city, soon)
  var sheet = null;
  function go(hash) { if (location.hash === hash) route(); else location.hash = hash; }
  function closeSheet() {
    if (S.view === 'crew') { history.replaceState(null, '', location.pathname + (S.variant !== 'map' ? '?v=' + S.variant : '')); }
    S.view = null; S.crew = null; S.pf = null; stopChat();
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
    else if (h === 'me') { S.view = 'me'; if (signedIn()) { HI8.loadMine(true).then(renderSheet, noop); loadWallet(); } }
    else if (h === 'city') { S.view = 'city'; }
    else if (/^spot\//.test(h)) { S.view = 'spot'; S.spotSlug = h.slice(5); S.spotDay = S.spotDay || 0; }
    else if (/^soon\//.test(h)) { S.view = 'soon'; S.soonSport = h.slice(5); }
    else if (h === 'from') { S.view = 'from'; }
    else if (h === 'kg') { S.view = 'kg'; }
    else if (/^plan\//.test(h)) { S.view = 'plan'; if (!S.pf || S.pf.slug !== h.slice(5)) S.pf = { slug: h.slice(5), day: null, people: 1, busy: false, err: null }; }
    else { if (S.view) closeSheet(); return; }
    renderSheet();
  }
  function renderSheet() {
    if (!S.view) return;
    var fn = { join: sheetJoin, start: sheetStart, crew: sheetCrew, spot: sheetSpot, me: sheetMe, city: sheetCity, soon: sheetSoon, plan: sheetPlan, from: sheetFrom, kg: sheetKg }[S.view];
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
      getting: o.quick ? HI8.store.get('getting', null) : 'drive', quick: !!o.quick, noteOpen: false, seats: 3, hub: null, meet: null, meetAuto: true, levels: 'regular', note: '', level: HI8.store.get('lv.' + sport, 'regular'), max: 8, force: false, err: null, dup: null, done: null, busy: false };
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
    if (!f.hub || !hubBy(f.hub)) { var h = homeHub() || nearestHub(spot); f.hub = h ? h.slug : null; }
    if (f.meetAuto) {
      var hub = hubBy(f.hub);
      if (hub) {
        var m = f.from * 60 - HI8.driveMin(hub, spot) - 10; m = Math.floor(m / 5) * 5;
        if (f.date === S.today) m = Math.max(m, Math.ceil((S.nowH * 60 + S.nowM + 15) / 5) * 5); // never in the past
        f.meet = fromMin(Math.max(5 * 60, m));
      }
    }
  }
  function whenChips(f) {
    var spots = spotsFor(S.city, f.sport), days = FX.data[S.city] ? FX.bestDays(S.city, spots, f.sport, { kg: kg() }, 7) : [];
    var chips = days.filter(function (d, i) { return !d.none && (i < 3 || d.score >= 6 || (f.date === d.date && f.from === d.from)); }).slice(0, 5).map(function (d) {
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
    var pSport = '<div class="f"><span class="lb">SPORT</span><div class="row">' + LIVE_SPORTS.map(function (k) { return '<button class="opt ic" data-act="sfsport" data-sport="' + k + '" aria-pressed="' + (f.sport === k) + '">' + tile(k, 22) + esc(SPORT[k].name.toUpperCase()) + '</button>'; }).join('') + '</div></div>' ;
    var pWhen = '<div class="f"><span class="lb">WHEN <small>the best windows from the forecast</small></span>' + whenChips(f) + '</div>' ;
    var pWhere = '<div class="f"><span class="lb">WHERE <small>ranked for ' + esc(dayRel(f.date)) + ' ' + pad(f.from) + '–' + pad(f.to) + '</small></span><div class="row">' + rank.map(function (x) {
        var s = x.spot, fx = x.fx, hub = nearestHub(s);
        var sub = fx ? (f.sport === 'kite' ? fx.w + ' kt ' + FX.compass(fx.dir) + ', gusts ' + fx.g + (fx.shore ? ' · ' + fx.shore : '') : (fx.ground || '') + ' · ' + fx.temp + '°C') : 'no forecast that far yet';
        return '<button class="opt wide" data-act="sfspot" data-spot="' + s.slug + '" aria-pressed="' + (f.spot === s.slug) + '"><span>' + esc(s.name.toUpperCase()) + '<small>' + esc(sub) + (hub ? ' · ' + HI8.driveMin(hub, s) + ' min from ' + esc(title(hub.name)) : '') + '</small></span>' + (fx ? tag(fx) : '<span class="tag none">–</span>') + '</button>';
      }).join('') + '</div>' + (HI8.spot(f.spot) && HI8.spot(f.spot).note ? '<p class="hint">' + esc(HI8.spot(f.spot).note) + '</p>' : '') + '</div>' ;
    var pHow = '<div class="f"><span class="lb">' + (f.quick ? 'HOW ARE YOU GETTING THERE?' : 'HOW YOU GET THERE') + '</span><div class="row">' +
      (f.quick ? [['drive', "I'LL DRIVE", 'and fill my car'], ['seat', 'I NEED A SEAT', 'a driver picks me up'], ['own', 'MEET THERE', 'my own way']] : [['drive', "I'M DRIVING", 'others can ride with you'], ['own', 'OWN WAY', 'meet at the spot'], ['seat', 'I NEED A SEAT', 'a driver picks you up']]).map(function (o) {
        return '<button class="opt" data-act="sfget" data-v="' + o[0] + '" aria-pressed="' + (f.getting === o[0]) + '">' + o[1] + '<small>' + o[2] + '</small></button>';
      }).join('') + '</div>' +
      (f.getting === 'drive' ? '<div class="row" style="margin-top:10px;align-items:center"><span class="lb" style="margin:0 6px 0 0">FREE SEATS</span><span class="step"><button data-act="sfseats" data-d="-1" aria-label="Fewer seats">−</button><b>' + f.seats + '</b><button data-act="sfseats" data-d="1" aria-label="More seats">+</button></span></div>' +
        (function () { var hb = hubBy(f.hub), sp = HI8.spot(f.spot), cost = tripCost(hb, sp); if (!cost) return ''; var m = seatMath(cost, f.seats + 1);
          return '<p class="hint money">Fill it and ' + f.seats + ' rider' + (f.seats > 1 ? 's' : '') + ' pay you back <b>' + money(m.share * f.seats) + '</b> of the ' + money(cost) + ' fuel: ' + money(m.share) + ' each. Your drive costs you ' + money(m.share) + ' instead of ' + money(cost) + '.</p>'; })() : '') +
      (f.getting === 'seat' ? (function () { var hb = hubBy(f.hub), sp = HI8.spot(f.spot), cost = tripCost(hb, sp); if (!cost) return ''; var m = seatMath(cost, 4);
          return '<p class="hint money">A seat in a full car: about <b>' + money(m.share) + '</b> instead of ' + money(cost) + ' driving alone. ' + feeLine(m) + '.</p>'; })() : '') +
      (f.getting && f.getting !== 'own' ? '<div style="margin-top:12px"><span class="lb">' + (f.getting === 'drive' ? 'PICK UP AT' : 'MEET AT') + '</span><div class="row">' + startHubs().filter(function (h, i) { return i < 6 || h.slug === f.hub; }).map(function (h) {
        return '<button class="opt" data-act="sfhub" data-hub="' + h.slug + '" aria-pressed="' + (f.hub === h.slug) + '">' + esc(h.name) + '<small>' + esc(h.sub || '') + (home() && h.slug !== '__home' ? ' · ' + Math.round(HI8.km(h, home())) + ' km from you' : '') + '</small></button>';
      }).join('') + '<button class="opt" data-act="from">' + (home() ? 'SOMEWHERE ELSE' : 'FROM MY TOWN') + '<small>' + (home() ? 'change where you start' : 'add where you start') + '</small></button></div><div class="two" style="margin-top:10px;align-items:center"><label class="lb" for="sfMeet" style="margin:0">LEAVING AT</label><input class="inp" id="sfMeet" data-fixed type="time" step="300" value="' + esc(f.meet || '') + '" data-change="sfmeet"></div>' +
        '<p class="hint">Set from the drive time. Change it if you like.</p></div>' : '') + '</div>' ;
    var pLevels = '<div class="f"><span class="lb">WHO CAN JOIN</span><div class="row">' + (cap ? [['regular', 'RIDE SOLO', 'riders who ride on their own'], ['all', 'ALL LEVELS', 'rookies welcome, you look after them'], ['rookie', 'ROOKIE SESSION', 'for learners']] : [['regular', 'RIDERS WHO RIDE SOLO', 'everyone rides on their own']]).map(function (o) {
        return '<button class="opt" data-act="sflevels" data-v="' + o[0] + '" aria-pressed="' + (f.levels === o[0]) + '">' + o[1] + '<small>' + o[2] + '</small></button>';
      }).join('') + '</div>' + (cap ? '' : '<p class="hint">Crews with rookies are run by our captains.</p>') + '</div>' ;
    var pNote = '<div class="f"><label for="sfNote">NOTE <small style="font-weight:400;letter-spacing:0;text-transform:none;color:var(--mute)">optional</small></label><textarea class="inp" id="sfNote" maxlength="280" placeholder="' + esc({ kite: 'Launching at the north end. Bring a 9.', mtb: 'Loop of about 30 km, 800 m up. Lights for the way back.', mx: 'Open practice. Bring your licence or buy day insurance.' }[f.sport]) + '"></textarea></div>' ;
    var pYou = (me ? '' : '<div class="f"><span class="lb">YOU <small>your founding plate comes with it</small></span><div style="display:grid;gap:8px">' +
        '<label class="sr" for="sfEmail">Email</label><input class="inp" id="sfEmail" type="email" inputmode="email" autocomplete="email" placeholder="Email (only the app sees it)">' +
        '<label class="sr" for="sfName">Rider name</label><input class="inp" id="sfName" autocomplete="nickname" maxlength="40" placeholder="Rider name (what the crew sees)"></div>' +
        '<span class="lb" style="margin-top:12px">YOUR LEVEL</span><div class="row">' + ['regular', 'ripper'].map(function (l) { return '<button class="opt" data-act="sflevel" data-v="' + l + '" aria-pressed="' + (f.level === l) + '">' + LEVEL[l] + '<small>' + LEVEL_SUB[l] + '</small></button>'; }).join('') + '</div></div>') ;
    var pTail = (f.dup ? '<div class="warn" id="dup"><b>Already up:</b> ' + esc(String(f.dup.hint || '').replace(/^There's already a crew for that: /, '')) + '<div class="row"><button class="opt" data-act="crew" data-code="' + esc(f.dup.code) + '">JOIN IT</button><button class="opt" data-act="sfforce">POST MINE ANYWAY</button></div></div>' : '') +
      (f.err ? '<div class="err" role="alert">' + f.err + '</div>' : '') +
      '<p class="note">By posting you agree to the <a href="terms/">terms</a>: every session is each rider\'s own call. The spot\'s rules apply.</p>';
    var body;
    if (f.quick) {
      var qs = HI8.spot(f.spot), q0 = rank.filter(function (x) { return x.spot.slug === f.spot; })[0], qf = q0 && q0.fx, qk = qf && f.sport === 'kite' && FX.kiteSize ? FX.kiteSize(qf.w, kg()) : null;
      var pTop = '<div class="f"><div class="qsum"><div class="qs-k">' + tile(f.sport, 18) + esc(SPORT[f.sport].name.toUpperCase()) + ' · ' + esc(dayRel(f.date)) + ' ' + pad(f.from) + '–' + pad(f.to) + '</div>' +
        '<div class="qs-n">' + esc(qs ? qs.name.toUpperCase() : '') + (qf ? tag(qf) : '') + '</div>' +
        (qf ? '<div class="qs-m">' + esc(f.sport === 'kite' ? qf.w + ' kt ' + FX.compass(qf.dir) + ', gusts ' + qf.g + (qk ? ' · your kite: ' + qk + ' m' : '') : (qf.ground || '') + ' · ' + qf.temp + '°C') + '</div>' : '') +
        (qs && qs.note ? '<p class="hint">' + esc(qs.note) + '</p>' : '') +
        '<button class="lnk" data-act="sffull">CHANGE THE DAY, TIME OR SPOT</button></div></div>';
      body = pTop + pHow + (cap ? pLevels : '') + pYou + (f.noteOpen ? pNote : '<div class="f"><button class="lnk" data-act="sfnote">+ ADD A NOTE FOR THE CREW</button></div>') + pTail;
    } else body = pSport + pWhen + pWhere + pHow + pLevels + pNote + pYou + pTail;
    return shell(f.quick ? 'I\'M GOING' : 'START A CREW', body, '<button class="big start' + (f.quick ? ' go' : '') + '" data-act="sfpost"' + (f.busy ? ' disabled' : '') + '>' + (f.busy ? '<span class="spin"></span>' : f.quick ? 'I\'M GOING' : 'POST THE CREW') + '</button>');
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
      if (S.autoJoin === C.code) { S.autoJoin = null; if (!d.me && d.status === 'on' && !d.past) { S.jf = null; setTimeout(openJoin, 0); } }
      document.title = SPORT[d.sport].name + ' crew · ' + d.spot_name + ' · ' + dayRel(d.day) + ' ' + hm(d.start);
      if (d.city !== S.city) { S.city = d.city; drawAll(); initMap(); loadForecast(); }
      if (d.me) { startChat(); if (!S.wallet) loadWallet(); loadPlan(); }
      renderSheet();
      if (C.chat && d.me) setTimeout(function () { var el = $('#chatBox'); if (el) el.scrollIntoView({ block: 'center' }); }, 60);
    }, function (e) { if (S.crew === C) { C.err = errText(e); renderSheet(); } });
  }
  // the smart pick-ups: where each car stops, in order, with times (names only: nobody sees where anyone starts)
  function loadPlan(setFrom) {
    var C = S.crew; if (!C || !C.data || !C.data.me || !HI8.live) return Promise.resolve();
    var h = home();
    var p = setFrom && h ? HI8.withKey('hi8_set_from', { p_code: C.code, p_lat: h.lat, p_lon: h.lon }, { noQueue: true }) : HI8.withKey('hi8_car_plan', { p_code: C.code }, { noQueue: true });
    return p.then(function (plan) { if (S.crew !== C) return; var moved = setFrom && C.plan && JSON.stringify(C.plan.cars.map(function (x) { return x.driver; })) !== JSON.stringify(plan.cars.map(function (x) { return x.driver; })); C.plan = plan; if (setFrom) loadCrew(); else renderSheet(); }, noop);
  }
  function planHtml(c) {
    var pl = S.crew.plan; if (!pl || !pl.cars || !pl.cars.length) return '';
    var meName = (c.members || []).filter(function (m) { return m.me; })[0], h = home();
    return '<div class="box route"><h3>THE ROUTE' + (pl.saved_km ? ' <span class="tag good">' + pl.saved_km + ' KM NOT DRIVEN</span>' : '') + '</h3>' + pl.cars.map(function (car) {
      return '<div class="rc"><b class="rcd">🚗 ' + esc(car.driver) + (car.me_driving ? ' (you)' : '') + '</b>' +
        (car.stops.length ? '<ol class="stops">' + car.stops.map(function (st) { return '<li><span class="at">' + esc(st.at) + '</span><span><b>' + esc(st.name) + '</b><br>' + st.riders.map(esc).join(', ') + '</span></li>'; }).join('') + '<li class="end"><span class="at">' + esc(hm(c.start)) + '</span><span><b>' + esc(c.spot_name.toUpperCase()) + '</b></span></li></ol>'
          : '<p class="hint" style="margin:4px 0 0">No riders in this car yet.</p>') +
        '<p class="hint" style="margin:4px 0 0">' + car.route_km + ' km to the spot' + (car.saved_km ? ', ' + car.saved_km + ' km less than everyone driving' : '') + '.</p>' +
        (car.me_driving && car.stops.length ? '<a class="opt" target="_blank" rel="noopener" href="' + esc(car.maps) + '" style="display:inline-block;margin-top:8px">ROUTE IN GOOGLE MAPS</a>' : '') + '</div>';
    }).join('') +
      '<p class="hint">Pick-ups are picked from where each of you starts: a short trip for riders, a small detour for the driver. ' + (h ? 'You start from ' + esc(title(h.name)) + '.' : '') + '</p>' +
      (h ? '<button class="opt" data-act="planfrom">USE ' + esc(h.name) + ' AS WHERE I START</button>' : '<button class="opt" data-act="from">SET WHERE I START</button>') + '</div>';
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
        '<p class="hint">Split between you and ' + ps.length + ' rider' + (ps.length > 1 ? 's' : '') + ': €' + (me.trip_cost != null ? (me.trip_cost / (ps.length + 1)).toFixed(2) : '–') + ' each, all of it to you' + (me.trip_cost != null && !feeLive() ? ' (the ' + feePct() + '% Hi8 fee on top is free during the pilot)' : '') + '. Your Bizum number is shown only to the riders in your car. Paid: ' +
        ps.map(function (p) { return esc(p.name) + (p.paid ? ' ✓' : ' ·'); }).join(' ') + '</p>' +
        (S.wallet && S.wallet.live ? '<p class="hint money">Riders can pay their seat in the app: it reaches your wallet the day after the ride, and you withdraw to your bank from Me.</p>' : '') +
        '<button class="big dark" data-act="settle" style="width:100%;margin-top:6px;font-size:17px">SAVE + TELL MY CAR</button></div>';
    }
    if (me.car_with) {
      var d = M.filter(function (m) { return m.member_id === me.car_with; })[0];
      if (!d || d.share == null) return d ? '<div class="box"><h3>YOUR RIDE</h3><p class="hint" style="margin:0">You ride with ' + esc(d.name) + '. When they add what the car cost, your share shows here.</p></div>' : '';
      var W = S.wallet, inApp = !!(W && (W.seats || []).some(function (x) { return x.code === c.code; })), live = W && W.live && !(me.paid && !inApp); // paid by Bizum before: the old box
      if (live) {
        var fee0 = S.settings && S.settings.fee_live === true && !(W.pass && W.pass.active) ? Math.max(Math.round(d.share * 100 * feePct() / 100), Number((S.settings && S.settings.fee_min_cents) || 49)) : 0;
        var total = Math.round(d.share * 100) + fee0, enough = W.balance_cents >= total;
        return '<div class="box"><h3>YOUR SHARE <span class="tag ' + (me.paid ? 'good' : 'ok') + '">' + (me.paid ? 'PAID' : euro(total)) + '</span></h3>' +
          '<p class="hint" style="margin:0 0 10px">' + esc(d.name) + "'s car: €" + Number(d.trip_cost).toFixed(2) + ' split ' + Math.round(d.trip_cost / d.share) + ' ways' + (fee0 ? ', + ' + euro(fee0) + ' Hi8 fee' : (W.pass && W.pass.active ? ', no fee with your Pass' : ', no fee in the pilot')) + '.</p>' +
          (me.paid ? '<p class="hint money">Paid in the app. ' + esc(d.name) + ' gets it the day after the ride; if the crew is called off or you leave, it comes straight back.</p>'
            : enough ? '<button class="big join" data-act="payseat" style="width:100%">PAY ' + euro(total) + ' FROM MY WALLET</button><p class="hint">Your wallet: ' + euro(W.balance_cents) + '. Held until the ride.</p>'
              : '<button class="big join" data-act="topup" data-cents="' + ((W.topups || [2000]).filter(function (c) { return c >= total - W.balance_cents; })[0] || 5000) + '" data-back="crew" style="width:100%">TOP UP ' + euro((W.topups || [2000]).filter(function (c) { return c >= total - W.balance_cents; })[0] || 5000).replace('.00', '') + ' AND PAY</button><p class="hint">One top-up covers several seats, with no card fee each time.</p>') + '</div>';
      }
      return '<div class="box"><h3>YOUR SHARE <span class="tag ' + (me.paid ? 'epic' : 'ok') + '">' + (me.paid ? 'PAID' : '€' + Number(d.share).toFixed(2)) + '</span></h3>' +
        '<p class="hint" style="margin:0 0 10px">' + esc(d.name) + "'s car: €" + Number(d.trip_cost).toFixed(2) + ' split ' + Math.round(d.trip_cost / d.share) + ' ways. ' + feeLine(seatMath(Number(d.trip_cost), Math.round(d.trip_cost / d.share))) + '.</p><div style="display:grid;gap:8px">' +
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
    var how = '<span class="lb">HOW ARE YOU GETTING THERE?</span><div class="row">' +
      [['seat', 'I NEED A SEAT', c.seats_free > 0 ? c.seats_free + ' free now' : 'no free seats yet'], ['drive', "I'LL DRIVE", 'and take others'], ['own', 'MEET THERE', 'my own way']].map(function (o) {
        return '<button class="opt" data-act="jfget" data-v="' + o[0] + '" aria-pressed="' + (f.getting === o[0]) + '">' + o[1] + '<small>' + o[2] + '</small></button>';
      }).join('') + '</div>' +
      (f.getting === 'drive' ? '<div class="row" style="margin-top:10px;align-items:center"><span class="lb" style="margin:0 6px 0 0">FREE SEATS</span><span class="step"><button data-act="jfseats" data-d="-1" aria-label="Fewer seats">−</button><b>' + f.seats + '</b><button data-act="jfseats" data-d="1" aria-label="More seats">+</button></span></div>' : '') +
      (f.getting === 'seat' && !c.seats_free ? '<p class="hint">No free seat yet: you\'ll be on the list, and the first driver who joins takes you.</p>' : '');
    var lvl = '<span class="lb" style="margin-top:12px">YOUR LEVEL</span><div class="row">' + lvls.map(function (l) { return '<button class="opt" data-act="jflevel" data-v="' + l + '" aria-pressed="' + (f.level === l) + '">' + LEVEL[l] + '<small>' + LEVEL_SUB[l] + '</small></button>'; }).join('') + '</div>' +
      (c.levels === 'regular' ? '<p class="hint">This crew is for riders who ride on their own.</p>' : '');
    var you = me || c.me ? '' : '<span class="lb" style="margin-top:12px">YOU</span><div style="display:grid;gap:8px"><label class="sr" for="jfEmail">Email</label><input class="inp" id="jfEmail" type="email" inputmode="email" autocomplete="email" placeholder="Email (only the app sees it)">' +
      '<label class="sr" for="jfName">Rider name</label><input class="inp" id="jfName" autocomplete="nickname" maxlength="40" placeholder="Rider name (what the crew sees)"></div>';
    return '<div class="box" id="joinForm"><h3>' + (c.me ? 'CHANGE HOW YOU\'RE IN' : 'JOIN THIS CREW') + '</h3>' + how + lvl + you +
      (f.err ? '<div class="err" role="alert" style="margin:10px 0 0">' + f.err + '</div>' : '') +
      '<button class="big join" data-act="jfgo" style="width:100%;margin-top:12px"' + (f.busy ? ' disabled' : '') + '>' + (f.busy ? '<span class="spin"></span>' : c.me ? 'SAVE' : "I'M GOING") + '</button>' +
      (me || c.me ? '' : '<p class="hint">Your founding plate comes with it. By joining you agree to the <a href="terms/">terms</a>.</p>') + '</div>';
  }
  // the join form, opened from I'M IN or straight from I'M GOING on a session
  function openJoin() {
        var c = S.crew.data, me = c.me;
        S.jf = { level: me ? me.level : HI8.store.get('lv.' + c.sport, 'regular'), getting: me ? me.getting : (HI8.store.get('getting', null) || (c.seats_free > 0 ? 'seat' : 'own')), seats: me && me.getting === 'drive' ? me.seats : 3, err: null, busy: false };
        renderSheet(); setTimeout(function () { var el = $('#joinForm'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 40);
  }
  // what the car costs and what a seat saves, for anyone who isn't driving
  function carBox(c, spot, hub) {
    var me = c.me, cost = hub && spot && spot.lat ? tripCost(hub, spot) : null;
    if (!cost || c.status !== 'on' || c.past) return '';
    var M = c.members || [], n = 4;
    if (me && me.getting === 'drive') {
      var ps = M.filter(function (m) { return m.car_with === me.member_id; }).length, k = Math.max(ps, 1), m2 = seatMath(cost, k + 1);
      return '<div class="box sav"><h3>YOUR CAR <span class="tag good">' + money(m2.share * k) + ' BACK</span></h3><p class="hint" style="margin:0">About ' + money(cost) + ' of fuel from ' + esc(title(hub.name)) + ' and back. ' +
        (ps ? ps + ' rider' + (ps > 1 ? 's' : '') + ' with you: ' + money(m2.share) + ' each, you get the full share.' : 'With one rider you get back ' + money(m2.share) + '; fill the car and it\'s ' + money(seatMath(cost, 4).share * 3) + '.') + '</p></div>';
    }
    if (me && me.getting === 'own') return '';
    var m = seatMath(cost, n);
    return '<div class="box sav"><h3>A SEAT, SPLIT <span class="tag good">YOU SAVE ' + money(m.save) + '</span></h3>' +
      '<div class="savrow"><span><small>DRIVING ALONE</small><s>' + money(cost) + '</s></span><span><small>A SEAT</small><b>' + money(m.share) + '</b></span><span><small>HI8 FEE ' + feePct() + '%</small>' + (m.feeFree ? '<b class="free">FREE</b>' : '<b>' + money(m.fee) + '</b>') + '</span></div>' +
      '<p class="hint">Fuel from ' + esc(title(hub.name)) + ' to ' + esc(spot.name) + ' and back, split four ways in a full car, settled with the driver on the day.' + (m.feeFree ? ' The ' + feePct() + '% fee keeps Hi8ctane free: not charged during the pilot.' : '') + '</p></div>';
  }
  function sheetCrew() {
    var C = S.crew;
    if (!C.data) return shell('CREW', C.err ? '<div class="err" role="alert">' + esc(C.err) + '</div><div class="f"><button class="big join" data-act="join" style="width:100%">SEE THE CREWS COMING UP</button></div>' : '<div class="sec"><div class="skel"></div><div class="skel" style="margin-top:10px;height:200px"></div></div>', '', true);
    var c = C.data, f = crewFx(c), spot = HI8.spot(c.spot) || {}, isToday = c.day === S.today, member = !!c.me;
    var status = c.status === 'off' ? '<span class="tag off">CALLED OFF</span>' : c.past ? '<span class="tag off">DONE</span>' : c.live ? '<span class="tag live">LIVE NOW</span>' : '';
    var maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent((c.maps || spot.maps || c.spot_name) + '');
    var hub = c.meet_hub ? HI8.hubsOf(c.city).filter(function (h) { return h.slug === c.meet_hub; })[0] : null;
    var body = '<div class="hero art a-' + c.sport + '"><div class="k">' + tile(c.sport, 20) + esc(SPORT[c.sport].name.toUpperCase() + ' CREW') + ' ' + status + '</div><h2>' + esc(c.spot_name) + '</h2>' +
      '<div class="when2">' + esc(dayRel(c.day)) + ' · ' + esc(hm(c.start)) + (c.end ? '–' + esc(hm(c.end)) : '') + '</div>' +
      '<div class="when2" style="color:var(--mint);font-weight:400;margin-top:4px">' + esc(CREW_LEVELS[c.levels] || '') + ' · captain ' + esc(c.host) + (c.host_plate ? ' #' + pad3(c.host_plate) : '') + '</div></div>' +
      (c.status === 'off' ? '<div class="err">Called off: ' + esc(c.off_reason || 'the captain called it off') + '</div>' : '') +
      crewStrip(c, f) + carBox(c, spot, hub) +
      (c.note ? '<div class="box"><h3>FROM THE CAPTAIN</h3><div style="font-size:13px">' + esc(c.note) + '</div></div>' : '') +
      '<div class="box"><h3>WHO\'S GOING <span class="tag' + (c.going >= c.max ? ' off' : '') + '">' + c.going + '/' + c.max + '</span></h3>' +
      (member ? membersHtml(c) : '<div style="display:flex;align-items:center;gap:10px">' + faces(c) + '<span style="font-size:12.5px;color:var(--mute)">' +
        (c.seats_free ? c.seats_free + ' seat' + (c.seats_free > 1 ? 's' : '') + ' free' + (hub ? ' from ' + esc(hub.name) : '') + (c.meet_time ? ' at ' + esc(hm(c.meet_time)) : '') : c.drivers ? 'cars are full' : 'no car yet') +
        (c.need_seat ? ' · ' + c.need_seat + ' need' + (c.need_seat > 1 ? '' : 's') + ' a seat' : '') + (c.here ? ' · ' + c.here + ' at the spot' : '') + '</span></div><p class="hint">Names, cars and the chat are for the crew.</p>') + '</div>';
    if (member) {
      body += planHtml(c);
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
    var foot = !member && c.status === 'on' && !c.past ? '<button class="big join" data-act="' + (S.jf ? 'jfgo' : 'jfopen') + '"' + (S.jf && S.jf.busy ? ' disabled' : '') + '>' + (S.jf && S.jf.busy ? '<span class="spin"></span>' : 'I\'M GOING') + '</button><button class="big ghost" data-act="share" style="flex:0 0 34%">SHARE</button>'
      : '<a class="big wa" href="https://wa.me/?text=' + encodeURIComponent(shareText(c)) + '" target="_blank" rel="noopener">SHARE TO WHATSAPP</a>';
    return shell(esc(SPORT[c.sport].name.toUpperCase()) + ' CREW', body, foot, true);
  }

  // ---- A SPOT: the forecast table, crews there, reports
  function sheetSpot() {
    var spot = HI8.spot(S.spotSlug);
    if (!spot) return shell('SPOT', '<div class="err">That spot isn\'t on the map.</div>', '', true);
    var sport = (spot.sports || []).indexOf(S.sport) >= 0 ? S.sport : spot.sports[0], sp = fxSpot(spot.slug);
    var dates = [0, 1, 2, 3, 4, 5, 6].map(function (n) { return FX.addDays(S.today, n); }), date = dates[S.spotDay] || dates[0];
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
        T.push(tr('<button class="kgth" data-act="kg">KITE M · ' + kg() + ' KG ✎</button>', function (r) { var k = FX.kiteSize(r.w, kg()); return cell(r, k || ''); }));
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
      var di = FX.dayInfo(sp, date), ag = FX.agreement(rows.filter(function (r) { return r.rate && !r.rate.dark; }), sport);
      var info = di ? '<div class="dinfo">' + [['RAIN', di.pop != null ? di.pop + '%' : '–'], ['CLOUD', di.cloud != null ? di.cloud + '%' : '–'], ['TEMP', di.tmin != null ? (di.tmin === di.tmax ? di.tmax : di.tmin + '-' + di.tmax) + '°' : '–'],
        sport === 'kite' ? ['WAVES', di.wave != null ? di.wave + ' M' + (di.period ? ' · ' + di.period + ' S' : '') : '–'] : ['RAIN TOTAL', di.mm + ' MM'], sport === 'kite' ? ['WATER', di.sst != null ? di.sst + '°C' : '–'] : ['WIND', di.w + ' KT'],
        ['LIGHT', di.sunrise ? di.sunrise + '-' + di.sunset : '–'], ['MODELS', ag ? ag.n + '/' + ag.of + ' ' + ag.label : '–'], ['SOURCE', FX.sourceFor(S.city, date, S.today)]].map(function (x) { return '<span><small>' + x[0] + '</small>' + esc(x[1]) + '</span>'; }).join('') + '</div>' : '';
      table = info + '<div class="tbl-wrap"><table class="fx"><caption class="sr">Hourly forecast for ' + esc(spot.name) + '</caption>' + T.join('') + '</table></div>' +
        '<p class="legend2">' + (ws[0] ? 'Best: ' + pad(ws[0].from) + '–' + pad(ws[0].to) + ' · ' + esc(ws[0].label) + (ws[0].why && ws[0].why.length ? ' · ' + esc(ws[0].why.join(', ')) : '') : 'No good window this day.') +
        (day.sunrise ? ' · Light ' + esc(day.sunrise) + '–' + esc(day.sunset) : '') + '. ' + (sport === 'kite' ? 'Wind in knots. Arrows point where it blows. ' + (spot.lake ? 'Lagoon: any direction works.' : 'This beach faces ' + FX.compass(spot.face) + '.') : 'Rating: rain now, mud from the last 24 h of rain, heat and wind.') + '</p>';
    }
    var crews = upcoming(sport, 14).filter(function (c) { return c.spot === spot.slug; });
    var reps = S.live ? (S.live.reports || []).filter(function (r) { return r.spot === spot.slug; }) : [];
    var body = '<div class="hero"><div class="k">' + esc((spot.sports || []).filter(function (k) { return LIVE_SPORTS.indexOf(k) >= 0; }).map(function (k) { return SPORT[k].name.toUpperCase(); }).join(' · ')) + '</div><h2>' + esc(spot.name) + '</h2>' +
      (spot.note ? '<div class="when2" style="font-weight:400">' + esc(spot.note) + '</div>' : '') + '</div>' + tabs + table +
      (reps.length ? '<div class="box"><h3>REPORTS · LAST HOURS</h3><div class="reports">' + reps.map(function (r) { return '<div class="rep"><span class="tag ' + (r.verdict === 'on' ? 'epic' : r.verdict === 'meh' ? 'ok' : 'no') + '">' + r.verdict.toUpperCase() + '</span><span>' + (r.kite ? 'on a ' + r.kite + ' m' : '') + (r.ground ? esc(r.ground) : '') + '</span><small>' + esc(ago(r.at)) + '</small></div>'; }).join('') + '</div></div>' : '') +
      (S.plans || []).filter(function (p) { return p.spot === spot.slug; }).map(function (p) { return '<div class="f"><button class="opt wide" data-act="plan" data-plan="' + esc(p.slug) + '"><span>PLAN: ' + esc(p.title.toUpperCase()) + '<small>' + esc(p.blurb.split('. ')[0]) + '.</small></span><span class="tag good">' + (p.interested ? p.interested + ' IN' : 'SEE IT') + '</span></button></div>'; }).join('') +
      '<div class="sec"><h2>CREWS HERE <small>' + crews.length + ' COMING UP</small></h2>' + (crews.length ? '<div class="crews">' + crews.map(crewCard).join('') + '</div>' : '<p class="lede">None yet.</p>') + '</div>' +
      '<div class="f"><a class="big ghost" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(spot.maps || spot.name) + '">DIRECTIONS</a></div>';
    return shell(esc(spot.name.toUpperCase()), body, '<button class="big start" data-act="startspot" data-spot="' + esc(spot.slug) + '" data-sport="' + esc(sport) + '">START A CREW HERE</button>', true);
  }

  // ---- A PLAN: a day out, "I'm in", with the others going
  function planBy(slug) { return (S.plans || []).concat(S.trips || []).filter(function (p) { return p.slug === slug; })[0] || null; }
  function sheetPlan() {
    var p = planBy(S.pf.slug), f = S.pf;
    if (!p) return shell('PLAN', S.plans ? '<div class="err">That plan isn\'t on any more.</div>' : '<div class="sec"><div class="skel"></div></div>', '', true);
    var me = signedIn(), mine = p.mine, days = [];
    for (var i = 0; i < 21; i++) days.push(FX.addDays(S.today, i));
    if (mine && !f.touched) { f.day = mine.day || null; f.people = mine.people || 1; }
    var sp = p.spot ? HI8.spot(p.spot) : null, liveSport = sp && LIVE_SPORTS.indexOf(p.kind) >= 0;
    var hubs = HI8.hubsOf(p.city), hb = sp ? hubs.slice().sort(function (a, b) { return HI8.km(a, sp) - HI8.km(b, sp); })[0] : null, cost = hb && sp ? tripCost(hb, sp) : null;
    var body = '<div class="hero art a-' + esc(p.kind) + '"><div class="k">' + tile(p.kind, 22) + ' ' + esc(p.place.toUpperCase()) + (p.badge ? ' <span class="tag ok">' + esc(p.badge) + '</span>' : '') + '</div><h2>' + esc(p.title.toUpperCase()) + '</h2>' +
      '<div class="when2">' + (p.interested ? p.interested + ' in so far' : 'Be the first one in') + (p.hours ? ' · ' + esc(p.hours) : '') + '</div></div>' +
      '<div class="box"><div style="font-size:12.5px">' + esc(p.blurb) + '</div>' + ((p.includes || []).length ? '<div class="chips" style="margin-top:10px">' + p.includes.map(function (x, i) { return '<span class="chip" style="background:' + ['#FFFFFF', '#8DF5E8', '#FFE14D', '#C8FF3D'][i % 4] + '">' + esc(x.toUpperCase()) + '</span>'; }).join('') + '</div>' : '') + '</div>' +
      '<div class="box"><h3>WHAT IT COSTS ' + (p.price_from != null ? '<span class="tag good">FROM €' + Math.round(p.price_from) + '</span>' : '<span class="tag">ASK</span>') + '</h3><div style="font-size:12.5px">' + esc(p.price_note || '') + '</div>' +
      (cost ? '<p class="hint money">Getting there from ' + esc(title(hb.name)) + ': ' + money(cost) + ' of fuel alone, ' + money(seatMath(cost, 4).share) + ' a seat in a full car.</p>' : '') + '</div>' +
      '<div class="f"><span class="lb">WHICH DAY <small>any is fine: we match you with the others</small></span><div class="row scroll">' +
      '<button class="tab" data-act="plday" data-day="" aria-pressed="' + (!f.day) + '">ANY DAY</button>' + days.map(function (d) { return '<button class="tab" data-act="plday" data-day="' + d + '" aria-pressed="' + (f.day === d) + '">' + esc(dayRel(d)) + '</button>'; }).join('') + '</div></div>' +
      '<div class="f"><span class="lb">HOW MANY OF YOU</span><span class="step"><button data-act="plpeople" data-d="-1" aria-label="Fewer">−</button><b>' + f.people + '</b><button data-act="plpeople" data-d="1" aria-label="More">+</button></span></div>' +
      '<div class="f"><label for="plNote">NOTE <small style="font-weight:400;letter-spacing:0;text-transform:none;color:var(--mute)">optional</small></label><textarea class="inp" id="plNote" maxlength="280" placeholder="' + esc(p.kind === 'mx' ? 'Height and boot size for the bike + gear, how much you\'ve ridden' : 'First time? Board size? Anything we should know') + '"></textarea></div>' +
      (me ? '' : '<div class="f"><span class="lb">YOU <small>your founding plate comes with it</small></span><label class="sr" for="plEmail">Email</label><input class="inp" id="plEmail" type="email" inputmode="email" autocomplete="email" placeholder="Email (only the app sees it)"></div>') +
      (f.err ? '<div class="err" role="alert">' + f.err + '</div>' : '') +
      '<div class="f"><div class="row">' + (liveSport ? '<button class="opt" data-act="startspot" data-spot="' + esc(p.spot) + '" data-sport="' + esc(p.kind) + '">START A CREW FOR IT</button>' : '') +
      (p.maps ? '<a class="opt" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(p.maps) + '">DIRECTIONS</a>' : '') +
      (p.url ? '<a class="opt" target="_blank" rel="noopener" href="' + esc(p.url) + '">THE PLACE</a>' : '') +
      '<button class="opt" data-act="plshare">ASK YOUR FRIENDS</button>' + (mine ? '<button class="opt" data-act="plleave">NOT ANYMORE</button>' : '') + '</div></div>' +
      '<p class="note">We pass your day and group to the place and the others going. Prices are the place\'s own: you pay them there.</p>';
    return shell('PLAN', body, '<button class="big join" data-act="plgo"' + (f.busy ? ' disabled' : '') + '>' + (f.busy ? '<span class="spin"></span>' : mine ? 'SAVE' : "I'M IN") + '</button>', true);
  }
  function planGo() {
    var f = S.pf, p = planBy(f.slug); if (!p || f.busy) return;
    var note = ($('#plNote') || {}).value || null, email = ($('#plEmail') || {}).value;
    var args = { p_plan: p.slug, p_day: f.day || null, p_people: f.people, p_note: note, p_source: src().source || 'plan', p_ref: src().ref || null };
    if (signedIn()) args.p_key = HI8.me().key;
    else {
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { f.err = "That email doesn't look right."; renderSheet(); return; }
      args.p_email = email.trim();
    }
    f.busy = true; f.err = null; renderSheet();
    HI8.rpc('hi8_plan_interest', args).then(function (out) {
      f.busy = false;
      if (out.key) HI8.saveMe(out);
      p.mine = { day: f.day || null, people: f.people }; p.interested = out.interested; drawTop(); drawPlans(); renderSheet(); loadPlans();
      toast("You're in" + (out.plate ? ': founding plate #' + pad3(out.plate) : '') + '. We\'ll email you to sort the day with the others.', 6000);
    }, function (e) { f.busy = false; f.err = errText(e); renderSheet(); });
  }
  function loadPlans() {
    if (!HI8.live) return Promise.resolve();
    HI8.rpc('hi8_plans', { p_city: null, p_key: HI8.me().key || null }).then(function (P) { S.trips = (P || []).filter(function (p) { return p.trip; }); drawWhere(); }, noop);
    return HI8.rpc('hi8_plans', { p_city: S.city, p_key: HI8.me().key || null }).then(function (P) { S.plans = P || []; drawPlans(); if (S.view === 'plan' || S.view === 'me') renderSheet(); }, function () { S.plans = S.plans || []; });
  }

  // ---- THE WALLET and THE HI8 PASS (Stripe; switched on with payments_live)
  function loadWallet() {
    if (!signedIn() || !HI8.live) return Promise.resolve(null);
    return HI8.withKey('hi8_wallet', {}, { noQueue: true }).then(function (w) { S.wallet = w; if (S.view === 'me' || S.view === 'crew') renderSheet(); return w; }, function () { return null; });
  }
  function euro(c) { return money((c || 0) / 100); }
  function walletBox() {
    var w = S.wallet;
    if (!w) return '<div class="box"><h3>WALLET</h3><p class="hint" style="margin:0"><span class="spin"></span> Loading…</p></div>';
    var kinds = { topup: 'Top-up', seat: 'Seat', refund: 'Refund', earning: 'From your car', payout: 'To your bank', adjust: 'Correction' };
    return '<div class="box wal"><h3>WALLET <span class="tag good">' + euro(w.balance_cents) + '</span></h3>' +
      (w.live ? '<p class="hint" style="margin:0 0 10px">Top up once, pay your seats from it: no card fee on every ride. Seat money is held until the crew has ridden; called off or left = straight back.</p>' +
        '<div class="row">' + (w.topups || [1000, 2000, 5000]).map(function (c) { return '<button class="opt" data-act="topup" data-cents="' + c + '"' + (w.balance_cents + c > w.max_cents ? ' disabled' : '') + '>+ ' + euro(c).replace('.00', '') + '<small>iDEAL, card and more</small></button>'; }).join('') + '</div>' +
        (w.held_cents ? '<p class="hint">' + euro(w.held_cents) + ' held for seats coming up.</p>' : '') +
        (w.pending_cents ? '<p class="hint money">' + euro(w.pending_cents) + ' from riders in your car, yours the day after the ride.</p>' : '') +
        (w.balance_cents >= 500 ? '<button class="opt" data-act="payout" style="margin-top:10px">' + (w.payout_ready ? 'WITHDRAW ' + euro(w.balance_cents) + ' TO MY BANK' : 'SET UP WITHDRAWALS') + '<small>through Stripe, who keep your bank details</small></button>' : '')
        : '<p class="hint" style="margin:0">Paying in the app opens soon: top up once and pay every seat from it, with no card fee each time. For now, pay your driver directly.</p>') +
      (w.ledger && w.ledger.length ? '<div class="ledger">' + w.ledger.slice(0, 6).map(function (l) { return '<div><span>' + esc(l.note || kinds[l.kind] || l.kind) + '</span><b class="' + (l.cents < 0 ? 'out' : 'in') + '">' + (l.cents < 0 ? '−' : '+') + euro(Math.abs(l.cents)) + '</b></div>'; }).join('') + '</div>' : '') + '</div>';
  }
  function passBox() {
    var w = S.wallet; if (!w) return '';
    var perks = '<ul class="perks"><li>No Hi8 fee on any seat</li><li>Crew rates at partner shops, tracks and cable parks</li><li>First pick of seats on EPIC days</li><li>Season stats: days out, euros saved</li></ul>';
    if (w.pass && w.pass.active) return '<div class="box pass"><h3>HI8 PASS <span class="tag good">ON</span></h3><p class="hint" style="margin:0">' + (w.pass.plan === 'year' ? 'Yearly' : 'Monthly') + (w.pass.until ? ', renews ' + esc(dayLong(String(w.pass.until).slice(0, 10))) : '') + '. Cancel any time from the Stripe receipt email.</p>' + perks + '</div>';
    var fee = S.settings && S.settings.fee_live === true;
    return '<div class="box pass"><h3>HI8 PASS <span class="tag">' + euro(w.pass_month_cents) + ' A MONTH</span></h3>' + perks +
      (w.live && fee ? '<div class="row"><button class="opt" data-act="pass" data-plan="month">' + euro(w.pass_month_cents) + ' A MONTH<small>SEPA or card</small></button><button class="opt" data-act="pass" data-plan="year">' + euro(w.pass_year_cents).replace('.00', '') + ' A YEAR<small>two months free</small></button></div>'
        : '<p class="hint">Comes with the Hi8 fee: during the pilot every seat is fee-free anyway.</p>') + '</div>';
  }
  function topup(cents, back) {
    toast('<span class="spin"></span> Opening Stripe…', 8000);
    HI8.fn('stripe-checkout', { key: HI8.me().key, kind: 'topup', cents: Number(cents), back: back || location.href.split('#')[0] + '#me' }).then(function (r) { if (r && r.url) location.href = r.url; }, function (e) { toast(errText(e), 5000); });
  }

  // ---- WHERE YOU START FROM (kept on this phone only)
  function sheetFrom() {
    var h = home(), A = HI8.hubsOf(S.city), T = towns().filter(function (t) { return inRegion(t) && !A.some(function (x) { return HI8.km(x, t) < 1.5; }); });
    var pick = function (x, small) { var on = h && HI8.km(x, h) < 0.3; return '<button class="opt" data-act="sethome" data-name="' + esc(x.name) + '" data-lat="' + x.lat + '" data-lon="' + x.lon + '" aria-pressed="' + !!on + '">' + esc(x.name) + '<small>' + small + '</small></button>'; };
    var body = '<div class="sec"><h2>WHERE DO YOU START FROM?</h2><p class="lede">Crews from near you come first, and the savings count from there. It stays on this phone: nobody sees it.</p>' +
      '<button class="big dark" data-act="geo" style="width:100%">' + (S.geoBusy ? '<span class="spin"></span>' : 'USE MY LOCATION') + '</button>' +
      (S.geoErr ? '<div class="err" style="margin:10px 0 0">' + esc(S.geoErr) + '</div>' : '') +
      (h ? '<div class="f" style="padding:14px 0 0"><label for="homeName">CALL IT</label><div class="send" style="margin:0"><input class="inp" id="homeName" data-fixed maxlength="32" value="' + esc(h.name) + '"><button type="button" data-act="homename">SAVE</button></div><p class="hint">A town or a station: it\'s what the crew sees as the pick-up when you start one.</p></div>' : '') + '</div>' +
      '<div class="f"><span class="lb">CREWS LEAVE FROM</span><div class="row">' + A.map(function (x) { return pick(x, x.crews ? x.crews + ' crew' + (x.crews > 1 ? 's' : '') + ' coming up' : x.kind === 'town' ? 'started by riders' : esc(x.sub || 'pick-up point').toLowerCase()); }).join('') + '</div></div>' +
      (T.length ? '<div class="f"><span class="lb">OR YOUR TOWN <small>the first crew from it puts it on the list</small></span><div class="row">' + T.map(function (t) { return pick(t, 'no crew yet'); }).join('') + '</div></div>' : '') +
      (h ? '<div class="f"><button class="opt" data-act="clearhome">FORGET WHERE I START</button></div>' : '');
    return shell('WHERE YOU START', body, h ? '<button class="big join" data-act="close">SEE CREWS FROM ' + esc(h.name) + '</button>' : '', true);
  }
  function geoHome() {
    if (!navigator.geolocation) { S.geoErr = 'This browser can\'t share its location: pick a place below.'; renderSheet(); return; }
    S.geoBusy = true; S.geoErr = null; if (S.view) renderSheet(); else drawSetup();
    navigator.geolocation.getCurrentPosition(function (pos) {
      S.geoBusy = false;
      var pt = { lat: Math.round(pos.coords.latitude * 100) / 100, lon: Math.round(pos.coords.longitude * 100) / 100 }; // about 1 km: never your address
      if (!inRegion(pt)) { S.geoErr = 'You\'re outside the ' + regionName() + ': pick a place, or switch region at the top.'; if (S.view) renderSheet(); else drawSetup(); return; }
      var named = nearestTo(pt, HI8.hubsOf(S.city).concat(towns()));
      setHome({ name: named && HI8.km(named, pt) < 12 ? named.name : 'NEAR ME', lat: pt.lat, lon: pt.lon });
      afterHome();
    }, function () { S.geoBusy = false; S.geoErr = 'No location: allow it in the browser, or pick a place.'; if (S.view) renderSheet(); else drawSetup(); }, { timeout: 10000, maximumAge: 600000 });
  }
  function afterHome() { if (S.sf && !S.sf.done) { S.sf.hub = null; autoMeet(); } if (S.save) S.save.hub = null; drawAll(); if (S.view) renderSheet(); }

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
      walletBox() + passBox() +
      '<div class="box"><h3>EMAIL ME NEW CREWS</h3><div class="row">' + LIVE_SPORTS.map(function (k) {
        var on = al.some(function (a) { return a.city === S.city && a.sport === k; });
        return '<button class="opt" data-act="alert" data-sport="' + k + '" data-on="' + (!on) + '" aria-pressed="' + on + '">' + SPORT[k].name.toUpperCase() + '</button>';
      }).join('') + '</div><p class="hint">In ' + esc(cityObj(S.city).name) + ', at most 3 a day. Every email has a stop link.</p></div>' + kgBox() +
      ((S.plans || []).some(function (p) { return p.mine; }) ? '<div class="box"><h3>MY PLANS</h3><div class="row">' + S.plans.filter(function (p) { return p.mine; }).map(function (p) { return '<button class="opt" data-act="plan" data-plan="' + esc(p.slug) + '">' + esc(p.title.toUpperCase()) + '<small>' + (p.mine.day ? esc(dayRel(p.mine.day)) : 'any day') + ' · ' + p.mine.people + ' of you</small></button>'; }).join('') + '</div></div>' : '') +
      '<div class="sec"><h2>MY CREWS <small>' + up.length + ' COMING UP</small></h2>' + (up.length ? '<div class="crews">' + up.map(crewCard).join('') + '</div>' : '<p class="lede">None coming up.</p>') +
      (past.length ? '<h2 style="margin-top:18px;font-size:20px">BEFORE</h2><div class="crews">' + past.slice(0, 8).map(crewCard).join('') + '</div>' : '') + '</div>' +
      '<div class="f"><p class="hint">Switching phones? Sign up with the same email there: your plate comes with you. To delete everything, email <a href="mailto:hello@hi8ctane.com">hello@hi8ctane.com</a>.</p>' +
      '<button class="opt" data-act="signout">' + (S.confirmOut ? 'TAP AGAIN: FORGET ME ON THIS PHONE' : 'NOT YOU? FORGET ME ON THIS PHONE') + '</button></div>';
    return shell('ME', body, '');
  }
  // ---- KITE SIZE: your weight, from any kite size on the page
  function sheetKg() {
    var w = kg();
    return shell('KITE SIZE', '<div class="sec"><p class="lede">Your weight sets the kite size we suggest for every spot and hour. It stays on this phone.</p>' +
      '<div class="row" style="margin:12px 0">' + [55, 65, 75, 85, 95].map(function (v) { return '<button class="opt" data-act="kgset" data-v="' + v + '" aria-pressed="' + (v === w) + '">' + v + ' KG</button>'; }).join('') + '</div></div>' + kgBox() +
      '<p class="hint" style="padding:0 16px">At ' + w + ' kg: about a ' + (FX.kiteSize(12, w) || '–') + ' m in 12 knots, a ' + (FX.kiteSize(18, w) || '–') + ' m in 18, a ' + (FX.kiteSize(24, w) || '–') + ' m in 24.</p>',
      '<button class="big join" data-act="close">DONE</button>', !!S.kgBack);
  }
  function kgBox() {
    return '<div class="box"><h3>KITE SIZE</h3><div class="two" style="align-items:center"><label for="kgIn" style="font-size:12.5px">Your weight (kg), for the kite size in the forecast. Stays on this phone.</label>' +
      '<input class="inp" id="kgIn" data-fixed type="number" inputmode="numeric" min="35" max="140" value="' + kg() + '" data-change="kg"></div></div>';
  }
  function sheetCity() {
    var cs = (HI8.placesNow().cities || []);
    return shell('REGION', '<div class="sec"><div class="row">' + cs.filter(function (c) { return c.status === 'open'; }).map(function (c) {
      return '<button class="opt wide" data-act="setcity" data-city="' + c.slug + '" aria-pressed="' + (c.slug === S.city) + '"><span>' + esc(regionName(c.slug).toUpperCase()) + '<small>' + (S.settings && S.settings.pilot_city === c.slug ? 'the pilot: live now' : 'open') + ' · crews leave from wherever riders live</small></span></button>';
    }).join('') + '</div><p class="lede" style="margin-top:16px">Outside these regions? <a href="B27-City.dc.html">Ask for yours</a>.</p></div>', '', true);
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
    if (S.jf && S.jf.getting) HI8.store.set('getting', S.jf.getting);
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
      startChat(); renderSheet(); if (home()) loadPlan(true);
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
    refreshToday();
    // a window that already started today: the crew starts in a few minutes, not in the past
    var nowMin = S.nowH * 60 + S.nowM, start = pad(f.from) + ':00';
    if (f.date === S.today && f.from * 60 < nowMin + 5) {
      var hb0 = f.getting !== 'own' ? hubBy(f.hub) : null, sp0 = HI8.spot(f.spot), arrive = nowMin + 10;
      if (hb0 && sp0 && f.meet) arrive = Math.max(arrive, minutes(f.meet) + HI8.driveMin(hb0, sp0));
      start = fromMin(Math.ceil(arrive / 15) * 15);
    }
    var args = { p_sport: f.sport, p_spot: f.spot, p_day: f.date, p_start: start, p_end: f.to ? pad(Math.min(f.to, 23)) + ':' + (f.to >= 24 ? '59' : '00') : null,
      p_levels: f.levels, p_max: f.max, p_meet_hub: f.getting === 'own' ? null : f.hub, p_meet_time: f.getting === 'own' ? null : f.meet, p_meet_note: null, p_note: note || null,
      p_getting: f.getting, p_seats: f.getting === 'drive' ? f.seats : 0, p_force: !!f.force };
    if (!f.getting) { f.err = 'Pick how you\'re getting there: drive, a seat, or meet there.'; renderSheet(); return; }
    HI8.store.set('getting', f.getting);
    if (!signedIn()) {
      if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) { f.err = "Add your email: that's how the crew reaches you through the app."; renderSheet(); return; }
      if (!name || !name.trim()) { f.err = "Add a rider name: it's what the crew sees."; renderSheet(); return; }
      HI8.store.set('lv.' + f.sport, f.level);
    }
    // leaving from a town nobody has started from yet: it goes on the list first, then the crew is posted
    var hh = f.getting !== 'own' && f.hub === '__home' ? homeHub() : null;
    var ready = hh ? HI8.rpc('hi8_add_start', { p_city: S.city, p_name: hh.name, p_lat: hh.lat, p_lon: hh.lon }).then(function (r) {
      var P2 = HI8.places && HI8.places.hubs ? HI8.places : null;
      if (P2 && !P2.hubs.some(function (x) { return x.city === r.city && x.slug === r.slug; })) P2.hubs.push(Object.assign({ crews: 0 }, r));
      f.hub = r.slug; args.p_meet_hub = r.slug;
    }) : Promise.resolve();
    var p = ready.then(function () {
      if (signedIn()) return HI8.withKey('hi8_start_crew', Object.assign({ p_level: HI8.store.get('lv.' + f.sport, 'regular') }, args), { noQueue: true });
      return HI8.rpc('hi8_quick_start', Object.assign({ p_email: email.trim(), p_name: name.trim(), p_level: f.level, p_source: src().source || 'start', p_ref: src().ref || null }, args))
        .then(function (out) { HI8.saveMe(out); return out; });
    });
    f.busy = true; f.dup = null; renderSheet();
    p.then(function (c) {
      HI8.loadPlaces && HI8.loadPlaces(true).then(function () { drawTowns(); }, noop);
      f.busy = false; f.done = c; f.force = false; drawTop();
      if (home() && c.code) HI8.withKey('hi8_set_from', { p_code: c.code, p_lat: home().lat, p_lon: home().lon }, { noQueue: true }).catch(noop);
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
      case 'kg': S.kgBack = S.view ? location.hash : null; go('#kg'); break;
      case 'kgset': HI8.store.set('kg', Number(d.v)); drawAll(); renderSheet(); break;
      case 'close': if (S.view === 'kg' && S.kgBack) { var kb = S.kgBack; S.kgBack = null; closeSheet(); go(kb); } else if (S.view === 'from' && S.fromBack) { var back = S.fromBack; S.fromBack = null; closeSheet(); go(back); } else closeSheet(); break;
      case 'join': if (S.view === 'crew') closeSheet(); go('#join'); break;
      case 'start': if (S.view === 'crew') closeSheet(); newStart({}); go('#start'); break;
      case 'startwin': newStart({ date: d.date, from: d.from, to: d.to, spot: d.spot, quick: true }); go('#start'); break;
      case 'going': S.autoJoin = String(d.code).toUpperCase(); openCrew(d.code); break;
      case 'goingbest': { var nx = sessions()[0];
        if (nx && nx.crews.length) { S.autoJoin = String(nx.crews[0].code).toUpperCase(); openCrew(nx.crews[0].code); }
        else if (nx) { newStart({ date: nx.date, from: nx.from, to: nx.to, spot: nx.spot.slug, quick: true }); go('#start'); }
        else { newStart({}); go('#start'); }
        break; }
      case 'allsess': S.allSess = true; drawSessions(); break;
      case 'sffull': S.sf.quick = false; if (!S.sf.getting) S.sf.getting = 'drive'; renderSheet(); break;
      case 'sfnote': S.sf.noteOpen = true; renderSheet(); setTimeout(function () { var n = $('#sfNote'); if (n) n.focus(); }, 30); break;
      case 'startspot': if (d.sport !== S.sport) setSport(d.sport); newStart({ spot: d.spot, sport: d.sport }); go('#start'); break;
      case 'me': go('#me'); break;
      case 'city': go('#city'); break;
      case 'waitlist':
        if (S.wlBusy) break;
        S.wlBusy = d.city; drawWhere();
        after(HI8.withKey('hi8_waitlist', { p_city: d.city }, { noQueue: true }), function (out) { S.wlBusy = null; S.waitlisted = Object.assign({}, S.waitlisted, (function () { var o = {}; o[d.city] = 1; return o; })()); drawWhere(); toast(out.already ? "You're already on the " + esc(out.name) + ' list.' : "You're on the " + esc(out.name) + ' list. You hear first.'); }).catch(function () { S.wlBusy = null; drawWhere(); });
        break;
      case 'setcity': S.city = d.city; HI8.store.set('city28', d.city); S.hi = null; closeSheet(); initMap(); loadForecast(); loadLive(); loadPlans(); drawAll(); break;
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
      case 'jfopen': openJoin(); break;
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
      case 'plan': if (S.view === 'me') closeSheet(); go('#plan/' + d.plan); break;
      case 'plday': S.pf.day = d.day || null; S.pf.touched = true; renderSheet(); break;
      case 'plpeople': S.pf.people = Math.max(1, Math.min(12, S.pf.people + Number(d.d))); S.pf.touched = true; renderSheet(); break;
      case 'plgo': planGo(); break;
      case 'plleave': after(HI8.withKey('hi8_plan_leave', { p_plan: S.pf.slug }, { noQueue: true }), function (r) { var p = planBy(S.pf.slug); if (p) { p.mine = null; p.interested = r.interested; } S.pf.touched = false; drawPlans(); renderSheet(); toast('Done: you\'re out of this one.'); }).catch(noop); break;
      case 'plshare': { var pp = planBy(S.pf.slug), tx = 'Who\'s in? ' + pp.title + ' at ' + pp.place + (S.pf.day ? ', ' + dayRel(S.pf.day).toLowerCase() : '') + '. ' + location.origin + location.pathname.replace(/[^/]*$/, '') + '#plan/' + pp.slug;
        if (navigator.share) navigator.share({ title: pp.title, text: tx }).catch(noop); else window.open('https://wa.me/?text=' + encodeURIComponent(tx), '_blank', 'noopener'); break; }
      case 'from': S.fromBack = S.view === 'start' ? '#start' : null; go('#from'); break;
      case 'geo': geoHome(); break;
      case 'sethome': setHome({ name: d.name, lat: Number(d.lat), lon: Number(d.lon) }); afterHome(); break;
      case 'homename': { var hn = ($('#homeName') || {}).value || '', hc = home(); hn = hn.trim().toUpperCase().replace(/\s+/g, ' ').slice(0, 32); if (hc && hn.length >= 2) { hc.name = hn; setHome(hc); afterHome(); toast('Saved: ' + esc(hn) + '.'); } break; }
      case 'clearhome': setHome(null); afterHome(); break;
      case 'startfrom': newStart({}); go('#start'); break;
      case 'topup': topup(d.cents, d.back === 'crew' ? location.href.split('#')[0] : null); break;
      case 'payseat': after(HI8.withKey('hi8_pay_seat', { p_code: S.crew.code }, { noQueue: true }), function (dd) { S.crew.data = dd; loadWallet(); renderSheet(); toast('Paid: your seat is yours. Held until the ride.'); }).catch(noop); break;
      case 'pass': toast('<span class="spin"></span> Opening Stripe…', 8000); HI8.fn('stripe-checkout', { key: HI8.me().key, kind: 'pass', plan: d.plan, back: location.href.split('#')[0] + '#me' }).then(function (r) { if (r && r.url) location.href = r.url; }, function (e) { toast(errText(e), 5000); }); break;
      case 'payout': toast('<span class="spin"></span> One moment…', 8000); HI8.fn('stripe-checkout', { key: HI8.me().key, kind: 'payout', country: S.city === 'barcelona' ? 'ES' : 'NL', back: location.href.split('#')[0] + '#me' }).then(function (r) {
          if (r && r.url) location.href = r.url; else if (r && r.done) { toast('On its way: ' + euro(r.cents) + ' to your bank.', 6000); loadWallet(); } }, function (e) { toast(errText(e), 5000); }); break;
      case 'planfrom': loadPlan(true); toast('Done: the pick-ups are worked out from there.'); break;
      case 'svhub': S.save.hub = d.hub; drawSave(); break;
      case 'svspot': S.save.spot = d.spot; drawSave(); break;
      case 'wkcell': if (d.sport !== S.sport) setSport(d.sport); S.spotDay = Number(d.i); if (d.spot) go('#spot/' + d.spot); break;
      case 'spotat': S.spotDay = Math.max(0, Math.round((dDate(d.date) - dDate(S.today)) / 864e5)); go('#spot/' + d.spot); break;
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
    if (a === 'kg') { var v = Math.max(35, Math.min(140, Number(t.value) || 75)); HI8.store.set('kg', v); drawAll(); if (S.view === 'kg') renderSheet(); }
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
    if (kind === 'where') {
      var wem = fm.querySelector('input[type=email]').value.trim(), wc = fm.getAttribute('data-city');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(wem)) { toast("That email doesn't look right."); return; }
      after(HI8.rpc('hi8_waitlist', { p_city: wc, p_email: wem, p_source: src().source || 'where-next' }), function (out) {
        var o = {}; o[wc] = 1; S.waitlisted = Object.assign({}, S.waitlisted, o); drawWhere();
        toast(out.already ? "You're already on the " + esc(out.name) + ' list.' : "You're on the " + esc(out.name) + ' list. You hear first.', 5000);
      }).catch(noop);
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
    return HI8.rpc('hi8_live', { p_city: S.city }).then(function (l) { S.live = l; drawMapSpots(); drawCrews(); drawSessions(); drawNow(); drawLive(); if (S.view && S.view !== 'start') renderSheet(); }, noop);
  }
  function boot() {
    frame(); sheet = $('#sheet');
    var paid = P.get('paid');
    if (paid) { // back from Stripe: the webhook credits the wallet within seconds
      var q2 = new URLSearchParams(location.search); q2.delete('paid'); history.replaceState(null, '', location.pathname + (q2.toString() ? '?' + q2 : '') + location.hash);
      setTimeout(function () { toast({ topup: 'Top-up paid: it shows in your wallet in a few seconds.', pass: 'Welcome to the Hi8 Pass.', payout: 'Withdrawals are set up.' }[paid] || 'Done.', 6000); }, 300);
      [2500, 7000].forEach(function (t) { setTimeout(loadWallet, t); });
    }
    var stop = P.get('stop');
    if (stop && HI8.live) HI8.rpc('hi8_unsubscribe', { p_token: stop }).then(function (r) { toast(r.stopped ? 'Stopped: no more ' + esc((SPORT[r.sport] || { name: r.sport }).name) + ' crew emails.' : 'Already stopped.', 6000); }, function () { toast('That stop link didn\'t work. Email hello@hi8ctane.com and we\'ll do it.'); });
    drawAll(); initMap();
    if (HI8.live) {
      HI8.rpc('hi8_settings', {}).then(function (s) { S.settings = s; drawTop(); drawSave(); drawWeek(); }, noop);
      HI8.onData(function () { drawTop(); drawCrews(); drawSessions(); drawMapSpots(); if (S.view === 'join' || S.view === 'me') renderSheet(); });
      window.addEventListener('focus', function () { if (Date.now() - (S.plansAt || 0) > 120000) { S.plansAt = Date.now(); loadPlans(); } });
      HI8.loadPlaces().then(function () { fitMap(); loadForecast(); drawAll(); }, function () { loadForecast(); });
      loadLive(); loadPlans();
      setInterval(function () { if (!document.hidden) { loadLive(); HI8.loadCrews(true).catch(noop); } }, 60000);
    } else loadForecast();
    setInterval(function () { if (!document.hidden) loadForecast(); }, 30 * 60e3);
    setInterval(function () { var h = S.nowH; refreshToday(); if (h !== S.nowH) drawTime(); }, 60000);
    route();
  }
  boot();
})();
