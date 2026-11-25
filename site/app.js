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
  var LEVEL_SUB = { rookie: "can't ride on my own yet", regular: 'I ride on my own', ripper: 'advanced: strong wind, waves, jumps' };
  var CREW_LEVELS = { regular: 'INDEPENDENT RIDERS', all: 'ALL LEVELS · ROOKIES WELCOME', rookie: 'ROOKIE SESSION' };
  var DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var ERR = {
    crew_full: 'This crew is full.', level: 'This crew is for independent riders: you launch, ride upwind and get back in on your own.', crew_off: 'This crew was called off.', crew_past: 'This crew already happened.',
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
  // H19: captain powers only when nobody is being asked (the server refuses them during a handover too, 0028)
  function cap(c) { return !!(c && c.host_is_me && !c.captain_until); }
  function dayInLine(s) { var r = dayRel(s); return /^(TODAY|TOMORROW)$/.test(r) ? r.toLowerCase() : r.toLowerCase().replace(/\b[a-z]/g, function (x) { return x.toUpperCase(); }); }   // "tomorrow", "Fri 27 Nov"
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
    city: (P.get('city') || HI8.store.get('city28', null) || 'amsterdam'),
    sport: (P.get('sport') || P.get('sp') || HI8.store.get('sport28', null) || 'kite'),
    variant: P.get('v') || 'map', settings: null, today: null, tz: 'Europe/Madrid', hi: null, layer: 'wind', playing: null,
    crew: null, sf: null, jf: null, joinDay: 'all', spotDay: 0, live: null, me: HI8.me()
  };
  if (LIVE_SPORTS.indexOf(S.sport) < 0) S.sport = 'kite';
  // landing iterations: ?v=1 conditions up top, ?v=2 one list to join or start, default 3 (both, polished, set-up inline)
  var V = { '1': 1, '2': 2 }[P.get('v')] || 3;
  // a first visit opens on the Netherlands, where the kite launch is (2.17); the region switch is one tap away
  function kg() { return Number(HI8.store.get('kg', 75)) || 75; }
  function kgSet() { return HI8.store.get('kg', null) != null; }
  // the rider's level for a sport (rookie / regular / ripper), null until they set it
  function lvSet(sport) { return HI8.store.get('lv.' + (sport || S.sport), null); }
  // options for every rating: weight (kite size) and level (the safety caps)
  function fxo(sport) { return { kg: kg(), level: lvSet(sport) || 'regular' }; }
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
  function rateAt(spot, t, sport) { var sp = fxSpot(spot.slug), r = rowAt(spot.slug, t); return r ? FX.rate(sport || S.sport, spot, r, sp.days[r.d], fxo(sport)) : null; }
  function crewFx(c) {
    var spot = HI8.spot(c.spot), sp = fxSpot(c.spot);
    if (!spot || !sp) return null;
    var from = Number(hm(c.start).slice(0, 2)), to = c.end ? Math.max(from + 1, Number(hm(c.end).slice(0, 2)) + (hm(c.end).slice(3) > '00' ? 1 : 0)) : from + 3;
    return FX.span(sp, c.day, from, to, c.sport, spot, fxo(c.sport));
  }
  function times() { var G = FX.gridData[S.city]; if (G) return G.time; var any = spotsFor(S.city, S.sport)[0], sp = any && fxSpot(any.slug); return sp ? sp.hours.filter(function (r) { return r.d >= S.today; }).map(function (r) { return r.t; }) : []; }
  function defaultHour() {
    var T = times(); if (!T.length) return 0;
    var want = S.nowH < 8 ? S.today + 'T12:00' : S.nowH >= 18 ? FX.addDays(S.today, 1) + 'T12:00' : S.today + 'T' + pad(S.nowH) + ':00';
    var i = T.indexOf(want); return i < 0 ? 0 : i;
  }

  // ---------------------------------------------------------------- the 2.7 look: tiles, ribbons, verdicts
  var SCOL = { kite: '#2A6F86', wing: '#5B3F99', surf: '#2297AA', sup: '#2A8C74', mtb: '#1F4FA0', mx: '#5C6B2F', windsurf: '#B4472E', wake: '#0E7A8C', snow: '#3B6FB5', other: '#4A4538' };
  var ICON = {
    kite: '<path d="M3 11l18-8-8 18-2-8z"/>',
    wing: '<path d="M3.5 16 C5 9 11 5 20 4.5 C17 9 15.5 13.5 15.5 19.5 C12 17.5 8 16.3 3.5 16 Z"/><path d="M9.8 10.4 L15.5 19.5"/>',
    surf: '<path d="M3 17.5 C3 10.5 8.3 6 14 6 C18 6 21 8.6 21 11.6 C21 14 19 15.4 17 14.6 C15.6 14 15.4 12.2 16.8 11.6"/><path d="M3 20.5 H21"/>',
    sup: '<circle cx="12.6" cy="4.4" r="2"/><path d="M12.2 7.4 L9.6 16.4 M12.2 7.4 L15.4 11 M17.6 6.2 L13.4 21"/><path d="M3 17.4 C7.4 19.4 14.6 19.6 21 16"/>',
    mtb: '<circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/><path d="M5.5 16 L9.5 8.5 L15.5 8.5 L18.5 16 M9.5 8.5 L12 16"/>',
    mx: '<circle cx="5.5" cy="16.5" r="3.6"/><circle cx="18.5" cy="16.5" r="3.6"/><path d="M5.5 16.5 L8.8 11.4 H14 L18.5 16.5 M7.2 9 H12.2 L14 11.4 L16.2 6.2 M14.6 6.2 H18.2 M16.8 9.6 L20.8 10.6"/>',
    windsurf: '<path d="M12 3 V17 H19 Z"/><path d="M12 3 C8 7 7.4 12 8.6 17"/><path d="M3 20 H21"/>',
    wake: '<path d="M3 19.5 C8 21.5 16 21.5 21 19.5"/><circle cx="8.5" cy="6.5" r="2"/><path d="M8.5 9.5 L9.5 16.5 M9 11.5 L15 8 M13.5 4 L20.5 10"/>',
    snow: '<path d="M12 2.5 V21.5 M3.8 7.2 L20.2 16.8 M20.2 7.2 L3.8 16.8"/><path d="M9.5 4.5 L12 7 L14.5 4.5 M9.5 19.5 L12 17 L14.5 19.5"/>',
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
  var LVL = { rookie: ['ROOKIE CREW', '#FFE14D'], all: ['ALL LEVELS', '#FFFFFF'], regular: ['INDEPENDENT', '#C8FF3D'] };
  var AVC = ['#FFE14D', '#FFC2D6', '#8DF5E8', '#C8FF3D', '#FFFFFF'];
  var BARS = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M5 19 V15 M10 19 V11 M15 19 V7 M20 19 V4"/></svg>';
  var CLOCK = '<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M12 1.5a10.5 10.5 0 1 0 0 21 10.5 10.5 0 0 0 0-21zm-1.4 4.5h2.8v5.3l4 2.4-1.4 2.4-5.4-3.2z"/></svg>';
  var CAR = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path fill-rule="evenodd" d="M2.5 18v-6l2.8-5.5h13.4L21.5 12v6h-2.3a2.6 2.6 0 0 1-5.2 0h-4a2.6 2.6 0 0 1-5.2 0zM7.2 11.3h9.6l-1.5-3H8.7z"/></svg>';
  var SHIELD = '<svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.8 3.5 5v6.2c0 5.2 3.6 9.6 8.5 11 4.9-1.4 8.5-5.8 8.5-11V5z" fill="#111"/><path d="M7.6 12.2l3 3 5.8-6" fill="none" stroke="#F3EFE3" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // ---------------------------------------------------------------- the money: fuel, the share, the Hi8 fee
  // Fuel for the round trip (HI8.FUEL: 7 L/100 km with boards on, at the region's pump price; roads 30% longer than the crow flies), split evenly.
  // Riders add the Hi8 fee on top of their share (15%, set in Supabase); the driver gets the full share.
  // During the pilot the fee is shown but not charged (fee_live false).
  function spain(city) { var co = cityObj(city || S.city); return co.country ? co.country === 'ES' : ['barcelona', 'tarifa'].indexOf(city || S.city) >= 0; }
  function feePct() { var v = S.settings && S.settings.ride_fee_pct; return v == null ? 15 : Number(v); }
  function memberPct() { var v = S.settings && S.settings.member_fee_pct; return v == null ? 10 : Number(v); }
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
      '<div class="mapnote" id="mapnote"></div><div class="mapdays" id="mapdays" role="group" aria-label="Day on the map"></div>' +
      '<div class="mapbtns"><button class="mbtn" data-act="zoom" data-d="0.6" aria-label="Zoom in">+</button><button class="mbtn" data-act="zoom" data-d="-0.6" aria-label="Zoom out">−</button>' +
      '<button class="mbtn txt" id="layerBtn" data-act="layer" aria-pressed="false">RAIN</button></div>' +
      '<div class="legend" aria-hidden="true">0 <i id="legendBar"></i> 40 KT</div>' +
      '<div class="timebar"><button class="play" id="play" data-act="play" aria-label="Play the next hours">▶</button>' +
      '<div class="tl"><div class="hours" id="hours" role="group" aria-label="Hour on the map"></div></div>' +
      '<div class="when" id="when"></div></div><div class="mapcard" id="mapcard" hidden></div></section>' +
      '<main class="panel" id="panel">' +
      '<section class="blk nextw" id="next" hidden></section>' +
      '<section class="hero ht" id="hero"><canvas class="herofx" id="heroFx" aria-hidden="true"></canvas>' +
      '<div class="kick"><span class="blink pdot"></span><span id="heroKick">LIVE CREWS · KITE · MTB · MX</span></div>' +
      '<h1 class="hl">THE FORECAST SAYS GO.<br><span>WE GET YOU THERE.</span></h1>' +
      '<p class="lede0">Good sessions near you, a crew at your level and a seat in the car. Tap <b>I\'M GOING</b>. No app to install.</p>' +
      '<div class="herowind wait" id="heroWind" aria-hidden="true"><b>··</b> KT<span>CHECKING THE FORECAST</span></div><div class="herostat" id="heroStat"></div><div class="looking" id="looking" hidden></div></section>' +
      '<div class="ctx" id="ctx"><div class="sps" id="sports"></div><button class="ctxfrom" data-act="from" id="ctxFrom"></button></div>' +
      '<div class="pg">' +
      (V === 1 ? '<section class="blk" id="crews"></section>' : '<section class="blk" id="sessions"></section>') +
      '<section class="blk" id="live"></section>' +
      '<section class="blk" id="how">' + howHtml() + '</section>' +
      '<section class="blk more" id="more"><div class="sec2"><b>MORE</b><span>WHEN YOU WANT IT</span></div>' +
      '<details class="mo" id="moWeek"><summary><b>THE WEEK AHEAD</b><span>Every sport, every day, and the best window</span></summary><section class="blk" id="week"></section><section class="blk" id="best"></section></details>' +
      '<details class="mo" id="moSafe"><summary><b>SAFETY AND THE SPLIT</b><span>The buddy rule, riding with people you don\'t know yet, the fuel</span></summary><section class="blk" id="buddy">' + buddyHtml() + '</section><section class="blk" id="save"></section><section class="blk" id="trust">' + trustHtml() + '</section></details>' +
      '<details class="mo" id="moPlans"><summary><b>DAYS OUT</b><span>Plans with our partners</span></summary><section class="blk" id="plans"></section></details>' +
      '<details class="mo" id="moWhere"><summary><b>WHERE NEXT</b><span>Your town, other regions, trips</span></summary><div id="towns"></div><div id="where"></div></details>' +
      '<details class="mo" id="moPass"><summary><b>THE HI8 PASS</b><span>' + 'Members pay 10% instead of 15% on every ride' + '</span></summary><div id="passSlot"></div></details>' +
      '<details class="mo" id="moSoon"><summary><b>MORE SPORTS SOON</b><span>Get an email when yours opens</span></summary><div class="sps soonr" id="soonSports"></div></details>' +
      '<a class="mo" href="schools/"><b>FOR SCHOOLS + RENTAL SHOPS</b><span>We send you riders who already have a crew →</span></a>' +
      '</section>' +
      '<section class="blk mapsec" id="mapsec"><div class="sec2"><b>THE LIVE MAP</b><span>WIND · CREWS · WHO\'S THERE</span></div><div class="mapbox" id="mapslot"></div>' +
      '<div class="mapend"><span>SEE YOU OUT THERE.</span><i class="looking" id="looking2" hidden></i><button class="sygo" data-act="top">FIND MY NEXT SESSION ↑</button></div></section>' +
      '</div>' +
      '<div class="credits">Forecast: Open-Meteo (CC BY 4.0): a local model for the first days (KNMI HARMONIE in the Netherlands, Météo-France AROME in Spain), then ECMWF, ICON and GFS, compared hour by hour for the "models agree" line. Waves and water temperature: Open-Meteo Marine. Coastlines: Natural Earth. A model forecast, not a beach sensor: every session is your own call. 18+.<br>' +
      '<a href="terms/">Terms</a> · <a href="privacy/">Privacy</a> · <a href="schools/">Schools + rental shops</a> · <a href="B27-City.dc.html">Other cities</a> · <a href="world/">The world</a> · hi8ctane.com</div>' +
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
    if (mw.parentNode !== want) { want.appendChild(mw); if (map) { map.setCoop(!wide.matches); setTimeout(fitMap, 30); } }
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
    if (!has && !FX.data[S.city] && !FX.error) { heroFx(); return; } // still loading: keep the placeholder's space, so nothing jumps
    if (el) { el.classList.remove('wait'); el.removeAttribute('aria-hidden'); }
    if (el) el.innerHTML = has ? '<b>' + f.w + '</b> KT ' + esc(FX.compass(f.dir)) + '<i style="transform:rotate(' + ((f.dir + 180) % 360) + 'deg)">↑</i><span>' + esc(o.spot.name.toUpperCase()) + ' · ' + esc(dayRel(o.date)) + ' ' + pad(o.from) + '–' + pad(o.to) + '</span>' : '';
    heroFx();
  }
  // the wind streaks over the hero (2.14) are off: they crossed the text (2.24). true brings them back
  var HERO_LINES = false;
  function heroFx() {
    var cv = $('#heroFx'), box = $('#hero'); if (!HERO_LINES || !cv || !box || !cv.getContext) return;
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
  // your next crew (today, or tomorrow) so the home screen says you're going (2.24)
  function myNext() {
    var t = S.today, tm = FX.addDays(t, 1), nowT = pad(S.nowH) + ':' + pad(S.nowM);
    return ((HI8.mine && HI8.mine.crews) || []).filter(function (c) {
      if (c.status === 'off' || c.past) return false;
      if (c.day === t) return c.live || (c.end ? hm(c.end) : fromMin(minutes(c.start) + 180)) > nowT;
      return c.day === tm;
    }).sort(function (a, b) { return a.day + hm(a.start) < b.day + hm(b.start) ? -1 : 1; })[0] || null;
  }
  // how you get there, in a line: "Frankie drives from Haarlem at 09:45"
  function mineLine(c) {
    var hub = hubOf(c), meet = c.meet_time ? hm(c.meet_time) : null, sp = HI8.spot(c.spot) || {}, name = sp.name || c.spot_name || '';
    if (hub && meet) return (cap(c) ? 'You leave' : esc(c.host) + '\'s crew leaves') + ' from <b>' + esc(title(hub.name)) + '</b> at <b>' + esc(meet) + '</b>';
    return 'Meet at <b>' + esc(name) + '</b> at <b>' + esc(hm(c.start)) + '</b>';
  }
  var HERO0 = null;
  function drawHeroMine(c) {
    var hero = $('#hero'); if (!hero) return;
    var h1 = hero.querySelector('.hl'), lede = hero.querySelector('.lede0'), kick = $('#heroKick');
    if (!HERO0 && h1) HERO0 = { h1: h1.innerHTML, lede: lede.innerHTML };
    hero.classList.toggle('mine', !!c);
    if (!c) { if (HERO0 && hero.dataset.mine) { h1.innerHTML = HERO0.h1; lede.innerHTML = HERO0.lede; delete hero.dataset.mine; } return; }
    var sp = HI8.spot(c.spot) || {}, name = (sp.name || c.spot_name || '').toUpperCase(), sport = SPORT[c.sport] ? SPORT[c.sport].name.toUpperCase() : '';
    hero.dataset.mine = c.code;
    if (kick) kick.textContent = 'YOUR CREW · ' + sport + ' · ' + c.going + ' GOING';
    h1.innerHTML = 'YOU\'RE GOING.<br><span>' + esc(dayRel(c.day)) + ' · ' + esc(name) + '</span>';
    lede.innerHTML = mineLine(c) + '. Session ' + esc(hm(c.start)) + (c.end ? '–' + esc(hm(c.end)) : '') + '. ' + (c.going > 1 ? c.going + ' riders in.' : 'You\'re the only one in so far: share it.');
  }
  function drawDock(L) {
    var b = $('#dockGo'); if (!b) return;
    // UX review H07: the dock never promotes a session the forecast is against
    var o = (L || sessions()).filter(function (x) { return !x.crews.length ? FX.tone(x.fx && x.fx.score) !== 'no' : suitRank(x.crews[0]) < 2; })[0], mc = myNext();
    heroWind(o); drawHeroMine(mc);
    // UX review H14: with a session booked (any day), the dock opens it instead of pitching another crew
    if (!mc) { var nc = nextCrew(); if (nc && nc.status === 'on') mc = nc; }
    if (mc) {
      var hub = hubOf(mc), sp = HI8.spot(mc.spot) || {};
      b.setAttribute('data-act', 'crew'); b.setAttribute('data-code', mc.code);
      b.innerHTML = 'OPEN MY CREW<small>' + esc(dayRel(mc.day)) + ' · ' + (hub && mc.meet_time ? 'PICK-UP ' + esc(hm(mc.meet_time)) + ' ' + esc(hub.name.toUpperCase()) : esc((sp.name || mc.spot_name || '').toUpperCase()) + ' ' + esc(hm(mc.start))) + '</small>';
      return;
    }
    b.setAttribute('data-act', 'goingbest'); b.removeAttribute('data-code');
    b.innerHTML = (o && !o.crews.length ? 'START A CREW' : 'I\'M GOING') + '<small>' + (o ? 'NEXT: ' + esc(dayRel(o.date)) + ' ' + pad(o.from) + '–' + pad(o.to) + ' · ' + esc(o.spot.name.toUpperCase()) : 'PICK A DAY AND A SPOT') + '</small>';
  }

  // ---------------------------------------------------------------- the map
  var map = null;
  function initMap() {
    var geo = (window.HI8_GEO || {})[S.city];
    if (map) { map.destroy(); map = null; }
    map = window.HI8Map($('#map'), { geo: geo, coop: !wide.matches, onSpot: pickSpot, onEmpty: function () { if (S.mapSel) { S.mapSel = null; drawMapCard(); drawMapSpots(); } }, still: P.get('still') === '1' });
    $('#map')._map = map; // for tests and the console: where a spot is on the map
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
    map.setKeepOut(['.mapbtns', '.legend', '.timebar', '#mapnote .chip', '#mapdays button'].map(function (q) { return Array.prototype.slice.call(document.querySelectorAll(q)); })
      .reduce(function (a, b) { return a.concat(b); }, []).map(function (el) { var r = el.getBoundingClientRect(); return [r.left - base.left - 4, r.top - base.top - 4, r.right - base.left + 4, r.bottom - base.top + 4]; }));
  }
  function drawMapSpots() {
    if (!map) return;
    var T = times(), t = T[S.hi] || null, day = t ? t.slice(0, 10) : null, live = S.live, favs = favList();
    // the crews on the day the map shows (or the next 3 days before the forecast is in)
    var crews = day ? upcoming(S.sport, 7).filter(function (c) { return c.day === day; }) : upcoming(S.sport, 3);
    var drives = [];
    crews.forEach(function (c) {
      var hub = hubOf(c), spot = HI8.spot(c.spot);
      if (hub && spot && (c.drivers || 0) > 0) drives.push({ from: [hub.lat, hub.lon], to: [spot.lat, spot.lon], seats: c.seats_free || 0, label: (c.seats_free > 0 ? c.seats_free + ' SEAT' + (c.seats_free > 1 ? 'S' : '') : 'FULL') + ' · ' + hm(c.meet_time || c.start) });
    });
    if (map.setDrives) map.setDrives(drives);
    map.setSpots(spotsFor(S.city, S.sport).map(function (s) {
      var r = t ? rowAt(s.slug, t) : null, rt = t ? rateAt(s, t) : null, mine = crews.filter(function (c) { return c.spot === s.slug; });
      var here = live ? (live.crews || []).filter(function (c) { return c.spot === s.slug; }).reduce(function (n, c) { return n + (c.here || 0); }, 0) : 0;
      var o = { slug: s.slug, name: s.name, lat: s.lat, lon: s.lon, crews: mine.length, sel: s.slug === S.mapSel, here: here, live: mine.some(function (c) { return c.live; }), fav: favs.indexOf(s.slug) >= 0,
        going: mine.reduce(function (n, c) { return n + (c.going || 0); }, 0), seats: mine.reduce(function (n, c) { return n + (c.seats_free || 0); }, 0) };
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
    drawMapCard();
  }
  // your spots: a star on the spot page, a glow on the map (kept on this phone)
  function watchN(slug) { var n = S.watch ? S.watch[slug] || 0 : 0; return n >= 2 ? n : 0; } // never "1 watching" (that's maybe you)
  function favList() { return HI8.store.get('favs', []) || []; }
  function toggleFav(slug) { var f = favList(), i = f.indexOf(slug); if (i >= 0) f.splice(i, 1); else f.push(slug); HI8.store.set('favs', f); return i < 0; }
  // wind for kite, rain for MTB and MX, unless the rider switched it
  function effLayer() { return S.layerSet ? S.layer : (S.sport === 'kite' ? 'wind' : 'rain'); }
  // the best verdict over this sport's spots at one hour (for the hour strip) and over a day (for the day chips)
  function bestAt(t) {
    var b = null; spotsFor(S.city, S.sport).forEach(function (sp) { var r = rateAt(sp, t); if (r && !r.dark && (!b || r.s > b.s)) b = r; }); return b;
  }
  function bestDay(d) {
    var b = null; if (!FX.data[S.city]) return null;
    spotsFor(S.city, S.sport).forEach(function (sp) { var fs = fxSpot(sp.slug); if (!fs) return; var w = FX.windows(fs, d, S.sport, sp, fxo(S.sport)).filter(function (x) { return d !== S.today || x.to > S.nowH + 1; })[0]; if (w && (!b || w.score > b.score)) b = Object.assign({ spot: sp }, w); });
    return b;
  }
  function drawTime() {
    var T = times(), hs = $('#hours');
    if (!T.length) { $('#when').innerHTML = ''; hs.innerHTML = ''; return; }
    if (S.hi == null || S.hi >= T.length) S.hi = defaultHour();
    var t = T[S.hi], cur = t.slice(0, 10), isNow = t === S.today + 'T' + pad(S.nowH) + ':00';
    $('#when').innerHTML = esc(FX.dayName(cur, S.today)) + ' ' + t.slice(11, 16) + (isNow ? '<small>NOW</small>' : '<small><button data-act="now">BACK TO NOW</button></small>');
    // the hours of that day you'd ride in: big enough for a thumb, the colour of the best spot then
    var first = cur === S.today ? Math.max(6, S.nowH) : 6, cells = [];
    for (var h = first; h <= 21; h++) { var i = T.indexOf(cur + 'T' + pad(h) + ':00'); if (i >= 0) cells.push([h, i]); }
    var bw = bestDay(cur);
    hs.innerHTML = cells.map(function (c) {
      var b = bestAt(T[c[1]]), tone = !b ? 'none' : FX.tone(b.s), inW = bw && c[0] >= bw.from && c[0] < bw.to;
      return '<button class="hr t-' + tone + (inW ? ' win' : '') + '" data-act="hourpick" data-i="' + c[1] + '" aria-pressed="' + (c[1] === S.hi) + '" aria-label="' + pad(c[0]) + ':00' + (b ? ', best ' + b.label : '') + '">' + pad(c[0]) + '</button>';
    }).join('');
    var sel = hs.querySelector('[aria-pressed=true]');
    if (sel && !S.hoursTouched) { var L = sel.offsetLeft - hs.clientWidth / 2 + sel.offsetWidth / 2; hs.scrollLeft = Math.max(0, L); }
    var dates = []; T.forEach(function (x) { var d = x.slice(0, 10); if (dates.indexOf(d) < 0 && T.indexOf(d + 'T12:00') >= 0) dates.push(d); });
    var crewDays = upcoming(S.sport, 7).map(function (c) { return c.day; });
    $('#mapdays').innerHTML = dates.map(function (d) {
      var n = crewDays.filter(function (x) { return x === d; }).length, b = bestDay(d);
      return '<button data-act="mapday" data-date="' + d + '" aria-pressed="' + (d === cur) + '" aria-label="' + esc(FX.dayName(d, S.today)) + (b ? ': ' + b.label + ' at ' + esc(b.spot.name) + ' ' + pad(b.from) + '–' + pad(b.to) : ': nothing good') + (n ? ', ' + n + ' crew' + (n > 1 ? 's' : '') : '') + '">' +
        esc(d === S.today ? 'TODAY' : FX.dayName(d, S.today).slice(0, 3).toUpperCase()) + '<b class="dt t-' + (b ? FX.tone(b.score) : 'none') + '"></b>' + (n ? '<i>' + n + '</i>' : '') + '</button>';
    }).join('');
    $('#layerBtn').textContent = effLayer() === 'rain' ? 'WIND' : 'RAIN';
  }

  // ---- the spot card on the map: the hour you're looking at, the best window that day, and the crews: hop on, or start one
  function pickSpot(slug) {
    S.mapSel = slug; drawMapSpots();
    var sp = HI8.spot(slug), el = $('#map');
    if (sp && map && el) map.center(sp.lat, sp.lon, el.clientWidth / 2, Math.max(80, el.clientHeight * (wide.matches ? 0.3 : 0.62)));
    look();
  }
  function drawMapCard() {
    var el = $('#mapcard'); if (!el) return;
    var sp = S.mapSel ? HI8.spot(S.mapSel) : null, T = times(), t = T[S.hi];
    var mw = el.parentNode;
    if (!sp || !t) { el.hidden = true; el.innerHTML = ''; if (mw) mw.classList.remove('carded'); return; }
    var day = t.slice(0, 10), r = rowAt(sp.slug, t), rt = t ? rateAt(sp, t) : null, kite = S.sport === 'kite' || S.sport === 'wing' || S.sport === 'windsurf';
    var fs = fxSpot(sp.slug), ws = fs ? FX.windows(fs, day, S.sport, sp, fxo(S.sport)).map(function (x) { return day === S.today ? Object.assign({}, x, { from: Math.max(x.from, S.nowH + 1) }) : x; }).filter(function (x) { return x.to - x.from >= 1; }) : [];
    var w = ws[0] || null, crews = upcoming(S.sport, 7).filter(function (c) { return c.day === day && c.spot === sp.slug; }).sort(byFit);
    var now = !r || !rt ? '<span class="tag none">NO FORECAST</span>' : rt.dark ? '<b>DARK</b>' :
      '<b>' + (kite ? Math.round(r.w) + ' KT ' + esc(FX.compass(r.dir)) : esc((rt.ground || '').toUpperCase()) + ' · ' + Math.round(r.temp) + '°C') + '</b> <span class="tag ' + FX.tone(rt.s) + '">' + esc(rt.label) + '</span>' +
      (kite && r.g ? '<small>gusts ' + Math.round(r.g) + (rt.shore ? ' · ' + esc(rt.shore) : '') + '</small>' : '');
    var win = w ? '<div class="mc-w">BEST HERE ' + esc(dayRel(day).toUpperCase()) + ': <b>' + pad(w.from) + '–' + pad(w.to) + (kite ? ' · ' + w.w + ' KT' : '') + '</b> <span class="tag ' + FX.tone(w.score) + '">' + esc(w.label) + '</span>' +
        (S.hi !== T.indexOf(day + 'T' + pad(w.from) + ':00') && T.indexOf(day + 'T' + pad(w.from) + ':00') >= 0 ? ' <button class="lnk" data-act="hourpick" data-i="' + T.indexOf(day + 'T' + pad(w.from) + ':00') + '">SHOW</button>' : '') + '</div>'
      : (function () { var b = bestDay(day); return '<div class="mc-w">No good window here ' + esc(dayRel(day)) + '.' + (b && b.spot.slug !== sp.slug ? ' Best: <button class="lnk" data-act="mapspot" data-spot="' + esc(b.spot.slug) + '">' + esc(b.spot.name.toUpperCase()) + ' ' + pad(b.from) + '–' + pad(b.to) + '</button>' : '') + '</div>'; })();
    var list = crews.slice(0, 2).map(function (c) {
      var mine = !!(c.me || (HI8.mine && (HI8.mine.crews || []).some(function (x) { return x.code === c.code; })));
      return '<div class="mc-c">' + faces(c) + '<span><b>' + esc(c.host) + '\'s crew</b> ' + esc(hm(c.start).replace(':00', '')) + (c.end ? '–' + esc(hm(c.end).replace(':00', '')) : '') + '<small>' + c.going + ' going' + (c.seats_free > 0 ? ' · ' + c.seats_free + ' seat' + (c.seats_free > 1 ? 's' : '') + ' free' : '') + (c.min && !c.min_met ? ' · needs ' + (c.min - c.going) + ' more' : '') + '</small></span>' +
        '<button class="big ' + (mine ? 'ghost' : 'join') + '" data-act="' + (mine ? 'crew' : 'going') + '" data-code="' + esc(c.code) + '">' + (mine ? 'YOUR CREW' : 'I\'M GOING') + '</button></div>';
    }).join('') + (crews.length > 2 ? '<button class="lnk" data-act="spot" data-spot="' + esc(sp.slug) + '">+' + (crews.length - 2) + ' MORE CREWS</button>' : '');
    var start = w && !(day === S.today && w.to <= S.nowH + 1) ? '<button class="big start" data-act="startwin" data-spot="' + esc(sp.slug) + '" data-date="' + day + '" data-from="' + w.from + '" data-to="' + w.to + '">' + (crews.length ? 'START YOUR OWN' : 'START IT · ' + pad(w.from) + '–' + pad(w.to)) + '</button>' : '';
    el.innerHTML = '<button class="mc-x" data-act="mapcardx" aria-label="Close">✕</button>' +
      '<div class="mc-k">' + esc(dayRel(day).toUpperCase()) + ' ' + t.slice(11, 16) + ' · ' + esc(sp.name.toUpperCase()) + (watchN(sp.slug) ? ' · ' + watchN(sp.slug) + ' WATCH' : '') + '</div>' +
      '<div class="mc-h">' + now + '</div>' + win +
      (list || '<div class="mc-c none">Nobody\'s going ' + esc(dayRel(day)) + ' yet.' + (lookingOn(day) ? ' ' + esc(lookingLine(day)) + ': start it and they hear it.' : watchN(sp.slug) ? ' ' + watchN(sp.slug) + ' riders watch it: go first and they hear it.' : '') + '</div>') +
      '<div class="mc-f">' + start + '<button class="big ghost" data-act="spot" data-spot="' + esc(sp.slug) + '">FULL FORECAST</button></div>';
    var was = !el.hidden;
    el.hidden = false;
    // phones: the card opens under the map (the map keeps its size), not over it
    if (!wide.matches && mw) {
      mw.style.setProperty('--cardh', el.offsetHeight + 'px'); mw.classList.add('carded');
      if (!was) setTimeout(function () { var r = el.getBoundingClientRect(), dock = $('.dock'), db = dock ? dock.getBoundingClientRect().top : innerHeight; if (r.bottom > db - 8) scrollBy({ top: r.bottom - db + 16, behavior: 'smooth' }); }, 60);
    }
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
  // UX review H07: is this session worth promoting? Separate from the plan and from safety (never "safe").
  //   go: the forecast fits · light: not enough wind/ground yet, the plan can still hold · hazard: the forecast
  //   says don't (offshore, storm, too strong, wrong direction, very gusty) · doubt: the server recheck said no ·
  //   none: no forecast for that day yet. Closures aren't known to the app (no data source), so never claimed.
  function suit(c) {
    var f = c ? crewFx(c) : null;
    // 0028: a closure entered for this spot and day beats any forecast (the server refuses joins too)
    if (c && c.closed) return { k: 'closed', t: 'CLOSED THAT DAY', s: c.closed + '.' };
    if (c && c.checked_ok === false) return { k: 'doubt', t: 'RECHECK SAYS DOUBTFUL', s: c.checked_note || 'The forecast recheck went against this session.' };
    if (!f) return { k: 'none', t: 'NO FORECAST YET', s: 'The forecast for this day isn\'t out yet.' };
    if (FX.data[c.city] && FX.data[c.city].stale) return { k: 'stale', t: 'OLDER FORECAST', s: 'We couldn\'t refresh the forecast just now: this is the last one we had. Check again before you go.' };
    if (FX.tone(f.score) !== 'no') return { k: 'go', t: f.label, s: '' };
    var w = (f.why || []).join(' ') + ' ' + (f.caps || []).join(' ').toLowerCase();
    // a real hazard always wins; then "not enough wind" is a soft no; any other NO GO (gusty, onshore, cold for this level) isn't promoted
    var light = /too light|light: big kite/.test(w), hard = /offshore|wrong direction|very strong|thunder|storm|very gusty/.test(w);
    if (hard || !light) {
      var r = /offshore/.test(w) ? 'it blows offshore' : /wrong direction/.test(w) ? 'the wind comes from the wrong direction for this spot' : /very strong/.test(w) ? 'it\'s too strong' : /thunder|storm/.test(w) ? 'thunderstorms' :
        /gust/.test(w) ? 'it\'s too gusty for this crew\'s level' : /onshore/.test(w) ? 'it blows straight onshore' : /cold/.test(w) ? 'the water is too cold for this level' : /mud/.test(w) ? 'the ground is too muddy' : 'conditions don\'t fit';
      return { k: 'hazard', t: 'NOT RECOMMENDED', s: 'The forecast says ' + r + ' in this window.' };
    }
    return { k: 'light', t: c.sport === 'kite' || c.sport === 'wing' ? 'TOO LIGHT SO FAR' : 'NOT GREAT SO FAR', s: c.sport === 'kite' || c.sport === 'wing' ? 'About ' + f.w + ' kt in this window: not enough yet. The captain may move it.' : 'Conditions don\'t fit yet. The captain may move it.' };
  }
  function suitRank(c) { var k = suit(c).k; return k === 'go' ? 0 : k === 'none' || k === 'stale' ? 1 : k === 'light' ? 2 : k === 'closed' ? 4 : 3; }
  function suitBox(c) {
    var u = suit(c); if (u.k === 'go' || c.status !== 'on' || c.past) return '';
    return '<div class="suit s-' + u.k + '" role="note"><b>' + (u.k === 'hazard' || u.k === 'doubt' || u.k === 'closed' ? '⚠ ' : '') + esc(u.t) + '</b><span>' + esc(u.s) + ' A forecast is never a safety check: every session is your own call.</span></div>';
  }
  // a crew already going at this spot on this day, starting within 2 hours of from (the one with most riders)
  function clash(sport, spot, date, from) {
    return upcoming(sport, 14).filter(function (c) { return c.spot === spot && c.day === date && Math.abs(minutes(c.start) - Number(from) * 60) <= 120; })
      .sort(function (a, b) { return (b.going || 0) - (a.going || 0); })[0] || null;
  }
  function mineCodes() { return ((HI8.mine && HI8.mine.crews) || []).map(function (x) { return x.code; }); }
  // a crew, the way 2.7 drew them: sport tile, the spot on the halftone, chips, who's going, the seat price
  // ---------------------------------------------------------------- matching (2.29): the best crew for you first
  function crewLvls(c) { return c.levels === 'rookie' ? ['rookie'] : c.levels === 'all' ? ['rookie', 'regular', 'ripper'] : ['regular', 'ripper']; }
  // how well a crew fits this rider: their level, a seat if they need one, riders they've ridden with, crews close to going
  function fit(c) {
    var s = 0, why = [], lv = HI8.store.get('lv.' + c.sport, null), g = HI8.store.get('getting', null), m = (S.mates || {})[c.code] || 0, hub = hubOf(c), d = nearMe(c);
    if (mineCodes().indexOf(c.code) >= 0) return { s: 100, why: [] };
    if (c.going >= c.max) s -= 20;
    if (m) { s += 2.5 * Math.min(m, 3); why.push(m === 1 ? "1 rider you've ridden with" : m + " riders you've ridden with"); }
    if (lv) { if (crewLvls(c).indexOf(lv) >= 0) { s += 2; why.push('your level'); } else s -= 8; }
    if (g === 'seat') { if (c.seats_free > 0) { s += 3; why.unshift('a seat' + (hub ? ' from ' + title(hub.name) : '')); } else s -= 5; }
    if (c.min && !c.min_met && c.min - c.going > 0 && c.min - c.going <= 2) { s += 1.5; why.push('needs ' + (c.min - c.going) + ' more'); }
    if (d != null) { s -= d / 15; if (hub && d <= 5 && g !== 'seat') why.push('leaves near you'); }
    return { s: s, why: why.slice(0, 2) };
  }
  // best fit first; about equal (within a point) -> the sooner one
  function byFit(a, b) { return Math.round(fit(b).s) - Math.round(fit(a).s) || (a.day + a.start).localeCompare(b.day + b.start); }
  function whyFit(c, cls) { var w = fit(c).why; return w.length ? '<span class="' + (cls || 'why') + '">✓ ' + esc(w.join(' · ')) + '</span>' : ''; }
  function loadMates() {
    if (!signedIn() || !HI8.live) { S.mates = {}; return; }
    HI8.withKey('hi8_mates', {}, { noQueue: true }).then(function (r) { var m = {}; (r || []).forEach(function (x) { m[x.code] = x.mates; }); S.mates = m; drawSessions(); drawCrews(); }, noop);
  }
  // "I'm looking": who's free which day, without starting a crew. Everyone sees numbers, never names.
  function asksFor(sport) { return (S.asks || {})[S.city + '|' + (sport || S.sport)] || []; }
  function loadAsks(sport) {
    sport = sport || S.sport; if (!HI8.live) return;
    HI8.rpc('hi8_asks', { p_city: S.city, p_sport: sport }).then(function (r) { S.asks = S.asks || {}; S.asks[S.city + '|' + sport] = r || []; drawSessions(); if (S.view === 'start' || S.view === 'looking') renderSheet(); }, noop);
  }
  function loadMyAsks() {
    if (!signedIn() || !HI8.live) { S.myAsks = []; return; }
    HI8.withKey('hi8_my_asks', {}, { noQueue: true }).then(function (r) { S.myAsks = r || []; drawSessions(); if (S.view === 'me' || S.view === 'looking') renderSheet(); }, noop);
  }
  function myAsks(sport) { return (S.myAsks || []).filter(function (a) { return a.city === S.city && a.sport === (sport || S.sport) && !a.crew; }); }
  // others looking that day (I'm not counted)
  function lookingOn(day, sport) {
    var r = asksFor(sport).filter(function (x) { return x.day === day; })[0]; if (!r) return null;
    var me = myAsks(sport).filter(function (a) { return a.day === day; })[0], hubs = Object.assign({}, r.hubs || {});
    if (me && me.seat && me.hub && hubs[me.hub]) hubs[me.hub]--;
    var o = { n: r.n - (me ? 1 : 0), seat: r.seat - (me && me.seat ? 1 : 0), rookies: r.rookies - (me && me.level === 'rookie' ? 1 : 0), hubs: hubs };
    return o.n > 0 ? o : null;
  }
  function lookingLine(day, sport) {
    var L = lookingOn(day, sport); if (!L) return '';
    var top = Object.keys(L.hubs).filter(function (k) { return L.hubs[k] > 0; }).sort(function (a, b) { return L.hubs[b] - L.hubs[a]; })[0], hb = top ? HI8.hubsOf(S.city).filter(function (h) { return h.slug === top; })[0] : null;
    return L.n + (L.n === 1 ? ' rider is' : ' riders are') + ' looking for ' + title(dayRel(day)) +
      (L.seat ? ' · ' + L.seat + ' need' + (L.seat === 1 ? 's' : '') + ' a seat' + (hb ? ' (' + L.hubs[top] + ' from ' + title(hb.name) + ')' : '') : '') +
      (L.rookies ? ' · ' + L.rookies + ' learning' : '');
  }
  function weekLooking() { return asksFor().filter(function (x) { return x.day >= S.today; }).reduce(function (n, x) { return n + x.n; }, 0) - myAsks().length; }
  // the box on the landing and in Me
  function lookBox() {
    if (!HI8.live) return '';
    var mine = myAsks(), n = weekLooking();
    if (mine.length) {
      var a = mine[0], hb = a.seat && a.hub ? HI8.hubsOf(S.city).filter(function (h) { return h.slug === a.hub; })[0] : null;
      return '<div class="lookbox on"><b>YOU\'RE UP FOR A RIDE · ' + esc(mine.map(function (x) { return dayRel(x.day).toUpperCase(); }).join(' · ')) + '</b>' +
        '<p>' + (a.seat ? 'A seat' + (hb ? ' from ' + esc(title(hb.name)) : '') : 'Your own way') + '. When a crew that fits goes up, you hear it: once, by push or email.</p>' +
        '<button class="jn wh" data-act="looking">CHANGE</button></div>';
    }
    return '<div class="lookbox"><b>UP FOR A RIDE?</b><p>Say which days you\'re free, even before there\'s a crew. When one fits, you hear it first. Crews you kept see your name; everyone else only a number.' +
      (n > 0 ? ' <b>' + n + ' rider' + (n === 1 ? ' is' : 's are') + ' up for a ride this week.</b>' : '') + '</p><button class="jn lm" data-act="looking">I\'M UP FOR A RIDE</button></div>';
  }
  function newLook(sport) {
    sport = sport || S.sport;
    var mine = myAsks(sport), a = mine[0], hh = homeHub(), g = HI8.store.get('getting', null);
    var hubs = HI8.hubsOf(S.city), near = hh && hh.slug !== '__home' ? hh.slug : (home() && hubs.length ? nearestTo(home(), hubs).slug : null);
    S.lk = { sport: sport, days: mine.map(function (x) { return x.day; }), seat: a ? a.seat : g === 'seat', hub: a && a.hub ? a.hub : near,
      level: a ? a.level : HI8.store.get('lv.' + sport, 'regular'), had: mine.length > 0, busy: false, err: null };
  }
  function sheetLooking() {
    var f = S.lk; if (!f) { newLook(); f = S.lk; }
    var D = FX.data[S.city] ? FX.bestDays(S.city, spotsFor(S.city, f.sport), f.sport, fxo(f.sport), 7) : [];
    var days = []; for (var i = 0; i < 7; i++) days.push(FX.addDays(S.today, i));
    var pSport = '<div class="f"><span class="lb">SPORT</span><div class="row">' + LIVE_SPORTS.map(function (k) { return '<button class="opt ic" data-act="lksport" data-sport="' + k + '" aria-pressed="' + (f.sport === k) + '">' + tile(k, 22) + esc(SPORT[k].name.toUpperCase()) + '</button>'; }).join('') + '</div></div>';
    var pPre = '<div class="row lkpre">' + [['wknd', 'THIS WEEKEND'], ['good', 'EVERY GOOD DAY'], ['all', 'ANY DAY THIS WEEK']].map(function (x) { return '<button class="opt sm" data-act="lkpreset" data-k="' + x[0] + '">' + x[1] + '</button>'; }).join('') + '</div>';
    var pDays = '<div class="f"><span class="lb">WHICH DAYS <small>pick all you could go, or a quick choice</small></span>' + pPre + '<div class="lkdays">' + days.map(function (d) {
        var b = D.filter(function (x) { return x.date === d; })[0], t = !b || b.none ? 'no' : FX.tone(b.score), on = f.days.indexOf(d) >= 0, L = lookingOn(d, f.sport);
        return '<button class="opt" data-act="lkday" data-day="' + d + '" aria-pressed="' + on + '"><span>' + esc(dayRel(d).toUpperCase()) + '</span><small class="t-' + t + '">' + esc(!b || b.none ? 'no go' : b.label + ' ' + pad(b.from) + '–' + pad(b.to)) + '</small>' +
          (L ? '<i>' + L.n + ' looking</i>' : '') + '</button>';
      }).join('') + '</div></div>';
    var hubs = HI8.hubsOf(S.city);
    var pHow = '<div class="f"><span class="lb">HOW YOU\'D GET THERE</span><div class="row">' +
      '<button class="opt" data-act="lkseat" data-v="1" aria-pressed="' + f.seat + '">I NEED A SEAT<small>a driver picks me up</small></button>' +
      '<button class="opt" data-act="lkseat" data-v="0" aria-pressed="' + !f.seat + '">MY OWN WAY<small>I meet them there</small></button></div>' +
      (f.seat ? '<span class="lb" style="margin-top:12px">PICK ME UP AT</span><div class="row">' + hubs.map(function (h) { return '<button class="opt" data-act="lkhub" data-v="' + esc(h.slug) + '" aria-pressed="' + (f.hub === h.slug) + '">' + esc(String(h.name).toUpperCase()) + '</button>'; }).join('') + '</div>' : '') +
      '<p class="hint">Driving? Then start a crew: riders who are looking that day hear about it.</p></div>';
    var pLevel = '<div class="f"><span class="lb">YOUR LEVEL</span><div class="row">' + ['rookie', 'regular', 'ripper'].map(function (l) { return '<button class="opt" data-act="lklevel" data-v="' + l + '" aria-pressed="' + (f.level === l) + '">' + LEVEL[l] + '<small>' + LEVEL_SUB[l] + '</small></button>'; }).join('') + '</div></div>';
    var pYou = signedIn() ? '' : '<div class="f"><span class="lb">YOU <small>to tell you when a crew fits</small></span><label class="sr" for="lkEmail">Email</label><input class="inp" id="lkEmail" type="email" inputmode="email" autocomplete="email" placeholder="Email (only the app sees it)"></div>';
    var pHow2 = '<p class="hint" style="margin:12px 16px 0">When a crew that fits goes up (your level, room, a seat from your pick-up if you need one) you hear it once, by push' + (PUSH.sub ? '' : ' (<a href="#push">turn it on</a>)') + ' or email. Captains see how many riders are looking that day, never who.</p>';
    var err = f.err ? '<div class="err" role="alert">' + esc(f.err) + '</div>' : '';
    var n = f.days.length;
    var foot = '<button class="big join" data-act="lksave"' + (n || f.had ? '' : ' disabled') + '>' + (f.busy ? 'SAVING…' : n ? 'TELL ME WHEN A CREW FITS · ' + n + ' DAY' + (n > 1 ? 'S' : '') : f.had ? 'STOP LOOKING' : 'PICK A DAY') + '</button>';
    return shell("I'M UP FOR A RIDE", pSport + pDays + pYou + pHow + pLevel + err + pHow2, foot, true);
  }
  function lookSave() {
    var f = S.lk; if (!f || f.busy) return;
    var go = function () {
      return HI8.withKey('hi8_ask', { p_city: S.city, p_sport: f.sport, p_days: f.days, p_seat: !!f.seat, p_hub: f.seat ? f.hub : null, p_level: f.level }, { noQueue: true });
    };
    var p;
    if (!signedIn()) {
      var em = ($('#lkEmail') || {}).value || '';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em.trim())) { f.err = 'Your email, so we can tell you.'; renderSheet(); return; }
      p = HI8.rpc('hi8_join', { p_email: em.trim(), p_city: S.city, p_source: 'looking' }).then(keyOrLink(em.trim())).then(function () { return go(); });
    } else p = go();
    f.busy = true; f.err = null; renderSheet();
    HI8.store.set('lv.' + f.sport, f.level); if (f.seat) HI8.store.set('getting', 'seat');
    p.then(function (r) {
      S.myAsks = r || []; var n = f.days.length; S.lk = null; loadAsks(f.sport); loadMates(); if (n) track('looking');
      closeSheet(); drawSessions();
      toast(n ? "You're on the list for " + f.days.map(function (d) { return title(dayRel(d)); }).join(', ') + '. When a crew fits, you hear it.' : 'Not looking any more.', 4000);
    }, function (e) { f.busy = false; f.err = (e && (e.hint || e.message)) || 'That didn\'t save. Try again.'; renderSheet(); });
  }
  // ---------------------------------------------------------------- the session plan (2.30)
  // stages: never "confirmed" just because someone joined
  var STAGES = ['PROPOSED', 'CREW CONFIRMED', 'RECHECKED', 'DONE'];
  function clockAt(ts, city) { try { return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: cityObj(city || S.city).tz }); } catch (e) { return ''; } }
  function stage(c) {
    if (c.status === 'off') return { k: 'off', i: -1, t: 'CALLED OFF' };
    if (c.past) return { k: 'done', i: 3, t: 'DONE' };
    var sure = c.going - (c.unsure || 0), conf = sure >= (c.min || 2), fresh = c.checked_at && Date.now() - Date.parse(c.checked_at) < 8 * 3600e3;
    if (c.captain_until) return { k: 'captain', i: conf ? 1 : 0, t: 'CAPTAIN NEEDED' };
    if (c.checked_ok === false && fresh) return { k: 'doubt', i: conf ? 1 : 0, t: 'CONDITIONS DOUBTFUL' };
    if (!conf) return { k: 'prop', i: 0, t: 'PROPOSED' };
    if (c.checked_ok && fresh) return { k: 'checked', i: 2, t: 'RECHECKED' };
    return { k: 'conf', i: 1, t: 'CREW CONFIRMED' };
  }
  function stageBar(c) {
    var g = stage(c), chk = c.checked_at ? 'Rechecked ' + clockAt(c.checked_at, c.city) + (c.checked_note ? ': ' + c.checked_note : '') : '';
    if (g.k === 'off') return '<div class="stg s-off"><b class="warn">CALLED OFF</b><span>' + esc(c.off_reason || 'The captain called it off') + '</span></div>';
    var need = Math.max(1, (c.min || 2) - (c.going - (c.unsure || 0)));
    var note = g.k === 'prop' ? (c.unsure ? c.unsure + ' unsure since it moved · ' : '') + 'Goes ahead with ' + (c.min || 2) + ': needs ' + need + ' more' :
      g.k === 'captain' ? (c.captain_left ? c.captain_left + ' stepped down. ' : '') + 'A new captain says yes by ' + clockAt(c.captain_until, c.city) + ', or it\'s called off' :
      g.k === 'doubt' ? chk + '. The captain can move it or call it off' :
      g.k === 'checked' ? chk :
      g.k === 'conf' ? (chk || 'The forecast is rechecked the day before and again on the day') : 'Done. How was it?';
    return '<div class="stg s-' + g.k + '"><ol>' + STAGES.map(function (t, i) { return '<li class="' + (i < g.i ? 'past' : i === g.i ? 'now' : '') + '">' + t + '</li>'; }).join('') + '</ol>' +
      (g.k === 'doubt' || g.k === 'captain' ? '<b class="warn">' + g.t + '</b>' : '') + '<span>' + esc(note) + '</span></div>';
  }
  function firstName(n) { return String(n || '').split(' ')[0]; }
  // P0-2 (2.31): one tap to the exact point. Google Maps directions (any phone, any browser), Apple Maps on iPhone and iPad
  // (unified Maps URL, iOS 18.4+), and the coordinates to copy into Waze or anything else. Coordinates win over names.
  var IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function navUrls(to) {
    var ll = to.lat != null && to.lon != null ? Number(to.lat).toFixed(5) + ',' + Number(to.lon).toFixed(5) : null, d = ll || String(to.q || '');
    return { google: 'https://www.google.com/maps/dir/?api=1&destination=' + encodeURIComponent(d), apple: 'https://maps.apple.com/directions?destination=' + encodeURIComponent(d) + '&mode=driving', ll: ll };
  }
  function navRow(label, to, what) {
    if (!to || (to.lat == null && !to.q)) return '';
    var u = navUrls(to);
    return '<div class="navr"><span class="pl-k">' + esc(label) + '</span><div class="row">' +
      '<a class="jn lm navl" data-nav="' + esc(what || 'other') + '" target="_blank" rel="noopener" href="' + esc(u.google) + '">GOOGLE MAPS</a>' +
      (IOS ? '<a class="jn wh navl" data-nav="' + esc(what || 'other') + '" target="_blank" rel="noopener" href="' + esc(u.apple) + '">APPLE MAPS</a>' : '') +
      (u.ll ? '<button class="jn wh" data-act="copy" data-text="' + esc(u.ll) + '" title="' + esc(u.ll) + '">COPY GPS</button>' : '') + '</div></div>';
  }
  // "Fri 14:00" (or "today 14:00") in the crew's own time zone
  function whenAt(iso, city) {
    var t = Date.parse(iso), tz = cityObj(city || S.city).tz;
    var d = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
    return dayRel(d) + ' ' + clockAt(t, city);
  }
  // where this rider goes first: the pick-up if they're in a car, else the captain's pin, else the spot
  function firstStop(c) {
    var hub = hubOf(c), spot = HI8.spot(c.spot) || {}, inCar = c.me && c.me.getting !== 'own';
    if (inCar && hub && hub.lat != null) return { label: 'PICK-UP', to: { lat: hub.lat, lon: hub.lon }, what: 'pickup' };
    if (c.meet_lat != null) return { label: 'THE PIN', to: { lat: c.meet_lat, lon: c.meet_lon }, what: 'pin' };
    return { label: 'THE SPOT', to: { q: c.maps || spot.maps || c.spot_name || spot.name }, what: 'spot' };
  }
  // the three lines that answer "what happens next": where we meet, how I get there, who's coming
  function planLines(c) {
    var me = c.me, M = c.members || [], hub = hubOf(c), drivers = M.filter(function (m) { return m.getting === 'drive'; }), spot = HI8.spot(c.spot) || {};
    var at = (hub ? title(hub.name) : 'the pick-up') + (c.meet_time ? ' at ' + hm(c.meet_time) : '');
    var pin = c.meet_lat != null ? c.meet_lat + ',' + c.meet_lon : spot.lat != null ? spot.lat + ',' + spot.lon : null;
    var L = [];
    L.push({ k: 'MEET', t: hub && c.meet_time ? title(hub.name) + ' · ' + hm(c.meet_time) : 'At ' + (c.spot_name || spot.name) + ' · ' + hm(c.start),
      s: (hub && c.meet_time ? 'Then ' + (c.spot_name || spot.name) + ' · ' : '') + (c.meet_lat != null ? 'exact pin from the captain' : c.meet_note || 'the captain can drop an exact pin'),
      a: null });
    if (me) {
      if (me.getting === 'drive') {
        var mine = M.filter(function (m) { return m.getting === 'seat' && (m.car_with === me.member_id || (!m.car_with && drivers.length === 1)); }), free = Math.max(0, (me.seats || 0) - mine.length);
        L.push({ k: 'YOU DRIVE', t: mine.length ? 'Picking up ' + mine.map(function (m) { return firstName(m.name); }).join(', ') : 'Nobody in your car yet', s: 'From ' + at + ' · ' + (free ? free + ' seat' + (free > 1 ? 's' : '') + ' free' : 'car full') });
      } else if (me.getting === 'seat') {
        var d = M.filter(function (m) { return m.member_id === me.car_with; })[0] || (drivers.length === 1 ? drivers[0] : null);
        L.push(d ? { k: 'YOUR LIFT', t: firstName(d.name) + ' drives', s: 'From ' + at } : { k: 'YOUR LIFT', t: 'No car yet', s: 'Pick a car on the crew page, or ask in the chat', warn: true });
      } else L.push({ k: 'YOU GO', t: 'Your own way', s: 'The crew meets at ' + (c.spot_name || spot.name) + ' at ' + hm(c.start) });
    } else if (c.seats_free) L.push({ k: 'SEATS', t: c.seats_free + ' free', s: 'From ' + at });
    L.push({ k: 'CREW', t: c.going + ' rider' + (c.going === 1 ? '' : 's') + (c.unsure ? ' · ' + c.unsure + ' unsure' : ''), s: (CREW_LEVELS[c.levels] || '') + ' · captain ' + (c.captain_until ? 'needed' : firstName(c.host)) });
    return '<div class="pl">' + L.map(function (x) {
      return '<div class="pl-r' + (x.warn ? ' warn' : '') + '"><span class="pl-k">' + x.k + '</span><span class="pl-v"><b>' + esc(x.t) + '</b><small>' + esc(x.s) + '</small></span>' +
        (x.a ? '<a class="pl-a" target="_blank" rel="noopener" href="' + esc(x.a) + '">MAP</a>' : '') + '</div>';
    }).join('') + (function () { var f1 = firstStop(c); return navRow(f1.label, f1.to, f1.what); })() + '</div>';
  }
  // P0-3 (2.31): what's missing, as plain facts, and the one thing to do next. Never a score, never "safe".
  function readiness(c) {
    if (!c || c.status !== 'on' || c.past) return null;
    var M = c.members || [], me = c.me, parts = [], todo = [], facts = { skip: [] }, min = c.min || 2, sure = c.going - (c.unsure || 0);
    parts.push(c.going + ' going' + (c.max ? ' of ' + c.max : ''));
    if (sure < min) { parts.push('needs ' + (min - sure) + ' more'); facts.skip.push(parts.length - 1); todo.push((min - sure) + ' more rider' + (min - sure === 1 ? '' : 's') + ' to go ahead'); }
    if (c.unsure) { parts.push(c.unsure + ' unsure'); facts.skip.push(parts.length - 1); todo.push(c.unsure + ' still to say if they\'re in'); }
    var stranded = [];
    if (me) {
      var uns = c.unsure_ids || [], drivers = M.filter(function (m) { return m.getting === 'drive' && uns.indexOf(m.member_id) < 0; }), seatCap = drivers.reduce(function (n, m) { return n + (m.seats || 0); }, 0);
      var riders = M.filter(function (m) { return m.getting === 'seat'; });
      // riders nobody has room for: the ones without a car, newest last
      stranded = riders.length > seatCap ? riders.filter(function (m) { return !m.car_with; }).slice(-(riders.length - seatCap)) : [];
      if (stranded.length) { parts.push(stranded.length + ' need' + (stranded.length === 1 ? 's' : '') + ' a lift'); facts.skip.push(parts.length - 1); todo.push(stranded.map(function (m) { return firstName(m.name); }).join(', ') + ' still need' + (stranded.length === 1 ? 's' : '') + ' a lift'); }
      else if (riders.length) parts.push('lifts sorted');
      parts.push(c.meet_lat != null ? 'pin set' : 'no exact pin yet');
      if (c.meet_lat == null) facts.skip.push(parts.length - 1);
      if (c.meet_lat == null) todo.push('Exact meeting pin: the captain drops it at the spot');
    } else if (c.seats_free) parts.push(c.seats_free + ' seat' + (c.seats_free === 1 ? '' : 's') + ' free');
    if (c.captain_until) { parts.push('captain needed'); facts.skip.push(parts.length - 1); todo.push('A captain: the crew is asked in turn'); }
    var soon = c.day <= FX.addDays(S.today, 1);
    parts.push(!soon ? 'forecast rechecked from ' + dayInLine(FX.addDays(c.day, -1)) : c.checked_at ? 'next recheck ' + clockAt(Date.parse(c.checked_at) + 3 * 3600e3, c.city) : 'recheck due soon');
    var code = esc(c.code), next = null;
    if (me && !me.unsure && !c.captain_ask) {
      var mine = stranded.filter(function (m) { return m.member_id === me.member_id; })[0];
      if (mine) next = { t: 'YOUR LIFT ISN\'T SORTED YET', s: 'Asking for a lift doesn\'t book a seat: a driver has to take you.', b: '<button class="jn lm" data-act="askdriver" data-code="' + code + '" data-who="me">ASK THE CREW FOR A LIFT</button>' };
      else if (cap(c) && stranded.length) next = { t: 'FIND ' + firstName(stranded[0].name).toUpperCase() + ' A SEAT', b: '<button class="jn lm" data-act="askdriver" data-code="' + code + '" data-who="' + esc(firstName(stranded[0].name)) + '">ASK THE CREW FOR A DRIVER</button>' };
      else if (cap(c) && c.meet_lat == null && soon) next = { t: 'DROP THE EXACT PIN', b: S.crew && S.crew.code === c.code ? '<button class="jn lm" data-act="pin">DROP THE PIN WHERE I AM</button>' : '<a class="jn lm" href="?c=' + code + '">OPEN THE CREW</a>', s: 'Do it at the beach entrance or the car park: your crew gets it in one tap.' };
      else if (cap(c) && sure < min) next = { t: 'FIND ' + (min - sure) + ' MORE', b: '<a class="jn lm" target="_blank" rel="noopener" href="https://wa.me/?text=' + encodeURIComponent(shareText(c)) + '" data-act="shared">SHARE TO WHATSAPP</a>' };
    }
    // UX review H13: what's open for YOU decides the headline; the crew's facts are a separate line
    var you = !me ? null : me.unsure ? 'ANSWER ABOVE: STILL IN?' : c.captain_ask ? 'ANSWER ABOVE: CAPTAIN?' : next ? 'NEXT FOR YOU: ' + next.t : 'YOU\'RE SET';
    return { line: parts.join(' · '), facts: parts.filter(function (x, i) { return facts.skip.indexOf(i) < 0; }).join(' · '), next: next, me: !!me, you: you, todo: todo };
  }
  function readyBox(c) {
    var r = readiness(c); if (!r || !r.me) return '';   // guests get the essentials box instead (H01/H02)
    return '<div class="rdy">' + '<b>' + esc(r.you) + '</b>' + (r.you === 'YOU\'RE SET' ? '<p class="rdy-s">Nothing to do for you right now.</p>' : '') +
      (r.next && r.next.s ? '<p class="rdy-s">' + esc(r.next.s) + '</p>' : '') + (r.next ? '<div class="row">' + r.next.b + '</div>' : '') +
      '<p class="rdy-l"><span>THE CREW</span> ' + esc(r.line.charAt(0).toUpperCase() + r.line.slice(1)) + '</p></div>';
  }
  // what the rider has to answer, if anything
  function planAsk(c) {
    if (!c.me || c.status !== 'on' || c.past) return '';
    var code = esc(c.code);
    if (c.me.unsure) return '<div class="pask"><b>MOVED TO ' + esc(dayRel(c.day).toUpperCase()) + ' · ' + esc(hm(c.start)) + '. STILL IN?</b><p>' + (c.prev_day ? 'It was ' + esc(dayRel(c.prev_day)) + ' · ' + esc(hm(c.prev_start)) + '. ' : '') + 'Say if you\'re still in, then update your calendar so it shows the new time.</p>' +
      (c.reconfirm_by ? '<p class="pwarn">⚠ Answer by <b>' + esc(whenAt(c.reconfirm_by, c.city)) + '</b>' + (c.me.getting === 'drive' ? ', or the seats in your car are released' : c.me.getting === 'seat' ? ', or your seat goes back to the crew' : '') + '.</p>' : '') + '<div class="row"><button class="jn lm" data-act="stillin" data-code="' + code + '" data-v="' + esc(c.plan_v || '') + '">STILL IN</button><button class="jn wh" data-act="cantmake" data-code="' + code + '">' + (S.cantArm === c.code ? 'TAP AGAIN: I\'M OUT' : 'CAN\'T MAKE IT') + '</button><button class="jn wh" data-act="ics" data-code="' + code + '">UPDATE MY CALENDAR</button></div></div>';
    if (c.captain_ask) return '<div class="pask"><b>' + esc(String(c.captain_left || 'The captain').toUpperCase()) + ' STEPPED DOWN. YOU\'RE NEXT IN LINE TO CAPTAIN.</b><p>Say yes and it stays on. Can\'t? It goes to the next rider.</p><div class="row"><button class="jn lm" data-act="captain" data-v="1" data-code="' + code + '">KEEP IT ON</button><button class="jn wh" data-act="captain" data-v="0" data-code="' + code + '">PASS IT ON</button></div></div>';
    if (c.captain_until) return '<div class="pask"><b>CAPTAIN NEEDED</b><p>' + esc(firstName(c.host)) + ' is asked first; anyone in the crew can take it.</p><div class="row"><button class="jn lm" data-act="captain" data-v="1" data-code="' + code + '">I\'LL CAPTAIN</button></div></div>';
    return '';
  }
  function nextCrew() {
    return ((HI8.mine && HI8.mine.crews) || []).filter(function (c) { return c.day >= S.today && !c.past && (c.status === 'on' || (c.status === 'off' && (HI8.store.get('offSeen', []) || []).indexOf(c.code) < 0)); })
      .sort(function (a, b) { return (a.day + a.start).localeCompare(b.day + b.start); })[0] || null;
  }
  function loadNext(code) {
    if (S.nextP === code) return; S.nextP = code;
    HI8.withKey('hi8_crew', { p_code: code }, { noQueue: true }).then(function (d) { S.nextP = null; S.next = { code: code, data: d, at: Date.now() }; drawNext(); }, function () { S.nextP = null; });
  }
  function drawNext() {
    var el = $('#next'); if (!el) return;
    var n = signedIn() ? nextCrew() : null;
    if (signedIn()) loadWeekend();
    // a session that needs you comes first; the weekend proposal only shows when nothing of yours is open (H14)
    var wk = n && n.status === 'on' ? '' : weekendHtml();
    if (!n && !wk) { el.hidden = true; el.innerHTML = ''; return; }
    var d = n && S.next && S.next.code === n.code ? S.next.data : null;
    if (n && (!d || Date.now() - S.next.at > 120000)) loadNext(n.code);
    el.hidden = false; el.innerHTML = (n ? nextHtml(d || n) : '') + wk;
  }
  // ---- SESSION PASS: the outing as a ticket, built only from what the app already knows (stage(), readiness(),
  // firstStop(), the rider's own row). No new state: when the crew data changes, the pass changes.
  function memberName(c, id) { var m = (c.members || []).filter(function (x) { return x.member_id === id; })[0]; return m ? firstName(m.name) : ''; }
  function passLegs(c) {
    var me = c.me || {}, hub = hubOf(c), spot = HI8.spot(c.spot) || {}, inCar = me.getting !== 'own' && hub && c.meet_time;
    var to = { k: c.meet_lat != null ? 'EXACT PIN' : 'THE SPOT · APPROXIMATE', n: c.spot_name || spot.name || c.spot, t: hm(c.start) + (c.end ? '–' + hm(c.end) : '') };
    var from = inCar ? { k: me.getting === 'drive' ? 'YOU PICK UP AT' : 'PICK-UP POINT', n: title(hub.name), t: hm(c.meet_time) } : { k: 'GETTING THERE', n: 'YOUR OWN WAY', t: '' };
    var seat = me.getting === 'drive' ? 'YOU DRIVE · ' + (me.seats || 0) : me.getting === 'own' ? 'OWN WAY' : me.car_with ? (memberName(c, me.car_with) || 'A').toUpperCase() + '\'S CAR' : 'NOT YET';
    return { from: from, to: to, seat: seat, seatOk: me.getting !== 'seat' || !!me.car_with, mins: hub && spot.lat != null && HI8.driveMin ? HI8.driveMin(hub, spot) : null };
  }
  function passLift(c) {
    var me = c.me || {}, L = passLegs(c), M = c.members || [];
    if (me.getting === 'seat' && me.car_with) {
      var also = M.filter(function (m) { return m.car_with === me.car_with && m.member_id !== me.member_id && m.member_id !== me.car_with; }).map(function (m) { return firstName(m.name); });
      return { t: 'YOUR LIFT IS CONFIRMED', s: (memberName(c, me.car_with) || 'A driver') + ' is driving you' + (also.length ? ', with ' + also.join(', ') : '') + '.' };
    }
    if (me.getting === 'drive') {
      var with_ = M.filter(function (m) { return m.car_with === me.member_id && m.member_id !== me.member_id; }).map(function (m) { return firstName(m.name); });
      var free = Math.max(0, (me.seats || 0) - with_.length);
      return { t: with_.length ? 'YOU\'RE DRIVING ' + with_.length : 'YOU\'RE DRIVING', s: (with_.length ? 'Picking up ' + with_.join(', ') + '. ' : 'Nobody in your car yet. ') + (free ? free + ' seat' + (free === 1 ? '' : 's') + ' still free.' : 'Your car is full.') };
    }
    if (me.getting === 'own') return { t: 'YOUR OWN WAY', s: 'Meet the crew at the spot for ' + hm(c.start) + '.' };
    return null;
  }
  function passNow(c) {
    var r = readiness(c) || {}, me = c.me || {}, L = passLegs(c), today = c.day === S.today, now = clockAt(Date.now(), c.city), first = L.from.t || hm(c.start);
    if (me.unsure || c.captain_ask) return { t: 'ANSWER ABOVE FIRST', s: '' };
    if (r.next) return { t: r.next.t, s: r.next.s || '', a: r.next.b };
    if (!today) return { t: 'ALL SET FOR ' + dayRel(c.day), s: L.from.t ? 'Be at ' + L.from.n + ' at ' + L.from.t + '.' : 'Be at the spot for ' + hm(c.start) + '.' };
    if (now < first) return { t: 'BE AT ' + (L.from.t ? 'THE PICK-UP' : 'THE SPOT') + ' BY ' + first, s: L.mins && L.from.t ? 'About ' + L.mins + ' min from there to the spot.' : '' };
    if (now < hm(c.start)) return { t: 'ON THE WAY', s: 'Riding from ' + hm(c.start) + '.' };
    return { t: 'RIDING UNTIL ' + (c.end ? hm(c.end) : 'LATE'), s: 'Afterwards: how was it? One tap on this page.' };
  }
  // the adventure timeline: the same facts, in the order the day happens
  function passSteps(c) {
    var g = stage(c), me = c.me || {}, L = passLegs(c), today = c.day === S.today, now = clockAt(Date.now(), c.city);
    var st = [
      { t: 'You\'re in', d: true },
      { t: g.i >= 1 ? 'Crew confirmed' : 'Crew confirmed at ' + (c.min || 2) + ' sure', d: g.i >= 1 },
      { t: me.getting === 'seat' ? (L.seatOk ? 'Seat in ' + L.seat.toLowerCase().replace(/^\w/, function (x) { return x.toUpperCase(); }) : 'Seat not sorted') : me.getting === 'drive' ? 'You drive' : 'Your own way', d: L.seatOk },
      { t: c.checked_at ? 'Forecast rechecked ' + clockAt(c.checked_at, c.city) + (c.checked_note ? ': ' + c.checked_note : '') : 'Forecast rechecked the day before', d: g.i >= 2 },
      { t: L.from.t ? (me.getting === 'drive' ? 'Pick up at ' : 'Pick-up ') + L.from.t + ' · ' + L.from.n : 'At the spot ' + hm(c.start), d: today && now >= (L.from.t || hm(c.start)) },
      { t: 'Ride ' + L.to.t, d: today && now >= hm(c.start) },
      { t: 'How was it?', d: false }];
    var cur = -1; st.forEach(function (x, i) { if (cur < 0 && !x.d) cur = i; });
    return '<ol class="tl" aria-label="Your day">' + st.map(function (x, i) { return '<li class="' + (x.d ? 'done' : i === cur ? 'now' : '') + '">' + (i === cur ? '<span class="sr">Now: </span>' : '') + esc(x.t) + '</li>'; }).join('') + '</ol>';
  }
  function lateRow(c) {
    var me = c.me, now = clockAt(Date.now(), c.city);
    if (!me || c.status !== 'on' || c.day !== S.today || c.ended || sessionEnded(c) || now > hm(c.start)) return '';
    return '<div class="pass-late" role="group" aria-label="Running late"><span>RUNNING LATE?</span>' + [5, 10, 20].map(function (n) { return '<button class="opt sm" data-act="late" data-code="' + esc(c.code) + '" data-min="' + n + '">' + n + ' MIN</button>'; }).join('') + '</div>';
  }
  function passHtml(c, o) {
    o = o || {};
    var g = stage(c), L = passLegs(c), n = passNow(c), f1 = firstStop(c), u = navUrls(f1.to), me = c.me || {}, r = readiness(c) || {};
    var set = !n.a && L.seatOk && !me.unsure && !c.captain_ask, lift = passLift(c);
    var where = f1.what === 'pickup' ? 'PICK-UP' : f1.what === 'pin' ? 'THE PIN' : 'THE SPOT';
    var gmap = '<a class="jn ' + (n.a ? 'wh' : 'lm lg') + ' navl" data-nav="' + esc(f1.what) + '" target="_blank" rel="noopener" href="' + esc(u.google) + '">GOOGLE MAPS' + (n.a ? '' : ' · ' + where) + '</a>';
    var tools = (n.a ? gmap : '') + (IOS ? '<a class="jn wh navl" data-nav="' + esc(f1.what) + '" target="_blank" rel="noopener" href="' + esc(u.apple) + '">APPLE MAPS</a>' : '') +
      (u.ll ? '<button class="jn wh" data-act="copy" data-text="' + esc(u.ll) + '">COPY GPS</button>' : '') +
      '<button class="jn wh" data-act="ics" data-code="' + esc(c.code) + '">CALENDAR</button>' +
      (o.compact ? '<a class="jn wh" href="?c=' + esc(c.code) + '">THE CREW ↗</a>' : '<button class="jn wh" data-act="tofx">CONDITIONS ↓</button><button class="jn wh" data-act="tochat">CHAT ↓</button>');
    return '<section class="pass' + (o.compact ? ' compact' : '') + (o.joined ? ' just-in' : '') + '" aria-label="Your session pass">' +
      '<div class="pass-top"><span>SESSION PASS · ' + esc(SPORT[c.sport].name.toUpperCase()) + '</span><span class="pass-stg s-' + g.k + '">' + esc(g.t) + '</span></div>' +
      '<div class="pass-route"><div class="leg"><small>' + esc(L.from.k) + '</small><b>' + esc(String(L.from.n).toUpperCase()) + '</b><em>' + esc(L.from.t || ' ') + '</em></div>' +
        '<div class="pass-arrow" aria-hidden="true"><i></i>' + (L.mins && L.from.t ? '<small>' + L.mins + ' MIN</small>' : '') + '</div>' +
        '<div class="leg to"><small>' + esc(L.to.k) + '</small><b>' + esc(String(L.to.n).toUpperCase()) + '</b><em>' + esc(L.to.t) + '</em></div></div>' +
      '<div class="pass-perf" aria-hidden="true"></div>' +
      '<dl class="pass-grid"><div><dt>DATE</dt><dd>' + esc(dayRel(c.day)) + '</dd></div><div><dt>' + (L.from.t ? 'BOARD' : 'START') + '</dt><dd>' + esc(L.from.t || hm(c.start)) + '</dd></div>' +
        '<div' + (L.seatOk ? '' : ' class="bad"') + '><dt>SEAT</dt><dd>' + esc(L.seat) + '</dd></div><div><dt>CREW</dt><dd>' + c.going + '/' + c.max + '</dd></div><div><dt>REF</dt><dd>' + esc(c.code) + '</dd></div></dl>' +
      '<div class="pass-perf" aria-hidden="true"></div>' +
      '<div class="pass-now" role="status">' + (o.joined ? '<span class="pass-stamp in" aria-hidden="true">YOU\'RE IN</span>' : set ? '<span class="pass-stamp ok" aria-hidden="true">ALL SET</span>' : '') +
        '<small>NOW</small><b>' + esc(n.t) + '</b>' + (n.s ? '<p>' + esc(n.s) + '</p>' : '') +
        (o.compact && c.checked_at ? '<p class="pass-chk">Rechecked ' + esc(clockAt(c.checked_at, c.city)) + (c.checked_note ? ': ' + esc(c.checked_note) : '') + '</p>' : '') +
        (o.plate ? '<p class="pass-chk">Founding plate #' + pad3(o.plate) + ' is yours.</p>' : '') + '</div>' +
      (lift && !me.unsure && !c.captain_ask ? '<div class="pass-lift"><b>' + esc(lift.t) + '</b><span>' + esc(lift.s) + '</span></div>' : '') +
      '<div class="pass-act">' + (n.a || gmap) + '</div><div class="pass-tools">' + tools + '</div>' + lateRow(c) +
      (!o.compact && r.todo && r.todo.length ? '<div class="pass-todo"><b>STILL TO SORT OUT</b><ul>' + r.todo.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>' : '') +
      (o.compact ? '' : passSteps(c) + (r.facts ? '<p class="pass-crew"><span>THE CREW</span> ' + esc(r.facts.charAt(0).toUpperCase() + r.facts.slice(1)) + '</p>' : '')) +
      '</section>';
  }
  // ---- PLAN B: after a call-off or a forecast that turned, the next good options (nothing is booked by showing them)
  function planB(c) {
    if (!FX.data[c.city]) return '';
    var spots = spotsFor(c.city, c.sport), here = spots.filter(function (s) { return s.slug === c.spot; });
    var good = function (d) { return d && !d.none && FX.tone(d.score) !== 'no' && FX.tone(d.score) !== 'none'; };
    var same = here.length ? FX.bestDays(c.city, here, c.sport, fxo(c.sport), 7).filter(function (d) { return good(d) && (d.date !== c.day || c.status === 'off'); })[0] : null;
    if (same && same.date === c.day && c.status !== 'off') same = null;
    var other = FX.bestDays(c.city, spots.filter(function (s) { return s.slug !== c.spot; }), c.sport, fxo(c.sport), 7).filter(function (d) { return good(d) && d.date === c.day; })[0];
    var opts = [], alt = null;
    LIVE_SPORTS.forEach(function (k) {
      if (alt || k === c.sport || !(lvSet(k) || myAlert(k) || ((HI8.mine && HI8.mine.crews) || []).some(function (x) { return x.sport === k; }))) return;
      alt = FX.bestDays(c.city, spotsFor(c.city, k), k, fxo(k), 7).filter(function (d) { return good(d) && d.date === c.day; })[0];
      if (alt) alt.sport = k;
    });
    if (same) opts.push('<button class="pb-o" data-act="planb" data-code="' + esc(c.code) + '" data-spot="' + esc(c.spot) + '" data-date="' + same.date + '" data-from="' + same.from + '" data-to="' + same.to + '"><small>SAME SPOT, NEXT GOOD WINDOW</small><b>' + esc(dayRel(same.date)) + ' ' + pad(same.from) + '–' + pad(same.to) + '</b><span>' + esc((windy(c.sport) ? same.w + ' kt ' + FX.compass(same.dir) + ' · ' : '') + same.label) + '</span></button>');
    if (other) opts.push('<button class="pb-o" data-act="planb" data-code="' + esc(c.code) + '" data-spot="' + esc(other.spot.slug) + '" data-date="' + other.date + '" data-from="' + other.from + '" data-to="' + other.to + '"><small>SAME DAY, ANOTHER SPOT</small><b>' + esc(String(other.spot.name).toUpperCase()) + ' ' + pad(other.from) + '–' + pad(other.to) + '</b><span>' + esc((windy(c.sport) ? other.w + ' kt ' + FX.compass(other.dir) + ' · ' : '') + other.label) + '</span></button>');
    if (alt) opts.push('<button class="pb-o" data-act="planb" data-code="' + esc(c.code) + '" data-sport="' + alt.sport + '" data-spot="' + esc(alt.spot.slug) + '" data-date="' + alt.date + '" data-from="' + alt.from + '" data-to="' + alt.to + '"><small>SAME DAY, ' + esc(SPORT[alt.sport].name.toUpperCase()) + ' INSTEAD</small><b>' + esc(String(alt.spot.name).toUpperCase()) + ' ' + pad(alt.from) + '–' + pad(alt.to) + '</b><span>' + esc((windy(alt.sport) ? alt.w + ' kt ' + FX.compass(alt.dir) + ' · ' : '') + alt.label) + '</span></button>');
    if (!opts.length) return '<div class="pb"><h4>PLAN B</h4><p class="hint" style="margin:0 0 8px">No good window in the next 7 days yet. Say you\'re up for a ride: you hear first when one shows up.</p><button class="jn lm" data-act="looking">I\'M UP FOR A RIDE</button></div>';
    return '<div class="pb"><h4>PLAN B</h4>' + opts.join('') + '<p class="hint">Starts a new crew with the same set-up. Everyone says yes again: nobody is moved over automatically.</p></div>';
  }
  // ---- SMART WEEKEND: for a crew you kept, the best window where most of you are up for a ride, ready to propose
  function weekendPick(q) {
    if (!FX.data[S.city] || q.city !== S.city) return null;
    var spots = spotsFor(S.city, q.sport), last = q.last || {}, pref = spots.filter(function (s) { return s.slug === last.spot; });
    var best = null, days = {};
    [pref, spots].forEach(function (list, pass) {
      if (best || !list.length) return;
      FX.bestDays(S.city, list, q.sport, fxo(q.sport), 7).forEach(function (d) {
        if (d.none || FX.tone(d.score) === 'no' || FX.tone(d.score) === 'none' || d.date < S.today) return;
        var up = (q.riders || []).filter(function (r) { return (r.up || []).indexOf(d.date) >= 0; });
        days[d.date] = { d: d, n: up.length };
        var k = up.length * 10 + d.score - pass;
        if (!best || k > best.k) best = { d: d, up: up, k: k };
      });
    });
    if (best) best.days = days;
    return best;
  }
  // WHEN ARE WE RIDING? who said they're up which day, against the good windows (4 days around the pick)
  function weekendGrid(q, b) {
    var R = (q.riders || []).filter(function (r) { return (r.up || []).length; }).slice(0, 6); if (R.length < 2) return '';
    var cand = Object.keys(b.days).sort(function (x, y) { return (b.days[y].n - b.days[x].n) || x.localeCompare(y); }).slice(0, 4);
    if (cand.indexOf(b.d.date) < 0) cand[cand.length - 1] = b.d.date;
    cand.sort();
    var dl = function (iso) { var t = new Date(iso + 'T12:00:00Z'); return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][t.getUTCDay()] + '<small>' + t.getUTCDate() + '</small>'; };
    return '<table class="wk-g"><caption>WHEN ARE WE RIDING?</caption><thead><tr><th scope="col"><span class="sr">Rider</span></th>' + cand.map(function (x) { return '<th scope="col"' + (x === b.d.date ? ' class="pick"' : '') + '>' + dl(x) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      R.map(function (r) { return '<tr><th scope="row">' + esc(r.me ? 'You' : firstName(r.name)) + '</th>' + cand.map(function (x) { var y = (r.up || []).indexOf(x) >= 0; return '<td' + (x === b.d.date ? ' class="pick"' : '') + '>' + (y ? '<i class="y" aria-label="up for it">✓</i>' : '<i class="n" aria-label="not said">·</i>') + '</td>'; }).join('') + '</tr>'; }).join('') +
      '<tr class="wk-gf"><th scope="row">' + (windy(q.sport) ? 'Wind kt' : 'Trails') + '</th>' + cand.map(function (x) { var d = b.days[x].d; return '<td' + (x === b.d.date ? ' class="pick"' : '') + '><span class="t-' + FX.tone(d.score) + '">' + (windy(q.sport) ? d.w : esc(String(d.label).split(' ')[0])) + '</span></td>'; }).join('') + '</tr></tbody></table>';
  }
  function weekendHtml() {
    var Q = (S.weekend || []).filter(function (q) { return !q.next; });
    for (var i = 0; i < Q.length; i++) {
      var q = Q[i], b = weekendPick(q); if (!b) continue;
      var d = b.d, last = q.last || {}, hub = last.hub ? hubBy(last.hub) : null, mins = hub && d.spot && HI8.driveMin ? HI8.driveMin(hub, d.spot) : null;
      var dow = new Date(d.date + 'T12:00:00Z').getUTCDay(), wkd = dow === 0 || dow === 6;
      var dep = last.meet || (mins ? pad(Math.max(5, d.from - 1)) + ':' + (mins > 45 ? '15' : '30') : null);
      var ini = b.up.slice(0, 6).map(function (r, k) { return '<span class="wk-a k' + (k % 4) + '" title="' + esc(r.name) + '">' + esc(String(r.name).charAt(0).toUpperCase()) + '</span>'; }).join('');
      return '<section class="wk" aria-label="A proposal for ' + esc(q.name) + '"><div class="wk-h art a-' + q.sport + '"><small>' + (wkd ? 'YOUR WEEKEND IS LOOKING GOOD.' : esc(dayRel(d.date)) + ' LOOKS GOOD.') + '</small>' +
        '<b>' + esc(dayRel(d.date)) + '.<br>' + esc(String(d.spot.name).toUpperCase()) + '.</b><p>The best match between the forecast and the days ' + esc(q.name) + ' said they\'re up for.</p>' +
        '<div class="wk-st"><div><b>' + (windy(q.sport) ? d.w + (d.g ? '–' + d.g : '') : esc(String(d.label))) + '</b><span>' + (windy(q.sport) ? 'WIND · KT' : 'CONDITIONS') + '</span></div><div><b>' + pad(d.from) + '–' + pad(d.to) + '</b><span>RIDE WINDOW</span></div>' +
        (mins ? '<div><b>' + mins + ' min</b><span>FROM ' + esc(String(hub.name).toUpperCase()) + '</span></div>' : '') + '</div></div>' +
        '<div class="wk-b"><h4>' + esc(q.name.toUpperCase()) + '</h4><div class="wk-up">' + ini + '<span>' + (b.up.length ? b.up.length + ' up for it' : 'Nobody has said yet') + '</span></div>' + weekendGrid(q, b) +
        '<ul class="wk-l"><li>' + (q.drivers ? q.drivers + ' drove before · seats not confirmed yet' : 'Nobody has driven for this crew yet') + '</li>' +
        (hub ? '<li>Your usual pick-up: ' + esc(title(hub.name)) + '</li>' : '') + (dep ? '<li>Suggested departure: ' + esc(dep) + '</li>' : '') + '</ul></div>' +
        '<button class="big join wk-go" data-act="propose" data-squad="' + esc(q.code) + '" data-spot="' + esc(d.spot.slug) + '" data-date="' + d.date + '" data-from="' + d.from + '" data-to="' + d.to + '">PROPOSE THIS SESSION ↗</button>' +
        '<p class="wk-f">You check the plan first. Nobody is in until they tap I\'M GOING themselves.</p></section>';
    }
    return '';
  }
  function loadWeekend() {
    if (!signedIn() || S.weekendP || (S.weekendAt && Date.now() - S.weekendAt < 600000)) return;
    S.weekendP = HI8.withKey('hi8_weekend', {}, { noQueue: true }).then(function (w) { S.weekend = w || []; S.weekendAt = Date.now(); S.weekendP = null; drawNext(); }, function () { S.weekendP = null; S.weekendAt = Date.now(); });
  }
  function nextHtml(c) {
    var g = stage(c), f = crewFx(c), spot = HI8.spot(c.spot) || {};
    if (g.k !== 'off' && c.members && c.me) return '<div class="nx-pass">' + planAsk(c) + passHtml(c, { compact: true }) + '</div>';
    var w = !f ? ['··', 'NO FORECAST YET'] : windy(c.sport) ? [Math.round(f.w) + '<small>KT</small>', 'WIND · ' + f.label] : [esc(String(f.ground || f.label).toUpperCase()), 'TRAILS · ' + f.temp + '°C'];
    var stats = '<div class="nx-st"><div><b>' + w[0] + '</b><span>' + esc(w[1]) + '</span></div><div><b>' + c.going + '<small>/' + c.max + '</small></b><span>RIDERS</span></div>' +
      '<div><b>' + esc(hm(c.meet_time || c.start)) + '</b><span>' + (c.meet_time ? 'MEET' : 'START') + '</span></div></div>';
    var alt = '';
    if (g.k === 'off') {
      var o = upcoming(c.sport, 7).filter(function (x) { return x.day === c.day && x.code !== c.code && x.status === 'on'; }).sort(byFit).slice(0, 2);
      alt = '<div class="nx-alt"><b>' + (o.length ? 'OTHER CREWS THAT DAY' : 'NO OTHER CREW THAT DAY YET') + '</b>' + o.map(function (x) {
        return '<a href="?c=' + esc(x.code) + '"><span>' + esc((HI8.spot(x.spot) || {}).name || x.spot_name) + ' · ' + esc(hm(x.start)) + '</span>' + whyFit(x, 'why') + '</a>'; }).join('') +
        (o.length ? '' : '<button class="jn lm" data-act="looking">I\'M UP FOR A RIDE</button>') + '<button class="jn wh" data-act="ics" data-code="' + esc(c.code) + '">UPDATE MY CALENDAR</button><button class="jn wh" data-act="offseen" data-code="' + esc(c.code) + '">GOT IT, HIDE THIS</button></div>' + planB(c);
    }
    return '<div class="nx s-' + g.k + '"><div class="nx-top"><span>YOUR NEXT SESSION</span><span class="nx-tag">' + esc(g.t) + '</span></div>' +
      '<div class="nx-b"><div class="nx-spot">' + esc(String(c.spot_name || spot.name || c.spot).toUpperCase()) + '</div>' +
      '<div class="nx-when">' + esc(dayRel(c.day).toUpperCase()) + ' · ' + esc(hm(c.start)) + (c.end ? '–' + esc(hm(c.end)) : '') + ' · ' + esc(SPORT[c.sport].name.toUpperCase()) + '</div>' +
      (g.k === 'off' ? stageBar(c) + alt : planAsk(c) + (c.members ? readyBox(c) : '') + stageBar(c) + stats + (c.members ? planLines(c) : '')) +
      '<a class="big join nx-go" href="?c=' + esc(c.code) + '">' + (g.k === 'off' ? 'SEE WHAT HAPPENED' : 'SESSION PLAN') + ' ↗</a></div></div>';
  }
  // P0-6 (2.31): anonymous first-party counts (a random id made in this browser; no key, email or IP), to measure
  // what makes real sessions happen. Never blocks anything; app_settings 'metrics' false stops it.
  function anonId() {
    var a = HI8.store.get('anon', null);
    if (!/^[a-z0-9]{8,32}$/.test(a || '')) { a = ''; for (var i = 0; i < 16; i++) a += 'abcdefghijklmnopqrstuvwxyz0123456789'.charAt(Math.floor(Math.random() * 36)); HI8.store.set('anon', a); }
    return a;
  }
  function track(name, code, extra) {
    if (!HI8.live || (S.settings && S.settings.metrics === false)) return;
    try { HI8.rpc('hi8_track', { p_name: name, p_anon: anonId(), p_crew: code || null, p_src: src().source || null, p_extra: extra || null }).catch(noop); } catch (e) { /* never in the way */ }
  }
  document.addEventListener('focusin', function (e) {
    var t = e.target; if (!t || !/INPUT|TEXTAREA|SELECT/.test(t.tagName) || !t.closest || !t.closest('.sh-body')) return;
    setTimeout(function () { var vv = window.visualViewport, r = t.getBoundingClientRect(), foot = document.querySelector('.sh-foot'), fh = foot ? foot.getBoundingClientRect().height : 0;
      var bottom = (vv ? vv.height + vv.offsetTop : window.innerHeight) - fh - 12; if (r.bottom > bottom || r.top < 60) t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 300);
  });
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest ? e.target.closest('.navl') : null;
    if (t) track('nav', (S.crew && S.crew.code) || (S.next && S.next.code) || null, t.getAttribute('data-nav'));
  }, true);
  // 2.31: a known email gets an emailed sign-in link, not a key
  function linkSent(email) {
    HI8.sendLink(email).catch(function () { toast("We couldn't send the sign-in link. Try again in a minute.", 5000); });   // hi8_join answered needs_link (no error), so send it here
    return { message: 'needs_link', hint: "Check your inbox: we sent a sign-in link to " + email + ". Open it on this phone to carry on; nothing is saved until you do." };
  }
  function keyOrLink(email) { return function (out) { if (out && out.needs_link) throw linkSent(email); HI8.saveMe(out); S.me = HI8.me(); drawTop(); return out; }; }
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
      whyFit(c, 'scwhy') + (function () { var u = suit(c); return u.k === 'go' ? '' : '<span class="scsuit s-' + u.k + '">' + (u.k === 'hazard' || u.k === 'doubt' ? '⚠ ' : '') + esc(u.t) + '</span>'; })() +
      '<span class="sc-f"><span class="sc-l"><span class="sc-w">' + esc(dayRel(c.day)) + ' ' + esc(hm(c.start)) + (key ? ' <em>' + esc(key) + '</em>' : '') + '</span>' +
      '<span class="sc-g">' + faces(c) + '<span>' + (c.min && !c.min_met ? '<span class="needs">NEEDS ' + (c.min - c.going) + ' MORE</span> ' : '') + c.going + ' going' + (free > 0 && free <= 3 ? ' · ' + free + ' left' : '') + (c.here ? ' · ' + c.here + ' there' : '') + '</span>' +
      (c.seats_free > 0 && seat ? '<span class="seat" title="A seat, fuel split four ways">' + CAR + '<b>' + money(seat.pay) + '</b></span>' : '') + '</span></span>' +
      '<span class="jn' + (inIt || free <= 0 || suitRank(c) >= 2 ? ' wh' : '') + '">' + (inIt ? "YOU'RE IN" : free <= 0 ? 'FULL' : suitRank(c) >= 2 ? 'SEE WHY' : 'JOIN NOW') + '</span></span></a>';
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
    b.innerHTML = (S.avatar ? '<img class="tbav" src="' + esc(HI8.avatarUrl(S.avatar)) + '" alt="" width="26" height="26">' : '') + esc(pl ? '#' + pad3(pl) : signedIn() ? 'ME' : 'SIGN IN');
    b.className = 'tbme' + (pl ? ' plate' : '') + (S.avatar ? ' hasav' : '');
    var live = (S.settings && S.settings.live_sports) || LIVE_SPORTS, soon = (S.settings && S.settings.soon_sports) || SOON;
    $('#sports').innerHTML = live.filter(function (k) { return SPORT[k]; }).map(function (k) {
      return '<button class="stile mini" data-act="sport" data-sport="' + k + '" aria-pressed="' + (k === S.sport) + '" aria-label="' + SPORT[k].name + '">' + tile(k, 20) + '<span>' + SPORT[k].name.toUpperCase() + '</span></button>';
    }).join('');
    var ssEl = $('#soonSports'); if (ssEl) ssEl.innerHTML = soon.filter(function (k) { return SPORT[k]; }).map(function (k) {
      return '<button class="stile mini soon" data-act="soon" data-sport="' + k + '" aria-label="' + SPORT[k].name + ', coming soon">' + tile(k, 20) + '<span>' + SPORT[k].name.toUpperCase() + '</span><i>SOON</i></button>';
    }).join('');
    var hm0 = home(); $('#ctxFrom').innerHTML = hm0 ? 'FROM <b>' + esc(hm0.name) + '</b> ▾' : '<b>WHERE FROM?</b> ▸';
    $('#ctxFrom').setAttribute('aria-label', hm0 ? 'Starting from ' + hm0.name + ': change' : 'Set where you start from');
    var anyCrew = upcoming(null, 14).length > 0;
    if (!myNext()) $('#heroKick').textContent = (anyCrew ? 'LIVE CREWS · ' : 'BE THE FIRST CREW · ') + live.map(function (k) { return (SPORT[k] || { name: k }).name.toUpperCase(); }).join(' · ') + ' · ' + regionName().toUpperCase();
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
    var near = h ? all.filter(isNear) : all, list = (near.length ? near : all).slice().sort(byFit);
    var note = h && !near.length && all.length ? 'None from near ' + esc(title(h.name)) + ' yet: here are the ' + all.length + ' in the ' + esc(regionName()) + '. Or start the first one from ' + esc(title(h.name)) + '.' : '';
    el.innerHTML = head(list.length, note) + '<div class="rail">' + (list.length ? list.slice(0, 8).map(crewCard).join('') + (list.length > 8 ? '<button class="nocrew more" data-act="join"><b>+' + (list.length - 8) + ' MORE</b><br>See them all →</button>' : '') : emptyCrews()) + '</div>' +
      (list.length ? '<div class="two2"><button class="hbtn" data-act="join">SEE ALL CREWS</button><button class="hbtn lime" data-act="start">START A CREW</button></div>' : '');
  }
  function emptyCrews() {
    var h = home(), best = FX.data[S.city] ? FX.bestDays(S.city, spotsFor(S.city, S.sport), S.sport, fxo(), 7).filter(function (d) { return !d.none && d.score >= 6; })[0] : null;
    return '<div class="nocrew"><b>No ' + esc(SPORT[S.sport].name) + ' crew yet: be the first</b><br>' +
      (best ? 'The best window this week is <b>' + esc(dayRel(best.date)) + ' ' + pad(best.from) + '–' + pad(best.to) + ' at ' + esc(best.spot.name) + '</b> (' + esc(best.label) + '). Start it and share it to your group chats: 20 seconds.' +
        '<br><button class="jn lm" data-act="startwin" data-date="' + best.date + '" data-from="' + best.from + '" data-to="' + best.to + '" data-spot="' + best.spot.slug + '" style="margin-top:12px">START THIS ONE</button> <button class="jn wh" data-act="start" style="margin-top:12px">ANOTHER TIME</button>'
        : 'Start the first one' + (h ? ' from ' + esc(title(h.name)) : '') + ': pick a window, a spot, share it to your group chats. 20 seconds.<br><button class="jn lm" data-act="start" style="margin-top:12px">START ONE</button>') + alertBox() + '</div>';
  }
  function alertBox() { return alertCta(); } // 2.23: the wind alert (your conditions) replaces "email me new crews" here; that one stays in Me
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

  var MODEL_CREDIT = { amsterdam: 'KNMI HARMONIE (2 km)', barcelona: 'Météo-France AROME (1.3 km)', berlin: 'DWD ICON-D2 (2 km)' };
  // THE WEEK AHEAD: every live sport x 7 days, at its best spot that day
  function drawWeek() {
    var el = $('#week'), live = ((S.settings && S.settings.live_sports) || LIVE_SPORTS).filter(function (k) { return LIVE_SPORTS.indexOf(k) >= 0; });
    var head = sec('THE WEEK AHEAD', 'THE GOOD-DAY METER · ' + esc((cityObj(S.city).name || '').toUpperCase()));
    if (!FX.data[S.city]) { el.innerHTML = head + '<div class="wk">' + (FX.error ? '<p class="wkn">No forecast right now: Open-Meteo can\'t be reached. Crews still work.</p>' : '<div class="skel" style="height:150px;background:#222"></div>') + '</div>'; return; }
    var dates = []; for (var i = 0; i < 7; i++) dates.push(FX.addDays(S.today, i));
    var rows = live.map(function (k) {
      var D = FX.bestDays(S.city, spotsFor(S.city, k), k, fxo(k), 7), top = Math.max.apply(null, D.map(function (d) { return d.none ? 0 : d.score; }));
      return '<span class="wl' + (k === S.sport ? ' on' : '') + '">' + tile(k, 20) + SPORT[k].name.toUpperCase() + '</span>' + D.map(function (d, i) {
        if (d.nodata) return '<span class="wc t-none">–</span>';
        var t = d.none ? 'no' : FX.tone(d.score), best = !d.none && d.score === top && d.score >= 6;
        var a = SPORT[k].name + ' ' + FX.dayName(d.date, S.today) + ': ' + (d.none ? 'no go' : d.label + ' ' + Math.round(d.score) + ' out of 10 at ' + d.spot.name + ', ' + pad(d.from) + ' to ' + pad(d.to));
        return '<button class="wc t-' + t + (best ? ' best' : '') + '" data-act="wkcell" data-sport="' + k + '" data-i="' + i + '" data-spot="' + (d.spot ? d.spot.slug : '') + '" aria-label="' + esc(a) + '">' +
          (d.none ? 'NO' : esc(d.label)) + '<small>' + (d.none ? '·' : (k === 'kite' ? d.w + 'KT' : Math.round(d.score))) + '</small></button>';
      }).join('');
    }).join('');
    el.innerHTML = head + '<div class="wk"><div class="wkg"><span></span>' + dates.map(function (d, i) { return '<span class="wkh' + (i === 0 ? ' td' : '') + '">' + (i === 0 ? 'TODAY' : FX.dayShort(d)) + '<small>' + Number(d.slice(8)) + '</small></span>'; }).join('') + rows + '</div>' +
      '<p class="wkn">Every sport, every day, at its best spot, rated hour by hour for ' + esc(levelWord()) + '. Outlined: the best day. Days 1-2 from ' + esc(MODEL_CREDIT[S.city] || 'the best available model') + ', then ECMWF, ICON and GFS. Tap a day for the hour-by-hour.</p></div>';
  }

  // THE BEST WINDOW for the chosen sport in the next 7 days, with the numbers behind it
  function drawBest() {
    var el = $('#best'), spots = spotsFor(S.city, S.sport);
    if (!FX.data[S.city]) { el.innerHTML = ''; return; }
    var days = FX.bestDays(S.city, spots, S.sport, fxo(), 7);
    var cand = days.filter(function (d) { return !d.none && d.score >= 4; }), top = Math.max.apply(null, cand.map(function (d) { return d.score; }).concat([0]));
    var good = cand.filter(function (d) { return d.score >= top - 0.7; })[0]; // the soonest one that's about as good as the best
    var head = sec('THE BEST WINDOW', esc(SPORT[S.sport].name.toUpperCase()) + ' · NEXT 7 DAYS');
    if (!good) {
      el.innerHTML = head + '<div class="card pad"><b class="t15">No good ' + esc(SPORT[S.sport].name) + ' window this week</b><p class="hint">' + (S.sport === 'kite' ? 'Not enough wind, or it blows offshore.' : 'Rain or mud on the way.') + ' You can still start a crew for any time.</p></div>';
      return;
    }
    var sp = fxSpot(good.spot.slug), info = FX.dayInfo(sp, good.date) || {}, m = good.models, kite = S.sport === 'kite';
    var stat = function (k, v, s) { return v == null || v === '' ? '' : '<div class="st"><span>' + k + '</span><b>' + v + '</b>' + (s ? '<small>' + s + '</small>' : '') + '</div>'; };
    var stats = kite ? [stat('WIND', good.w + ' KT', FX.compass(good.dir)), stat('GUSTS', good.g + ' KT', '+' + Math.max(0, good.g - good.w)), (good.kite ? (kgSet() ? '<button class="st st-kg" data-act="kg" aria-label="Your kite: ' + good.kite + ' metres for ' + kg() + ' kilos. Change your weight"><span>YOUR KITE</span><b>' + good.kite + ' M</b><small>' + kg() + ' KG · CHANGE</small></button>'
        : '<button class="st st-kg" data-act="kg" aria-label="Kite size about ' + kiteRange(good.w) + ' metres. Set your weight for yours"><span>KITE</span><b>' + kiteRange(good.w) + ' M</b><small>SET YOUR WEIGHT</small></button>') : ''),
      stat('WAVES', info.wave != null ? info.wave + ' M' : '', info.period ? info.period + ' S' : ''), stat('WATER', info.sst != null ? info.sst + '°C' : '', info.sst != null ? (info.sst < 15 ? '4/3 + boots' : info.sst < 18 ? '4/3 wetsuit' : info.sst < 21 ? '3/2 wetsuit' : 'shorty') : ''),
      stat('RAIN', info.pop != null ? info.pop + '%' : '', info.cloud != null ? 'cloud ' + info.cloud + '%' : '')]
      : [stat('GROUND', (good.ground || '').toUpperCase(), 'rain 24 h: ' + ((rowAt(good.spot.slug, good.date + 'T' + pad(good.from) + ':00') || {}).r24 || 0) + ' mm'), stat('TEMP', info.tmin != null ? (info.tmin === info.tmax ? info.tmax : info.tmin + '-' + info.tmax) + '°' : '', ''),
        stat('RAIN', info.pop != null ? info.pop + '%' : '', info.cloud != null ? 'cloud ' + info.cloud + '%' : ''), stat('WIND', info.w != null ? info.w + ' KT' : '', 'gusts ' + (info.g || '–'))];
    stats.push(stat('LIGHT', info.sunrise || '', info.sunset ? 'to ' + info.sunset : ''));
    stats.push(stat('MODELS', m ? m.n + ' OF ' + m.of : '', m ? m.label : ''));
    el.innerHTML = head + '<div class="bw"><div class="bw-t ht"><div class="kick" style="color:#C8FF3D">' + esc(FX.dayName(good.date, S.today)) + ' · ' + esc(dayLong(good.date)) + '</div>' +
      '<span class="stamp t-' + FX.tone(good.score) + '">' + esc(good.label) + '</span>' +
      '<div class="bw-v">' + pad(good.from) + ':00-' + pad(good.to) + ':00<br><span>' + esc(good.spot.name.toUpperCase()) + '</span></div>' +
      (good.runTo - good.runFrom > good.to - good.from ? '<div class="bw-s">' + (good.shore ? esc(title(good.shore)) + '. ' : '') + 'Rideable ' + pad(good.runFrom) + '–' + pad(good.runTo) + ', best ' + pad(good.from) + '–' + pad(good.to) + '. ' : '<div class="bw-s">' + (good.shore ? esc(title(good.shore)) + '. ' : '')) + esc((good.why || []).join(' · ')) + '</div>' + capChips(good.caps) + '</div>' +
      '<div class="bw-g">' + stats.join('') + '</div>' +
      '<div class="bw-src">' + SHIELD + '<span>' + esc(FX.sourceFor(S.city, good.date, S.today)) + (m ? ' · ' + (m.n === m.of ? 'ECMWF, ICON and GFS all agree' : m.n ? esc(m.names.join(' and ')) + ' agree' + (m.n === 1 ? 's' : '') + ', the others don\'t' : 'the other models disagree: check again') : '') + '.</span></div>' +
      '<div class="bw-b"><button class="jn pk lg" data-act="startwin" data-date="' + good.date + '" data-from="' + good.from + '" data-to="' + good.to + '" data-spot="' + good.spot.slug + '">START A CREW FOR IT</button>' +
      '<button class="hbtn" data-act="spotat" data-spot="' + good.spot.slug + '" data-date="' + good.date + '">HOURLY →</button></div></div>';
  }

  // the safety caps as chips: why a window isn't GOOD (or only OK)
  var CAP_TXT = { GUSTY: 'GUSTY', ONSHORE: 'ONSHORE', OFFSHORE: 'CROSS-OFF', COLD: 'COLD WATER', UNSURE: 'MODELS DISAGREE' };
  function capChips(caps) { return caps && caps.length ? '<div class="caps">' + caps.map(function (c) { return '<span class="cap">' + esc(CAP_TXT[c] || c) + '</span>'; }).join('') + '<span class="capn">capped for ' + esc(levelWord()) + '</span></div>' : ''; }
  // the kite size for light to heavy riders (65-95 kg), until the rider sets their own weight
  function kiteRange(w) { var a = FX.kiteSize(w, 65), b = FX.kiteSize(w, 95); return a && b && a !== b ? a + '–' + b : String(a || b || '–'); }
  // the level ratings are for: "a rider" until it's set
  var LEVEL_WORD = { rookie: 'a learner', regular: 'an independent rider', ripper: 'a ripper' };
  function levelWord(sport) { var l = lvSet(sport); return l ? LEVEL_WORD[l] || 'you' : 'an independent rider'; }

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
      '<div class="svs"><div><span>A DAY OUT</span><b>' + money(full.save) + '</b><small>saved, full car</small></div><div><span>20 DAYS OUT</span><b>' + money(Math.round(full.save * 100) / 100 * 20) + '</b><small>a season</small></div><div><span>DRIVING?</span><b>' + money(full.share * 3) + '</b><small>back from 3 riders</small></div></div>' +
      '<p class="svn">' + esc(title(hub.name)) + ' to ' + esc(spot.name) + ' and back: about ' + Math.round(HI8.km(hub, spot) * 2.6) + ' km, ' + money(cost) + ' of fuel. In a full car you pay ' + money(full.share) + (full.fee ? ' + ' + feeLine(full) : '') + '. Tolls and parking split the same way.</p>' +
      '<div class="feebox">' + SHIELD + '<span><b>How Hi8ctane stays free:</b> riders add ' + feePct() + '% to their share of the car (' + memberPct() + '% with the Hi8 Pass). The driver always gets the full share, no ads, nothing to install. <span class="mark">' + (feeLive() ? 'Paid in the app when you settle up.' : 'Free during the pilot.') + '</span></span></div></div>';
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
      near.forEach(function (x) { var sp = fxSpot(x.spot.slug); var w = sp ? FX.windows(sp, date, S.sport, x.spot, fxo())[0] : null; if (w && w.score >= 6) best.push(Object.assign({ spot: x.spot, min: x.min }, w)); });
      if (i === 0) best = best.filter(function (w) { return S.nowH * 60 + S.nowM + (w.min || 0) <= w.to * 60 - 90; }); // today: only if you'd still get 90 minutes
      best.sort(function (a, b) { return b.score - a.score || a.min - b.min; });
      best.slice(0, 2).forEach(function (w) { out.push({ date: date, from: w.from, to: w.to, spot: w.spot, min: w.min, fx: w, crews: [] }); });
    }
    crews.forEach(function (c) {
      var f0 = Number(hm(c.start).slice(0, 2)), hit = out.filter(function (o) { return o.date === c.day && o.spot.slug === c.spot && ((f0 < o.to && f0 + 3 > o.from) || Math.abs(f0 - o.from) <= 2); })[0];
      if (hit) hit.crews.push(c);
      else { var sp = HI8.spot(c.spot); if (sp) out.push({ date: c.day, from: f0, to: c.end ? Number(hm(c.end).slice(0, 2)) : f0 + 3, spot: sp, min: driveFromMe(sp), fx: crewFx(c), crews: [c] }); }
    });
    out.forEach(function (o) { o.crews.sort(byFit); });
    out.sort(function (a, b) { return (a.date + pad(a.from)).localeCompare(b.date + pad(b.from)) || b.crews.length - a.crews.length; });
    return out.slice(0, 8);
  }
  function hourBars(o) {
    var sp = fxSpot(o.spot.slug); if (!sp) return '';
    var rows = FX.dayRows(sp, o.date, S.sport, o.spot, fxo(), Math.max(6, o.from - 2), Math.min(21, o.to + 1));
    return '<span class="hb">' + rows.map(function (r) {
      var v = S.sport === 'kite' ? Math.min(1, (r.w || 0) / 30) : Math.min(1, (r.rate ? r.rate.s : 0) / 10), t = r.rate ? (r.rate.dark ? 'none' : FX.tone(r.rate.s)) : 'none', inw = r.h >= o.from && r.h < o.to;
      return '<i class="t-' + t + (inw ? ' in' : '') + '" style="height:' + Math.max(8, Math.round(v * 30)) + 'px" title="' + pad(r.h) + ':00' + (S.sport === 'kite' ? ' · ' + Math.round(r.w) + ' kt' : '') + '"></i>';
    }).join('') + '</span><span class="hbl"><span>' + pad(Math.max(6, o.from - 2)) + '</span><span>' + pad(Math.min(21, o.to + 1)) + '</span></span>';
  }
  // one session as a card (used for the sessions that already have a crew)
  function sessCard(o, i) {
      var f = o.fx, c = o.crews[0], kite = S.sport === 'kite';
      var key = f ? (kite ? f.w + ' KT ' + FX.compass(f.dir) + (f.g ? ' · G' + f.g : '') : (f.ground || '').toUpperCase() + (f.temp != null ? ' · ' + f.temp + '°C' : '')) : 'FORECAST SOON';
      var crewLine = c ? (function () { var hub = hubOf(c), cost = hub ? tripCost(hub, o.spot) : null, m = cost ? seatMath(cost, 4) : null, more = o.crews.length - 1;
        return '<span class="sg">' + faces(c) + '<span>' + (c.min && !c.min_met ? '<span class="needs">NEEDS ' + (c.min - c.going) + ' MORE</span> ' : '') + '<a class="sgl" href="?c=' + esc(c.code) + '" data-act="crew" data-code="' + esc(c.code) + '">' + esc(c.host) + '\'s crew</a> · ' + c.going + ' going' + (c.seats_free > 0 ? ' · ' + c.seats_free + ' seat' + (c.seats_free > 1 ? 's' : '') + (hub ? ' from ' + esc(title(hub.name)) : '') + (m ? ' ' + money(m.pay) : '') : '') + (more ? ' · +' + more + ' more' : '') + '</span></span>'; })()
        : '<span class="sg none">Nobody yet. ' + (watchN(o.spot.slug) ? watchN(o.spot.slug) + ' riders watch ' + esc(o.spot.name) + ': go first and they hear it.' : 'Go first: everyone near you sees it.') + '</span>';
      return '<div class="ss' + (c ? ' has' : '') + (i === 0 ? ' top' : '') + '">' +
        '<div class="ss-t"><span class="ss-d">' + esc(dayRel(o.date)) + ' <b>' + pad(o.from) + '–' + pad(o.to) + '</b></span>' + (f ? '<span class="vd t-' + FX.tone(f.score != null ? f.score : f.s) + '">' + esc(f.label) + '</span>' : '') + (c && c.live ? '<span class="vd t-live">LIVE</span>' : '') + '</div>' +
        '<button class="ss-n" data-act="spotat" data-spot="' + o.spot.slug + '" data-date="' + o.date + '">' + esc(o.spot.name.toUpperCase()) + ' <small>' + (o.min ? o.min + ' MIN' : '') + ' ›</small></button>' +
        '<div class="ss-m"><span class="ss-k">' + esc(key) + (f && f.kite && kite ? ' · ' + f.kite + ' M KITE' : '') + (f && f.models && f.models.label ? ' · ' + f.models.label : '') + '</span>' + hourBars(o) + '</div>' +
        (c ? whyFit(c, 'ss-why') : '') +
        (c ? (function () { var u = suit(c); return u.k === 'go' ? '' : '<span class="scsuit s-' + u.k + '">' + (u.k === 'hazard' || u.k === 'doubt' ? '⚠ ' : '') + esc(u.t) + '</span>'; })() : '') +
        '<div class="ss-f">' + crewLine + (c ? goOrWhy(c, 'lm')
          : '<button class="jn lm" data-act="startwin" data-date="' + o.date + '" data-from="' + o.from + '" data-to="' + o.to + '" data-spot="' + o.spot.slug + '">START IT</button>') + '</div></div>';
  }
  // UX review H07: a one-tap join only where the forecast fits; otherwise open the crew and say why
  function goOrWhy(c, cls) {
    return suitRank(c) >= 2 ? '<button class="jn wh" data-act="crew" data-code="' + esc(c.code) + '">SEE WHY</button>' : '<button class="jn ' + cls + '" data-act="going" data-code="' + esc(c.code) + '">I\'M GOING</button>';
  }
  function goBtn(o, cls) {
    var c = o.crews[0];
    return c ? goOrWhy(c, cls)
      : '<button class="jn ' + cls + '" data-act="startwin" data-date="' + o.date + '" data-from="' + o.from + '" data-to="' + o.to + '" data-spot="' + o.spot.slug + '" aria-label="Start a crew for ' + esc(o.spot.name + ', ' + dayRel(o.date) + ' ' + pad(o.from) + ' to ' + pad(o.to)) + '">START IT</button>';
  }
  function sessLine(o, now) {
    var f = o.fx, kite = S.sport === 'kite', going = o.crews.reduce(function (n, c) { return n + (c.going || 0); }, 0);
    return (now ? 'until ' + pad(o.to) + ':00' : dayRel(o.date) + ' ' + pad(o.from) + '–' + pad(o.to)) +
      (f ? ' · ' + (kite ? f.w + ' kt ' + FX.compass(f.dir) : (f.ground || '') + (f.temp != null ? ' ' + f.temp + '°C' : '')) + ' · ' + f.label : '') +
      ' · ' + (going ? going + ' going' : 'nobody yet' + (lookingOn(o.date) ? ' · ' + lookingOn(o.date).n + ' looking' : ''));
  }
  // THE CALL: go now, or go then. The first thing on the page.
  function drawVerdict(L) {
    var el = $('#verdict'); if (!el) return;
    var kick = '<div class="vk">' + esc(SPORT[S.sport].name.toUpperCase()) + ' · ' + (home() ? 'FROM ' + esc(home().name) : esc(regionName().toUpperCase())) + '</div>';
    if (!FX.data[S.city]) { el.innerHTML = kick + (FX.error ? '<div class="vbig">NO FORECAST</div><p class="vs">Open-Meteo can\'t be reached right now. Crews still work.</p>' : '<div class="skel" style="height:96px;opacity:.35"></div>'); return; }
    var nowMin = S.nowH * 60 + S.nowM, now = L.filter(function (o) { return o.fx && o.date === S.today && o.from * 60 - nowMin <= 120; })[0] || null;
    var rest = L.filter(function (o) { return o !== now && o.fx; }), first = now || rest[0], then = now ? rest[0] : rest[1];
    if (!first) { el.innerHTML = kick + '<div class="vbig no">NOT THIS WEEK</div><p class="vs">Nothing good for your level in the next 7 days. We\'ll email you the evening before the next good day.</p>'; return; }
    var big = now ? 'GO NOW' : 'GO ' + (first.date === S.today ? 'AT ' + pad(first.from) + ':00' : dayRel(first.date));
    el.innerHTML = kick + (now ? '' : '<div class="vnot">NOT RIGHT NOW</div>') + '<div class="vbig' + (now ? ' on' : '') + '">' + esc(big) + '</div>' +
      '<div class="vrow"><button class="vinfo" data-act="spotat" data-spot="' + first.spot.slug + '" data-date="' + first.date + '"><b>' + esc(first.spot.name.toUpperCase()) + (first.min ? ' <small>' + first.min + ' MIN</small>' : '') + '</b><span>' + esc(sessLine(first, !!now)) + '</span></button>' + goBtn(first, 'lm') + '</div>' +
      (then ? '<div class="vrow then"><button class="vinfo" data-act="spotat" data-spot="' + then.spot.slug + '" data-date="' + then.date + '"><b><i>THEN</i> ' + esc(then.spot.name.toUpperCase()) + '</b><span>' + esc(sessLine(then, false)) + '</span></button>' + goBtn(then, 'wh') + '</div>' : '');
  }
  // ALL SPOTS, THIS WEEK: every nearby spot against now and the next 7 days. A cell is the best hours of that day.
  function boardHtml(crews) {
    var kite = S.sport === 'kite', days = [], t = S.today + 'T' + pad(S.nowH) + ':00';
    for (var i = 0; i < 7; i++) days.push(FX.addDays(S.today, i));
    var head = '<div class="bd-r bd-h"><span class="bd-n">' + (kite ? 'KNOTS' : 'SCORE /10') + '</span><span class="bd-c now">NOW</span>' + days.map(function (d, i) { return '<span class="bd-c' + (i === 0 ? ' td' : '') + '">' + (i === 0 && S.nowH >= 9 ? 'LATER' : esc(FX.dayShort(d))) + '</span>'; }).join('') + '</div>';
    return '<div class="board" role="table" aria-label="All spots, this week">' + head + spotsNear().map(function (x) {
      var sp = x.spot, fs = fxSpot(sp.slug), r0 = rowAt(sp.slug, t), rt0 = r0 ? rateAt(sp, t) : null;
      var why0 = rt0 && (rt0.s < 6 || (rt0.caps && rt0.caps.length)) ? FX.reason(rt0) : '';
      var nowCell = '<button class="bd-c now t-' + (rt0 ? (rt0.dark ? 'none' : FX.tone(rt0.s)) : 'none') + '" data-act="spot" data-spot="' + sp.slug + '" aria-label="' + esc(sp.name + ' now: ' + (rt0 ? rt0.label : 'no forecast') + (why0 ? ', ' + why0.toLowerCase() : '')) + '"><span aria-hidden="true">' + (r0 && rt0 ? (kite ? Math.round(r0.w) : Math.round(rt0.s)) : '–') + (why0 ? '<em>' + esc(SHORT[why0] || why0.slice(0, 4)) + '</em>' : '') + '</span></button>';
      var wn = watchN(sp.slug);
      return '<div class="bd-r"><button class="bd-n' + (sp.name.length > 11 ? ' long' : '') + '" data-act="spot" data-spot="' + sp.slug + '">' + esc(sp.name.toUpperCase()) + (x.min || wn ? '<small>' + (x.min ? x.min + ' MIN' : '') + (wn ? (x.min ? ' · ' : '') + wn + ' WATCH' : '') + '</small>' : '') + '</button>' + nowCell + days.map(function (d, i) {
        var w = fs ? FX.windows(fs, d, S.sport, sp, fxo())[0] : null, val = '–', tone = 'none', lab = 'no forecast', why = '', late = false;
        if (i === 0 && w && S.nowH * 60 + S.nowM + (x.min || 0) > w.to * 60 - 90) { w = null; late = true; } // today: too late for it
        if (w) { val = kite ? Math.round(w.w) : Math.round(w.score); tone = FX.tone(w.score); why = w.caps && w.caps.length ? w.caps[0] : ''; lab = w.label + ' ' + pad(w.from) + '–' + pad(w.to) + (why ? ', ' + (CAP_TXT[why] || why).toLowerCase() : ''); }
        else if (late || (i === 0 && S.nowH >= 19)) { lab = 'too late today'; }
        else if (fs) { var best = null; FX.dayRows(fs, d, S.sport, sp, fxo(), i === 0 ? Math.max(9, S.nowH + 1) : 9, 19).forEach(function (r) { if (r.rate && !r.rate.dark && (!best || r.rate.s > best.rate.s)) best = r; }); if (best) { val = kite ? Math.round(best.w) : Math.round(best.rate.s); tone = 'no'; why = FX.reason(best.rate); lab = 'NO GO' + (why ? ', ' + why.toLowerCase() : '') + (kite ? ', best hour ' + Math.round(best.w) + ' knots' : ''); } }
        var c = crews.filter(function (q) { return q.day === d && q.spot === sp.slug; }).sort(function (a, b) { return (b.going || 0) - (a.going || 0); })[0];
        var act = c ? 'data-act="going" data-code="' + esc(c.code) + '"' : w && w.score >= 6 ? 'data-act="startwin" data-date="' + d + '" data-from="' + w.from + '" data-to="' + w.to + '" data-spot="' + sp.slug + '"' : 'data-act="spotat" data-spot="' + sp.slug + '" data-date="' + d + '"';
        return '<button class="bd-c t-' + tone + (c ? ' has' : '') + '" ' + act + ' aria-label="' + esc(sp.name + ' ' + dayRel(d) + ': ' + lab + (c ? ', ' + c.going + ' going' : '')) + '"><span aria-hidden="true">' + val + (why ? '<em>' + esc(SHORT[why] || why.slice(0, 4)) + '</em>' : '') + '</span>' + (c ? '<i aria-hidden="true">' + (c.going || 1) + '</i>' : '') + '</button>';
      }).join('') + '</div>';
    }).join('') + '</div><p class="bd-k"><span class="t-epic">EPIC</span><span class="t-good">GOOD</span><span class="t-ok">OK</span><span class="t-no">NO GO</span> for ' + esc(levelWord()) + ' <button class="lvb" data-act="level">' + (lvSet() ? 'CHANGE LEVEL' : 'SET YOUR LEVEL') + '</button> Small word = why. Tap a day to go. <i>3</i> = riders going.</p>';
  }
  var SHORT = { GUSTY: 'GUST', ONSHORE: 'ONSH', OFFSHORE: 'OFF', COLD: 'COLD', UNSURE: '?', 'TOO LIGHT': 'LITE', 'TOO STRONG': 'MAX', 'WRONG DIR': 'DIR', STORM: 'STRM', RAIN: 'RAIN', MUD: 'MUD', DARK: 'DARK', HOT: 'HOT', WET: 'WET' };
  function drawSessions() {
    var el = $('#sessions'); if (!el) return;
    var h = home(), L = sessions();
    drawVerdict(L); drawDock(L); drawNext();
    var head = '<div class="h2"><span class="pdot"></span>ALL SPOTS · THIS WEEK</div><div class="h2s">' + esc(SPORT[S.sport].name.toUpperCase()) + ' · ' + (h ? 'NEAREST TO ' + esc(h.name) + ' FIRST' : 'NEAREST FIRST') + '</div>';
    var foot = '<div class="two2"><button class="hbtn" data-act="join">ALL CREWS</button><button class="hbtn" data-act="start">START A CREW</button></div>';
    if (!FX.data[S.city]) { el.innerHTML = head + (FX.error ? '<div class="nocrew">No forecast right now: Open-Meteo can\'t be reached. You can still start or join a crew.</div>' : '<div class="skel" style="height:220px"></div>') + (L.length ? '<div class="sess">' + L.slice(0, 3).map(sessCard).join('') + '</div>' : '') + foot; return; }
    var withCrew = L.filter(function (o) { return o.crews.length; }).sort(function (a, b) { return byFit(a.crews[0], b.crews[0]); });
    el.innerHTML = head + boardHtml(upcoming(S.sport, 14)) +
      (withCrew.length ? '<div class="h2 sub"><span class="pdot"></span>CREWS GOING</div><div class="sess">' + withCrew.slice(0, 3).map(sessCard).join('') + '</div>' : '') + foot +
      lookBox() + '<div class="alertw">' + alertCta() + '</div>';
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
    refreshToday(); drawPass(); drawTop(); drawTime(); drawMapSpots(); drawSetup(); drawNow(); drawSessions(); drawCrews(); drawLive(); drawWeek(); drawBest(); drawSave(); drawPlans(); drawTowns(); drawWhere(); drawNight();
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
    if (S.opener && document.contains(S.opener)) { try { S.opener.focus({ preventScroll: true }); } catch (e) {} } S.opener = null; // keyboard: back where you were
  }
  function route() {
    var h = location.hash.replace(/^#/, ''), c = new URLSearchParams(location.search).get('c');
    if (c && h && h !== 'chat' && h !== 'rate') { // a sheet over a crew link: leave the crew page for it
      history.replaceState(null, '', location.pathname + location.hash); S.crew = null; stopChat(); c = null;
    }
    if (c) { if (!S.crew || S.crew.code !== c.toUpperCase()) { if (!S.linkTracked) { S.linkTracked = 1; track('link_open', c.toUpperCase()); } openCrew(c, h === 'chat'); if (h === 'rate') S.crew.rateGo = true; } return; }
    var sq = new URLSearchParams(location.search).get('s');
    if (sq && !h) { openSquad(sq); return; }
    if (h === 'join') { S.view = 'join'; }
    else if (h === 'start') {
      S.view = 'start';
      if (!S.sf) { // from a link: ?spot=…&sport=…#start
        var q = new URLSearchParams(location.search), sp = q.get('sport') || q.get('sp');
        if (sp && LIVE_SPORTS.indexOf(sp) >= 0 && sp !== S.sport) setSport(sp);
        newStart({ spot: q.get('spot') || null, sport: sp && LIVE_SPORTS.indexOf(sp) >= 0 ? sp : null });
      }
    }
    else if (h === 'me') { S.view = 'me'; if (signedIn()) { HI8.loadMine(true).then(renderSheet, noop); loadWallet(); loadAvatar(); loadSocial(); loadAlerts(); S.profP = null; loadProf(); loadMyAsks(); } }
    else if (h === 'city') { S.view = 'city'; }
    else if (/^spot\//.test(h)) { var sq2 = h.split('/'); S.view = 'spot'; S.spotSlug = sq2[1]; S.spotDay = S.spotDay || 0;
      if (/^\d{4}-\d\d-\d\d$/.test(sq2[2] || '')) { refreshToday(); S.spotDay = Math.max(0, Math.min(6, Math.round((dDate(sq2[2]) - dDate(S.today)) / 864e5))); history.replaceState(null, '', '#spot/' + sq2[1]); } }
    else if (/^alerts/.test(h)) { var ap = h.split('/'), asp = LIVE_SPORTS.indexOf(ap[1]) >= 0 ? ap[1] : null; S.view = 'alerts';
      if (!S.al || (asp && S.al.sport !== asp) || ap[2]) newAlert(asp || (S.al && S.al.sport) || S.sport, ap[2] || null); if (signedIn() && !S.walerts) loadAlerts(); }
    else if (h === 'push') { S.view = 'push'; if (!PUSH.checked) pushCheck().then(renderSheet); }
    else if (h === 'looking') { S.view = 'looking'; if (!S.lk) newLook(); loadAsks(S.lk.sport); }
    else if (h === 'card') { S.view = 'card'; S.cf = null; loadProf(); if (signedIn()) loadAvatar().then(function () { if (S.view === 'card') renderSheet(); }); }
    else if (/^soon\//.test(h)) { S.view = 'soon'; S.soonSport = h.slice(5); }
    else if (h === 'from') { S.view = 'from'; }
    else if (h === 'kg') { S.view = 'kg'; }
    else if (h === 'level') { S.view = 'level'; }
    else if (h === 'pass') { S.view = 'pass'; }
    else if (/^plan\//.test(h)) { S.view = 'plan'; if (!S.pf || S.pf.slug !== h.slice(5)) S.pf = { slug: h.slice(5), day: null, people: 1, busy: false, err: null }; }
    else { if (S.view) closeSheet(); return; }
    renderSheet();
  }
  function renderSheet() {
    if (!S.view) return;
    var fn = { join: sheetJoin, start: sheetStart, crew: sheetCrew, spot: sheetSpot, me: sheetMe, city: sheetCity, soon: sheetSoon, plan: sheetPlan, from: sheetFrom, kg: sheetKg, level: sheetLevel, pass: sheetPass, squad: sheetSquad, alerts: sheetAlerts, push: sheetPush, card: sheetCard, looking: sheetLooking }[S.view];
    if (!fn) return;
    var keep = sheet.querySelector('.sh-body'), top = keep ? keep.scrollTop : 0, focus = document.activeElement && document.activeElement.id;
    var vals = {}; sheet.querySelectorAll('input[id],textarea[id]').forEach(function (i) { vals[i.id] = i.value; });
    var opening = sheet.className.indexOf(' on') < 0;
    if (opening && document.activeElement && document.activeElement !== document.body) S.opener = document.activeElement;
    sheet.innerHTML = fn();
    sheet.className = 'sheet on';
    if (opening && !focus) { var x = sheet.querySelector('.x'); if (x) x.focus({ preventScroll: true }); }
    Object.keys(vals).forEach(function (id) { var i = document.getElementById(id); if (i && !i.hasAttribute('data-fixed') && i.value === '' && vals[id]) i.value = vals[id]; });
    var b = sheet.querySelector('.sh-body'); if (b) b.scrollTop = top;
    // a new error is scrolled into view, so it's never hidden behind the button at the bottom (2.24)
    var er = sheet.querySelector('.err[role=alert]'), et = er ? er.textContent : '';
    if (er && et !== S.errSeen && er.scrollIntoView) er.scrollIntoView({ block: 'center' });
    S.errSeen = et;
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
    var shown = (S.joinDay === 'all' ? list : list.filter(function (c) { return c.day === S.joinDay; })).slice().sort(function (a, b) { return suitRank(a) - suitRank(b) || byFit(a, b); });
    var tabs = '<div class="tabs" role="group" aria-label="Day"><button class="tab" data-act="joinday" data-day="all" aria-pressed="' + (S.joinDay === 'all') + '">ALL</button>' +
      dates.map(function (d) { return '<button class="tab" data-act="joinday" data-day="' + d + '" aria-pressed="' + (S.joinDay === d) + '">' + esc(dayRel(d)) + '</button>'; }).join('') + '</div>';
    var sp = '<div class="tabs" role="group" aria-label="Sport">' + LIVE_SPORTS.map(function (k) { return '<button class="tab" data-act="sport" data-sport="' + k + '" aria-pressed="' + (k === S.sport) + '">' + SPORT[k].name.toUpperCase() + '</button>'; }).join('') + '</div>';
    var body = sp + (list.length ? tabs + '<div class="sec"><div class="crews">' + shown.map(crewCard).join('') + '</div></div>' : '<div class="sec">' + emptyCrews() + '</div>');
    return shell('JOIN A CREW · ' + esc(cityObj(S.city).name), body + '<div class="sec">' + lookBox() + '</div>', list.length ? '<button class="big start" data-act="start">OR START ONE</button>' : '');
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
      var best = FX.data[S.city] ? FX.bestDays(S.city, spots, sport, fxo(sport)).filter(function (d) { return !d.none && d.score >= 6; })[0] : null;
      if (best) { f.date = best.date; f.from = best.from; f.to = best.to; if (!f.spot) f.spot = best.spot.slug; }
      else { f.custom = true; f.date = S.nowH >= 15 ? FX.addDays(S.today, 1) : S.today; f.from = sport === 'kite' ? 13 : 10; f.to = f.from + 3; if (f.date === S.today && f.from <= S.nowH) { f.date = FX.addDays(S.today, 1); } }
    }
    if (!f.spot || !spots.some(function (s) { return s.slug === f.spot; })) {
      var rank = FX.rankSpots(S.city, spots, sport, f.date, f.from, f.to, fxo(sport));
      f.spot = rank[0] ? rank[0].spot.slug : (spots[0] || {}).slug;
    }
    S.sf = f; autoMeet(); track('start_open');
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
    var spots = spotsFor(S.city, f.sport), days = FX.data[S.city] ? FX.bestDays(S.city, spots, f.sport, fxo(f.sport), 7) : [];
    var chips = days.filter(function (d, i) { return !d.none && (i < 3 || d.score >= 6 || (f.date === d.date && f.from === d.from)); }).slice(0, 5).map(function (d) {
      var on = !f.custom && f.date === d.date && f.from === d.from && f.to === d.to;
      return '<button class="opt" data-act="sfwin" data-date="' + d.date + '" data-from="' + d.from + '" data-to="' + d.to + '" aria-pressed="' + on + '">' + esc(dayRel(d.date)) + ' ' + pad(d.from) + '–' + pad(d.to) +
        '<small>' + (f.sport === 'kite' ? d.w + ' kt ' + FX.compass(d.dir) + ' · ' : esc(d.ground || '') + ' · ') + esc(d.label) + ' at ' + esc(d.spot.name) + '</small></button>';
    });
    chips.push('<button class="opt" data-act="sfcustom" aria-pressed="' + f.custom + '">OTHER TIME<small>any day, any hour</small></button>');
    var out = '<div class="row wins">' + chips.join('') + '</div>';
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
    var spots = spotsFor(S.city, f.sport), rank = FX.rankSpots(S.city, spots, f.sport, f.date, f.from, f.to, fxo(f.sport));
    var approved = HI8.mine && HI8.mine.captain, me = signedIn();
    var pSport = '<div class="f"><span class="lb">SPORT</span><div class="row">' + LIVE_SPORTS.map(function (k) { return '<button class="opt ic" data-act="sfsport" data-sport="' + k + '" aria-pressed="' + (f.sport === k) + '">' + tile(k, 22) + esc(SPORT[k].name.toUpperCase()) + '</button>'; }).join('') + '</div></div>' ;
    var lk = f.date ? lookingLine(f.date, f.sport) : '';
    var pWhen = '<div class="f"><span class="lb">WHEN <small>the best windows from the forecast</small></span>' + whenChips(f) +
      (lk ? '<p class="hint looking">' + esc(lk) + '. Start it and they hear it' + (f.getting === 'drive' ? ': your empty seats fill.' : '.') + '</p>'
        : (function () { var o = asksFor(f.sport).map(function (x) { var L = lookingOn(x.day, f.sport); return L ? title(dayRel(x.day)) + ' ' + L.n : ''; }).filter(Boolean);
            return o.length ? '<p class="hint looking">Riders looking: ' + esc(o.join(' · ')) + '. Pick that day and they hear about your crew.</p>' : ''; })()) + '</div>' ;
    var pWhere = '<div class="f"><span class="lb">WHERE <small>ranked for ' + esc(dayRel(f.date)) + ' ' + pad(f.from) + '–' + pad(f.to) + '</small></span><div class="row">' + rank.map(function (x) {
        var s = x.spot, fx = x.fx, hub = nearestHub(s);
        var sub = fx ? (f.sport === 'kite' ? fx.w + ' kt ' + FX.compass(fx.dir) + ', gusts ' + fx.g + (fx.shore ? ' · ' + fx.shore : '') : (fx.ground || '') + ' · ' + fx.temp + '°C') : 'no forecast that far yet';
        return '<button class="opt wide" data-act="sfspot" data-spot="' + s.slug + '" aria-pressed="' + (f.spot === s.slug) + '"><span>' + esc(s.name.toUpperCase()) + '<small>' + esc(sub) + (hub ? ' · ' + HI8.driveMin(hub, s) + ' min from ' + esc(title(hub.name)) : '') + '</small></span>' + (fx ? tag(fx) : '<span class="tag none">–</span>') + '</button>';
      }).join('') + '</div>' + (HI8.spot(f.spot) && HI8.spot(f.spot).note ? '<p class="hint">' + esc(HI8.spot(f.spot).note) + '</p>' : '') + '</div>' ;
    var pHow = '<div class="f"><span class="lb">' + (f.quick ? 'HOW ARE YOU GETTING THERE?' : 'HOW YOU GET THERE') + '</span><div class="row">' +
      (f.quick ? [['drive', "I'LL DRIVE", 'and fill my car'], ['seat', 'I NEED A SEAT', 'a driver picks me up'], ['own', 'MEET THERE', 'my own way']] : [['drive', "I'M DRIVING", 'others can ride with you'], ['own', 'OWN WAY', 'meet at the spot'], ['seat', 'I NEED A SEAT', 'a driver picks you up']]).map(function (o) {
        return '<button class="opt" data-act="sfget" data-v="' + o[0] + '" aria-pressed="' + (f.getting === o[0]) + '">' + o[1] + '<small>' + o[2] + '</small></button>';
      }).join('') + '</div>' + (f.err && f.errAt === 'how' ? '<div class="err" role="alert">' + f.err + '</div>' : '') +
      (f.getting === 'drive' ? '<div class="row" style="margin-top:10px;align-items:center"><span class="lb" style="margin:0 6px 0 0">FREE SEATS</span><span class="step"><button data-act="sfseats" data-d="-1" aria-label="Fewer seats">−</button><b>' + f.seats + '</b><button data-act="sfseats" data-d="1" aria-label="More seats">+</button></span></div>' +
        (function () { var hb = hubBy(f.hub), sp = HI8.spot(f.spot), cost = tripCost(hb, sp); if (!cost) return ''; var m = seatMath(cost, f.seats + 1);
          return '<p class="hint money">Fill it and ' + f.seats + ' rider' + (f.seats > 1 ? 's' : '') + ' pay you back <b>' + money(m.share * f.seats) + '</b> of the ' + money(cost) + ' fuel: ' + money(m.share) + ' each. Your drive costs you ' + money(m.share) + ' instead of ' + money(cost) + '.</p>'; })() : '') +
      (f.getting === 'seat' ? (function () { var hb = hubBy(f.hub), sp = HI8.spot(f.spot), cost = tripCost(hb, sp); if (!cost) return ''; var m = seatMath(cost, 4);
          return '<p class="hint money">A seat in a full car: about <b>' + money(m.share) + '</b> instead of ' + money(cost) + ' driving alone. ' + feeLine(m) + '.</p>'; })() : '') +
      (f.getting && f.getting !== 'own' ? '<div style="margin-top:12px"><span class="lb">' + (f.getting === 'drive' ? 'PICK UP AT' : 'MEET AT') + '</span><div class="row">' + startHubs().filter(function (h, i) { return i < 6 || h.slug === f.hub; }).map(function (h) {
        return '<button class="opt" data-act="sfhub" data-hub="' + h.slug + '" aria-pressed="' + (f.hub === h.slug) + '">' + esc(h.name) + '<small>' + esc(h.sub || '') + (home() && h.slug !== '__home' ? ' · ' + Math.round(HI8.km(h, home())) + ' km from you' : '') + '</small></button>';
      }).join('') + '<button class="opt" data-act="from">' + (home() ? 'SOMEWHERE ELSE' : 'FROM MY TOWN') + '<small>' + (home() ? 'change where you start' : 'add where you start') + '</small></button></div><div class="two" style="margin-top:10px;align-items:center"><label class="lb" for="sfMeet" style="margin:0">LEAVING AT</label><input class="inp" id="sfMeet" data-fixed type="time" step="300" value="' + esc(f.meet || '') + '" data-change="sfmeet"></div>' +
        '<p class="hint">Set from the drive time. Change it if you like.</p></div>' : '') + '</div>' ;
    var pLevels = '<div class="f"><span class="lb">WHO CAN JOIN</span><div class="row">' + (approved ? [['regular', 'INDEPENDENT', 'riders who launch and ride on their own'], ['all', 'ALL LEVELS', 'rookies welcome, you look after them'], ['rookie', 'ROOKIE SESSION', 'for learners']] : [['regular', 'INDEPENDENT RIDERS', 'everyone launches and rides on their own']]).map(function (o) {
        return '<button class="opt" data-act="sflevels" data-v="' + o[0] + '" aria-pressed="' + (f.levels === o[0]) + '">' + o[1] + '<small>' + o[2] + '</small></button>';
      }).join('') + '</div>' + (approved ? '' : '<p class="hint">Crews with rookies are run by our captains.</p>') + '</div>' ;
    var pNote = '<div class="f"><label for="sfNote">NOTE <small style="font-weight:400;letter-spacing:0;text-transform:none;color:var(--mute)">optional</small></label><textarea class="inp" id="sfNote" maxlength="280" placeholder="' + esc({ kite: 'Launching at the north end. Bring a 9.', mtb: 'Loop of about 30 km, 800 m up. Lights for the way back.', mx: 'Open practice. Bring your licence or buy day insurance.' }[f.sport]) + '"></textarea></div>' ;
    var pYou = (me ? '' : '<div class="f"><span class="lb">YOU <small>so your crew can reach you</small></span><div style="display:grid;gap:8px">' +
        '<label class="sr" for="sfEmail">Email</label><input class="inp" id="sfEmail" type="email" inputmode="email" autocomplete="email" placeholder="Email (only the app sees it)">' +
        '<label class="sr" for="sfName">Rider name</label><input class="inp" id="sfName" autocomplete="nickname" maxlength="40" placeholder="Rider name (what the crew sees)"></div>' +
        '<span class="lb" style="margin-top:12px">YOUR LEVEL</span><div class="row">' + ['regular', 'ripper'].map(function (l) { return '<button class="opt" data-act="sflevel" data-v="' + l + '" aria-pressed="' + (f.level === l) + '">' + LEVEL[l] + '<small>' + LEVEL_SUB[l] + '</small></button>'; }).join('') + '</div></div>') ;
    var cl = !f.force && !f.clashOk && !f.dup ? clash(f.sport, f.spot, f.date, f.from) : null;
    var pClash = cl ? '<div class="warn" id="clash"><b>A crew is already going:</b> ' + esc(cl.host) + '\'s crew, ' + esc(cl.spot_name) + ' ' + esc(dayRel(cl.day)) + ' ' + esc(hm(cl.start)) + (cl.end ? '–' + esc(hm(cl.end)) : '') + ' · ' + cl.going + ' going. Ride with them: one crew is safer than two.' +
      '<div class="row"><button class="opt pick" data-act="going" data-code="' + esc(cl.code) + '">JOIN IT</button><button class="opt" data-act="sfclashok">START ANOTHER</button></div></div>' : '';
    var pTail = (f.dup ? '<div class="warn" id="dup"><b>Already up:</b> ' + esc(String(f.dup.hint || '').replace(/^There's already a crew for that: /, '')) + '<div class="row"><button class="opt" data-act="crew" data-code="' + esc(f.dup.code) + '">JOIN IT</button><button class="opt" data-act="sfforce">POST MINE ANYWAY</button></div></div>' : '') +
      (f.err && f.errAt !== 'how' ? '<div class="err" role="alert">' + f.err + '</div>' : '') +
      '<p class="note">By posting you agree to the <a href="terms/">terms</a>: every session is each rider\'s own call. The spot\'s rules apply.</p>';
    var body;
    if (f.quick) {
      var qs = HI8.spot(f.spot), q0 = rank.filter(function (x) { return x.spot.slug === f.spot; })[0], qf = q0 && q0.fx, qk = qf && f.sport === 'kite' && FX.kiteSize ? FX.kiteSize(qf.w, kg()) : null;
      var pTop = '<div class="f"><div class="qsum"><div class="qs-k">' + tile(f.sport, 18) + esc(SPORT[f.sport].name.toUpperCase()) + ' · ' + esc(dayRel(f.date)) + ' ' + pad(f.from) + '–' + pad(f.to) + '</div>' +
        '<div class="qs-n">' + esc(qs ? qs.name.toUpperCase() : '') + (qf ? tag(qf) : '') + '</div>' +
        (qf ? '<div class="qs-m">' + esc(f.sport === 'kite' ? qf.w + ' kt ' + FX.compass(qf.dir) + ', gusts ' + qf.g + (qk ? (kgSet() ? ' · your kite: ' + qk + ' m' : ' · kite ' + kiteRange(qf.w) + ' m') : '') : (qf.ground || '') + ' · ' + qf.temp + '°C') + '</div>' : '') +
        (qs && qs.note ? '<p class="hint">' + esc(qs.note) + '</p>' : '') +
        '<button class="lnk" data-act="sffull">CHANGE THE DAY, TIME OR SPOT</button></div></div>';
      var wn = watchN(f.spot), pMin = '<div class="f"><span class="lb">IT GOES AHEAD <small>' + (wn ? wn + ' riders watch ' + esc(qs ? qs.name : 'this spot') + ': they hear about it' : 'everyone near you sees it') + '</small></span><div class="row">' +
        [[0, 'EITHER WAY', 'I\'m going anyway'], [2, 'IF 1 MORE', 'only with a buddy'], [3, 'IF 2 MORE', 'only as a crew of 3']].map(function (o) { return '<button class="opt" data-act="sfmin" data-v="' + o[0] + '" aria-pressed="' + ((f.min || 0) === o[0]) + '">' + o[1] + '<small>' + o[2] + '</small></button>'; }).join('') + '</div>' +
        (f.min ? '<p class="hint">It shows as NEEDS ' + (f.min - 1) + ' MORE. The moment ' + f.min + ' are in, everyone hears it\'s on.</p>' : '') + '</div>';
      body = pClash + pTop + pYou + pHow + pMin + (approved ? pLevels : '') + (f.noteOpen ? pNote : '<div class="f"><button class="lnk" data-act="sfnote">+ ADD A NOTE FOR THE CREW</button></div>') + pTail;
    } else body = pYou + pSport + pWhen + pWhere + pClash + pHow + pLevels + pNote + pTail;
    return shell(f.quick ? 'START THIS CREW' : 'START A CREW', body, '<button class="big start' + (f.quick ? ' go' : '') + '" data-act="sfpost"' + (f.busy ? ' disabled' : '') + '>' + (f.busy ? '<span class="spin"></span>' : f.quick ? 'POST IT · I\'M GOING' : 'POST THE CREW') + '</button>');
  }
  function crewUrl(code) { return location.origin + location.pathname.replace(/[^/]*$/, '') + '?c=' + code; }
  function shareText(c) {
    var f = crewFx(c), hub = c.meet_hub ? (HI8.hubsOf(c.city).filter(function (h) { return h.slug === c.meet_hub; })[0] || {}).name : null;
    var L = [SPORT[c.sport].em + ' ' + SPORT[c.sport].name.toUpperCase() + ' CREW · ' + dayLong(c.day) + ' ' + hm(c.start) + (c.end ? '–' + hm(c.end) : ''), '📍 ' + c.spot_name];
    if (f) L.push(c.sport === 'kite' ? '🌬️ ' + f.w + ' kt ' + FX.compass(f.dir) + ', gusts ' + f.g + ' · ' + f.label : '🌤️ ' + (f.ground ? f.ground + ' · ' : '') + f.temp + '°C · ' + f.label);
    if (c.seats_free > 0) L.push('🚗 ' + c.seats_free + ' seat' + (c.seats_free > 1 ? 's' : '') + ' free' + (hub ? ' from ' + title(hub) : '') + (c.meet_time ? ' at ' + hm(c.meet_time) : ''));
    L.push('👥 ' + c.going + '/' + c.max + ' going · ' + (CREW_LEVELS[c.levels] || '').toLowerCase());
    L.push('Join in one tap: ' + crewUrl(c.code));
    return L.join('\n');
  }
  function startDone(c) {
    var txt = shareText(c);
    var tell = (S.squads || []).filter(function (q) { return q.sport === c.sport; }).map(function (q) {
      var done = S.told && S.told[q.code + ':' + c.code];
      return '<button class="big ' + (done ? 'ghost' : 'start') + '" data-act="sqcall" data-squad="' + esc(q.code) + '" data-code="' + esc(c.code) + '"' + (done ? ' disabled' : '') + '>' + (done ? 'TOLD ' + esc(q.name.toUpperCase()) + ' ✓' : 'TELL ' + esc(q.name.toUpperCase()) + '<small style="display:block;font:700 10.5px var(--mono)">' + (q.size - 1) + ' RIDERS GET AN EMAIL</small>') + '</button>';
    }).join('');
    return shell('YOUR CREW IS UP', (tell ? '<div class="f"><span class="lb">YOUR CREWS</span><div style="display:grid;gap:8px">' + tell + '</div></div>' : '') + '<div class="ok-box"><b>' + esc(SPORT[c.sport].em + ' ' + c.spot_name.toUpperCase() + ' · ' + dayRel(c.day) + ' ' + hm(c.start)) + '</b><br>' + (c.min && !c.min_met ? 'It goes ahead with ' + c.min + ': it needs ' + (c.min - (c.going || 1)) + ' more. ' : '') + 'Now get people in: share it to your group chats. They join in one tap, no app to install.</div>' +
      (S.prof && !cardMade() ? '<div class="cardnudge"><span><b>Riders see your card before they join.</b> Yours is empty: make it so they see who they\'d ride with.</span><button class="big start" data-act="mycard">MAKE MY CARD · 1 MIN</button></div>' : '') +
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
      C.data = d; C.err = null; loadNotes(d.city);
      var ji = HI8.store.get('joinIntent', null);
      if (ji && ji.code === C.code && signedIn() && !d.me && d.status === 'on' && !d.past && Date.now() - ji.at < 864e5 && !S.jf) {
        HI8.store.del('joinIntent'); S.jf = { level: ji.level, getting: ji.getting, seats: ji.seats || 3, err: null, busy: false, back: true };
      }
      if (S.autoJoin === C.code) { S.autoJoin = null; if (!d.me && d.status === 'on' && !d.past) { S.jf = null; setTimeout(function () { quickJoin(d); }, 0); } }
      document.title = SPORT[d.sport].name + ' crew · ' + d.spot_name + ' · ' + dayRel(d.day) + ' ' + hm(d.start);
      if (d.city !== S.city) { S.city = d.city; drawAll(); initMap(); loadForecast(); }
      if (!C.cards || Date.now() - (C.cardsAt || 0) > 120000 || (C.cards.length !== d.going)) loadCards();
      if (d.me) { startChat(); if (!S.wallet) loadWallet(); loadPlan(); if (!C.people) loadPeople(); if (!S.card) HI8.withKey('hi8_card', {}, { noQueue: true }).then(function (cd) { S.card = cd; }, noop); }
      renderSheet();
      if (C.chat && d.me) setTimeout(function () { var el = $('#chatBox'); if (el) el.scrollIntoView({ block: 'center' }); }, 60);
      if (C.rateGo && d.me) { C.rateGo = false; setTimeout(function () { var el = $('#rateBox'); if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' }); }, 80); }
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
      (c.sport === 'kite' ? '<span class="tag">' + f.w + ' KT ' + FX.compass(f.dir) + '</span><span class="tag">GUSTS ' + f.g + '</span>' + (f.shore ? '<span class="tag">' + esc(f.shore.toUpperCase()) + '</span>' : '') + (f.kite ? '<span class="tag">' + (kgSet() ? f.kite + ' M KITE FOR ' + kg() + ' KG' : kiteRange(f.w) + ' M KITE') + '</span>' : '')
        : '<span class="tag">' + esc((f.ground || '').toUpperCase()) + '</span><span class="tag">' + f.temp + '°C</span>') +
      (f.check ? '<span class="tag">MODELS ' + f.check.n + ' OF ' + f.check.of + ' · ' + esc(f.check.label) + '</span>' : '') + (f.caps || []).filter(function (x) { return x !== 'UNSURE'; }).map(function (x) { return '<span class="tag ok">' + esc(CAP_TXT[x] || x) + '</span>'; }).join('') + '</div>' +
      (f.why && f.why.length ? '<p class="hint" style="padding:0 16px">' + esc(f.why.join(' · ')) + '</p>' : '');
  }
  function membersHtml(c) {
    var M = c.members || [], cars = M.filter(function (m) { return m.getting === 'drive'; });
    var hubName = c.meet_hub ? (HI8.hubsOf(c.city).filter(function (h) { return h.slug === c.meet_hub; })[0] || {}).name : null;
    var who = '<div class="who">' + M.map(function (m) {
      var how = m.getting === 'drive' ? 'drives · ' + m.seats + ' seat' + (m.seats === 1 ? '' : 's') : m.getting === 'seat' ? (m.car_with ? 'rides with ' + esc((M.filter(function (x) { return x.member_id === m.car_with; })[0] || {}).name || 'a driver') : 'needs a seat') : 'own way';
      var pp = personOf(m), started = c.past || c.live || (c.day === S.today && S.nowH * 60 + S.nowM >= minutes(c.start));
      var pf = pp ? [pp.years != null ? pp.years + (pp.years === 1 ? ' YR' : ' YRS') + ' RIDING' : '', pp.home_spot_name ? 'HOME ' + pp.home_spot_name.toUpperCase() : '', (pp.rode || 0) + ' SESSION' + (pp.rode === 1 ? '' : 'S'),
        pp.no_shows ? pp.no_shows + ' NO-SHOW' + (pp.no_shows > 1 ? 'S' : '') : ''].filter(Boolean).join(' · ') : '';
      var tel = pp && pp.phone && !m.me ? '<a href="tel:' + esc(pp.phone) + '">CALL</a> · <a target="_blank" rel="noopener" href="https://wa.me/' + esc(pp.phone.replace('+', '')) + '">WHATSAPP</a>' : '';
      return '<div class="p"><span class="av' + (m.here ? ' here' : '') + (m.avatar ? ' img' : '') + '">' + (m.avatar ? '<img src="' + esc(HI8.avatarUrl(m.avatar)) + '" alt="" width="44" height="44" loading="lazy">' : esc(String(m.name).slice(0, 2).toUpperCase())) + '</span><span><b>' + esc(m.name) + '</b>' + (m.host ? ' · captain' : '') + (m.me ? ' · you' : '') + '<br><span style="color:var(--mute)">' + esc(LEVEL[m.level] || '') + (m.here ? ' · at the spot' : '') + '</span>' +
        (pf || tel || (pp && pp.insta) ? '<span class="pf">' + esc(pf) + (pp && pp.insta ? (pf ? ' · ' : '') + '<a target="_blank" rel="noopener" href="https://instagram.com/' + esc(pp.insta) + '">@' + esc(pp.insta) + '</a>' : '') + (tel ? (pf || (pp && pp.insta) ? ' · ' : '') + tel : '') + '</span>' : '') +
        (cap(c) && !m.me && started && pp ? '<button class="ns" data-act="noshow" data-member="' + esc(m.member_id) + '" data-on="' + !pp.no_show + '" aria-pressed="' + !!pp.no_show + '">' + (pp.no_show ? 'MARKED NO-SHOW · UNDO' : 'DIDN\'T SHOW?') + '</button>' : '') +
        '</span><small>' + how + ((c.unsure_ids || []).indexOf(m.member_id) >= 0 ? ' · <b class="uns">UNSURE</b>' : '') + '</small></div>';
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
        (spain(c.city) ? '<label><span class="sr">Bizum number</span><input class="inp" id="payBizum" inputmode="tel" placeholder="Bizum 6XX XXX XXX" value="' + esc(me.bizum ? me.bizum.replace(/^\+34/, '') : '') + '"></label></div>' +
          '<label class="sr" for="payLink">Payment link</label><input class="inp" id="payLink" style="margin-top:8px" inputmode="url" placeholder="or a Revolut / PayPal link" value="' + esc(me.pay_link || '') + '">'
        : '<label><span class="sr">Payment link</span><input class="inp" id="payLink" inputmode="url" placeholder="Tikkie link" value="' + esc(me.pay_link || '') + '"></label></div><p class="hint" style="margin:6px 0 0">Tikkie: open it, make a request with no amount, share, copy the link here. bunq, Revolut or PayPal links work too.</p>') +
        '<p class="hint">Split between you and ' + ps.length + ' rider' + (ps.length > 1 ? 's' : '') + ': €' + (me.trip_cost != null ? (me.trip_cost / (ps.length + 1)).toFixed(2) : '–') + ' each, all of it to you' + (me.trip_cost != null && !feeLive() ? ' (the ' + feePct() + '% Hi8 fee on top is free during the pilot)' : '') + '. ' + (spain(c.city) ? 'Your Bizum number is shown only to the riders in your car. ' : 'Your link is shown only to the riders in your car. ') + 'Paid: ' +
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
      (f.getting === 'seat' && !c.seats_free ? '<p class="hint"><b>This isn\'t a seat yet.</b> You\'re on the list, and the first driver with room takes you.</p>' : '') +
      (!f.getting ? '<p class="hint">Pick one: it tells the drivers who needs a seat.</p>' : '');
    var lvl = '<span class="lb" style="margin-top:12px">YOUR LEVEL</span><div class="row">' + lvls.map(function (l) { return '<button class="opt" data-act="jflevel" data-v="' + l + '" aria-pressed="' + (f.level === l) + '">' + LEVEL[l] + '<small>' + LEVEL_SUB[l] + '</small></button>'; }).join('') + '</div>' +
      (c.levels === 'regular' ? '<p class="hint">This crew is for independent riders: you launch, ride upwind and get back in on your own.</p>' : '');
    var you = me || c.me ? '' : '<span class="lb">YOU</span><div style="display:grid;gap:8px"><label class="sr" for="jfEmail">Email</label><input class="inp" id="jfEmail" type="email" inputmode="email" autocomplete="email" placeholder="Email (only the app sees it)">' +
      '<label class="sr" for="jfName">Rider name</label><input class="inp" id="jfName" autocomplete="nickname" maxlength="40" placeholder="Rider name (what the crew sees)"></div><span class="lb" style="margin-top:12px"></span>';
    return '<div class="box" id="joinForm"><h3>' + (c.me ? 'CHANGE HOW YOU\'RE IN' : 'JOIN THIS CREW') + '</h3>' + (f.back ? '<p class="hint" style="margin:0 0 10px"><b>You\'re signed in.</b> Check your choices and confirm.</p>' : '') + you + how + lvl +
      (f.err ? '<div class="err" role="alert" style="margin:10px 0 0">' + f.err + '</div>' : '') +
      (c.me ? '<button class="big join" data-act="jfgo" style="width:100%;margin-top:12px"' + (f.busy ? ' disabled' : '') + '>' + (f.busy ? '<span class="spin"></span>' : 'SAVE') + '</button>' : '') +
      (me || c.me ? '' : '<p class="hint">By joining you agree to the <a href="terms/">terms</a>.</p>') + '</div>';
  }
  // I'M GOING for a rider who has joined before: straight in, the way they came last time (CHANGE in the toast)
  function quickJoin(c) {
    var lv = HI8.store.get('lv.' + c.sport, null), g = HI8.store.get('getting', null);
    var lvls = c.levels === 'rookie' ? ['rookie'] : c.levels === 'all' ? ['rookie', 'regular', 'ripper'] : ['regular', 'ripper'];
    if (!signedIn() || !lv || !g || lvls.indexOf(lv) < 0) { openJoin(); return; }
    S.jf = { level: lv, getting: g, seats: Number(HI8.store.get('seats', 3)) || 3, err: null, busy: false, quick: true };
    joinGo();
  }
  // the join form, opened from I'M IN or straight from I'M GOING on a session
  function openJoin() {
        var c = S.crew.data, me = c.me;
        S.jf = { level: me ? me.level : HI8.store.get('lv.' + c.sport, 'regular'), getting: me ? me.getting : (HI8.store.get('getting', null) || (c.seats_free > 0 ? 'seat' : null)), seats: me && me.getting === 'drive' ? me.seats : 3, err: null, busy: false };
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
    if (!c.drivers) return '<div class="box sav"><h3>NEED A DRIVER <span class="tag ok">NO CAR YET</span></h3><p class="hint" style="margin:0">Nobody is driving yet. When someone does, a seat from ' + esc(title(hub.name)) + ' costs about <b>' + money(m.share) + '</b> instead of ' + money(cost) + ' driving alone. Driving? Join and pick I\'LL DRIVE: ' + money(m.share * 3) + ' back from a full car.</p></div>';
    return '<div class="box sav"><h3>A SEAT, SPLIT <span class="tag good">YOU SAVE ' + money(m.save) + '</span></h3>' +
      '<div class="savrow"><span><small>DRIVING ALONE</small><s>' + money(cost) + '</s></span><span><small>A SEAT</small><b>' + money(m.share) + '</b></span><span><small>HI8 FEE ' + feePct() + '%</small>' + (m.feeFree ? '<b class="free">FREE</b>' : '<b>' + money(m.fee) + '</b>') + '</span></div>' +
      '<p class="hint">Fuel from ' + esc(title(hub.name)) + ' to ' + esc(spot.name) + ' and back, split four ways in a full car, settled with the driver on the day.' + (m.feeFree ? ' The ' + feePct() + '% fee keeps Hi8ctane free: not charged during the pilot.' : '') + ' <button class="lnk" data-act="passinfo">' + memberPct() + '% with the Hi8 Pass →</button></p></div>';
  }
  // UX review H01/H02: what a guest needs to decide, before anything else. Facts only; the full forecast and
  // the plan stay one scroll down. No names (privacy page): riders show by level until you're in.
  function essentials(c, f, hub) {
    var u = suit(c), kite = c.sport === 'kite' || c.sport === 'wing', up = FX.data[c.city] && FX.data[c.city].at ? clockAt(FX.data[c.city].at, c.city) : null;
    var wind = !f ? 'No forecast for this day yet' : (kite ? f.w + ' kt ' + FX.compass(f.dir) + (f.g ? ', gusts ' + f.g : '') : String(f.ground || '').toLowerCase() + ', ' + f.temp + '°C') + ' · ' + f.label;
    var ride = c.seats_free ? c.seats_free + ' seat' + (c.seats_free > 1 ? 's' : '') + ' free' + (hub ? ' from ' + title(hub.name) : '') + (c.meet_time ? ' at ' + hm(c.meet_time) : '')
      : c.drivers ? 'Cars are full: you can ask for a seat, or go your own way' : 'Nobody is driving yet: ask for a seat, or go your own way';
    var lv = (c.levels === 'regular' && kite ? 'Independent riders (launch, ride upwind, get back alone)' : CREW_LEVELS[c.levels] || '');
    var rows = [['FORECAST', wind, (u.k === 'go' ? '' : u.t) + (up ? (u.k === 'go' ? '' : ' · ') + (FX.data[c.city].stale ? 'older forecast from ' : 'model forecast, updated ') + up : '')], ['LEVEL', lv, ''], ['GETTING THERE', ride, ''],
      ['CREW', c.going >= c.max ? 'Full: ' + c.going + ' of ' + c.max : c.going + ' going of ' + c.max + (c.min && !c.min_met ? ' · goes ahead with ' + c.min : ''), 'Captain ' + (c.captain_until ? 'needed' : c.host)]];
    if (c.going >= c.max) rows[2] = ['GETTING THERE', 'This crew is full', 'Find another session, or start one at the same time'];
    return '<div class="ess">' + rows.map(function (r) { return '<div class="ess-r"><span class="pl-k">' + r[0] + '</span><span class="pl-v"><b>' + esc(r[1]) + '</b>' + (r[2] ? '<small>' + esc(r[2]) + '</small>' : '') + '</span></div>'; }).join('') + '</div>';
  }
  // spot intelligence (0028 spot_notes): parking, access, facilities, local tips; each with who says so and when it
  // was checked. Shows nothing until real notes are entered: the app never makes up an address or a car park.
  var NOTE_K = { parking: 'PARKING', access: 'ACCESS', facilities: 'FACILITIES', local: 'LOCAL TIP', warning: 'HEADS UP', closed: 'CLOSED' };
  function loadNotes(city) {
    if (!HI8.live || (S.notes && S.notes.city === city && Date.now() - S.notes.at < 600000) || S.notesP) return;
    S.notesP = HI8.rpc('hi8_spot_notes', { p_city: city }).then(function (n) { S.notes = { city: city, at: Date.now(), list: n || [] }; S.notesP = null; if (S.view === 'crew') renderSheet(); }, function () { S.notesP = null; });
  }
  function spotInfo(c) {
    var L = S.notes && S.notes.city === c.city ? S.notes.list.filter(function (n) { return n.spot === c.spot && n.kind !== 'closed' && (!n.from || n.from <= c.day) && (!n.to || n.to >= c.day); }) : [];
    if (!L.length) return '';
    return '<div class="box spotinfo"><h3>AT THE SPOT</h3><ul>' + L.map(function (n) {
      var nav = n.lat != null ? navUrls({ lat: n.lat, lon: n.lon }) : null;
      return '<li><span class="k">' + esc(NOTE_K[n.kind] || n.kind.toUpperCase()) + '</span><span>' + esc(n.body) + (nav ? ' <a class="navl" data-nav="note" target="_blank" rel="noopener" href="' + esc(nav.google) + '">GOOGLE MAPS ↗</a>' : '') +
        '<small>' + esc(n.source) + ' · checked ' + esc(dayInLine(n.checked)) + '</small></span></li>'; }).join('') + '</ul></div>';
  }
  function sheetCrew() {
    var C = S.crew;
    if (!C.data) return shell('CREW', C.err ? '<div class="err" role="alert">' + esc(C.err) + '</div><div class="f"><button class="big join" data-act="join" style="width:100%">SEE THE CREWS COMING UP</button></div>' : '<div class="sec"><div class="skel"></div><div class="skel" style="margin-top:10px;height:200px"></div></div>', '', true);
    var c = C.data, f = crewFx(c), spot = HI8.spot(c.spot) || {}, isToday = c.day === S.today, member = !!c.me;
    var status = c.status === 'off' ? '<span class="tag off">CALLED OFF</span>' : c.past ? '<span class="tag off">DONE</span>' : c.live ? '<span class="tag live">LIVE NOW</span>' : '';
    var maps = navUrls({ q: (c.maps || spot.maps || c.spot_name) + '' }).google;
    var hub = c.meet_hub ? HI8.hubsOf(c.city).filter(function (h) { return h.slug === c.meet_hub; })[0] : null;
    var joining = !member && S.jf && !S.jf.quick && c.status === 'on' && !c.past, dayOf = member && isToday && c.status === 'on' && !c.past && !sessionEnded(c);
    var head = '<div class="hero art a-' + c.sport + '"><div class="k">' + tile(c.sport, 20) + esc(SPORT[c.sport].name.toUpperCase() + ' CREW') + ' ' + status + (c.min && !c.min_met && c.status === 'on' && !c.past && !c.ended && !sessionEnded(c) ? ' <span class="needs">GOES AHEAD WITH ' + c.min + ': NEEDS ' + (c.min - c.going) + ' MORE</span>' : '') + '</div><h2>' + esc(c.spot_name) + '</h2>' +
      '<div class="when2">' + esc(dayRel(c.day)) + ' · ' + esc(hm(c.start)) + (c.end ? '–' + esc(hm(c.end)) : '') + '</div>' +
      '<div class="when2" style="color:var(--mint);font-weight:400;margin-top:4px">' + esc(CREW_LEVELS[c.levels] || '') + (c.captain_until ? ' · captain needed' : ' · captain ' + esc(c.host) + (c.host_plate ? ' #' + pad3(c.host_plate) : '')) + '</div></div>';
    // just joined: the welcome sits in the page (2.24), not in a box floating over everything
    var welcome = member && C.welcome ? '<div class="box welcome" role="status"><h3>✓ YOU\'RE IN' + (C.welcome.plate ? ' <span class="tag">FOUNDING PLATE #' + pad3(C.welcome.plate) + '</span>' : '') + '</h3><p class="hint" style="margin:0">' +
      esc(dayRel(c.day)) + ' · ' + esc(hm(c.meet_time || c.start)) + ' · ' + esc(hub && c.meet_time && c.me.getting !== 'own' ? 'pick-up ' + title(hub.name) : c.spot_name) + '. The crew sees you under WHO\'S GOING.</p></div>' : '';
    var offer = member && C.welcome && C.welcome.offer ? '<div class="box"><h3>MORE CREWS LIKE THIS?</h3><button class="opt" data-act="alert" data-sport="' + c.sport + '" data-on="true">EMAIL ME NEW ' + esc(SPORT[c.sport].name.toUpperCase()) + ' CREWS</button></div>' : '';
    var ended = c.past || c.ended || sessionEnded(c);
    // joining: just the form and the hours (2.24); the rest of the page comes after
    var top = C.pending && !member ? pendingBox(C) : joining ? joinForm(c) + crewStrip(c, f) :
      (c.status === 'off' ? '<div class="err">Called off: ' + esc(c.off_reason || 'the captain called it off') + '</div>' : '') +
      (member ? '' : cardsStrip(c)) + (ended ? '' : '<div id="fxAnchor"></div>' + crewStrip(c, f)) + carBox(c, spot, hub) +
      (c.note ? '<div class="box"><h3>FROM THE CAPTAIN</h3><div style="font-size:13px">' + esc(c.note) + '</div></div>' : '') +
      '<div class="box"><h3>WHO\'S GOING <span class="tag' + (c.going >= c.max ? ' off' : '') + '">' + c.going + '/' + c.max + '</span></h3>' +
      (member ? membersHtml(c) : '<div style="display:flex;align-items:center;gap:10px">' + faces(c) + '<span style="font-size:12.5px;color:var(--mute)">' +
        (c.seats_free ? c.seats_free + ' seat' + (c.seats_free > 1 ? 's' : '') + ' free' + (hub ? ' from ' + esc(hub.name) : '') + (c.meet_time ? ' at ' + esc(hm(c.meet_time)) : '') : c.drivers ? 'cars are full' : 'no car yet') +
        (c.need_seat ? ' · ' + c.need_seat + ' need' + (c.need_seat > 1 ? '' : 's') + ' a seat' : '') + (c.here ? ' · ' + c.here + ' at the spot' : '') + '</span></div><p class="hint">Names, cars and the chat are for the crew.</p>') + '</div>';
    var warn = c.status === 'on' && !ended ? (suit(c).k === 'closed' || suit(c).k === 'stale' ? suitBox(c) : (fxDrop(c, f) || suitBox(c))) : '';
    if (warn && member && suit(c).k !== 'go') warn += '<div class="sec">' + planB(c) + '</div>';
    if (member) {
      // members: what's open for you, then one tap to your first stop, the calendar and the chat (H12)
      // the Session Pass replaces the welcome box, the readiness box and the directions row (same data, one place)
      if (!ended && c.status === 'on') head += '<div class="sec stgw">' + planAsk(c) + passHtml(c, { joined: !!C.welcome, plate: C.welcome && C.welcome.plate }) + '</div>';
      else head += (welcome ? '<div class="sec">' + welcome.replace('class="box welcome"', 'class="box welcome" style="margin:12px 0 0"') + '</div>' : '') + '<div class="sec stgw">' + planAsk(c) + readyBox(c) + stageBar(c) + (c.status === 'off' ? planB(c) : '') + '</div>';
    } else head += '<div class="sec stgw">' + essentials(c, f, hub) + '</div>';
    if (member) welcome = '';   // shown first, inside the header block (H05: "you're in", then what's open)
    var body = head + welcome + warn + top;
    if (member) {
      var pPlan = planHtml(c), pSpot = '';
      var pMeet = '<div class="box"><h3>MEETING POINT</h3><div style="font-size:13px">' + (hub ? '<b>' + esc(hub.name) + '</b> · ' + esc(hub.sub || '') + (c.meet_time ? ' at <b>' + esc(hm(c.meet_time)) + '</b>' : '') + '<br>' : '') +
        (c.meet_note ? esc(c.meet_note) + '<br>' : '') + 'Spot: ' + esc(c.spot_name) + '</div><div class="row" style="margin-top:10px">' +
'</div>' + (function () { var w = c.past || c.ended || sessionEnded(c) || c.status !== 'on' ? '' : firstStop(c).what;   // the header already has the first stop
          return (hub && c.me.getting !== 'own' && w !== 'pickup' ? navRow('PICK-UP', { lat: hub.lat, lon: hub.lon }, 'pickup') : '') +
            (c.meet_lat != null ? (w !== 'pin' ? navRow('THE PIN', { lat: c.meet_lat, lon: c.meet_lon }, 'pin') : '') : w !== 'spot' ? navRow('THE SPOT', { q: c.maps || spot.maps || c.spot_name }, 'spot') : ''); })() + '<div class="row" style="margin-top:10px">' +
        (cap(c) && !c.past && c.status === 'on' ? '<button class="opt" data-act="pin">' + (S.crew.pinBusy ? 'FINDING YOU…' : c.meet_lat != null ? 'MOVE THE PIN TO WHERE I AM' : 'DROP THE PIN WHERE I AM') + '</button>' : '') +
        (c.status === 'on' && !c.past ? '' : '<button class="opt" data-act="ics">ADD TO CALENDAR</button>') + '</div>' +
        (c.past ? '' : (function () { var mp = personOf(c.me) || {}; return '<div class="two" style="margin-top:10px;align-items:center"><label><span class="sr">Your mobile for the crew</span><input class="inp" id="myPhone" inputmode="tel" autocomplete="tel" placeholder="Your mobile" value="' + esc(mp.phone || '') + '"></label><button class="opt" data-act="phonesave">' + (mp.phone ? 'SAVED ✓ · UPDATE' : 'SHARE WITH THE CREW') + '</button></div><p class="hint">Only the riders in this crew see it: handy at the pick-up.</p>'; })()) + '</div>';
      if (isToday && c.status === 'on' && !sessionEnded(c)) {
        pSpot = '<div class="box"><h3>AT THE SPOT ' + (c.me.here ? '<span class="tag live">YOU\'RE THERE</span>' : '') + '</h3>' +
          (c.me.here ? '<p class="hint" style="margin:0 0 8px">How is it? Your crew and everyone checking the map see it (without your name).</p><div class="row">' +
            [['on', 'ON'], ['meh', 'MEH'], ['off', 'OFF']].map(function (v) { return '<button class="opt" data-act="report" data-v="' + v[0] + '">' + v[1] + '</button>'; }).join('') + '</div>' +
            (c.sport === 'kite' ? '<div class="row" style="margin-top:8px">' + [7, 9, 10, 12, 14].map(function (k) { return '<button class="opt" data-act="rkite" data-v="' + k + '" aria-pressed="' + (S.crew.rkite === k) + '">' + k + ' M</button>'; }).join('') + '</div>' :
              '<div class="row" style="margin-top:8px">' + (c.sport === 'mx' ? ['dry', 'tacky', 'muddy'] : ['dry', 'wet', 'muddy']).map(function (k) { return '<button class="opt" data-act="rground" data-v="' + k + '" aria-pressed="' + (S.crew.rground === k) + '">' + k.toUpperCase() + '</button>'; }).join('') + '</div>') +
            '<button class="opt" data-act="checkout" style="margin-top:10px">I\'VE LEFT</button>'
            : '<button class="big start" data-act="checkin" style="width:100%">I\'M AT THE SPOT</button><p class="hint">Lets the crew (and the map) know someone\'s there.</p>') + '</div>';
      }
      var pPay = payHtml(c);
      var pChat = '<div class="box" id="chatAnchor"><h3>CREW CHAT</h3><div class="chat" id="chatBox">' + chatHtml(C.msgs) + '</div>' +
        '<form class="send" data-form="chat"><label class="sr" for="chatIn">Message</label><input class="inp" id="chatIn" maxlength="500" autocomplete="off" placeholder="Message the crew"><button type="submit">SEND</button></form></div>';
      var pEdit = S.jf ? joinForm(c) : '<div class="f"><div class="row"><button class="opt" data-act="jfopen">CHANGE LEVEL OR RIDE</button><button class="opt" data-act="leave">' +
        (C.confirm === 'leave' ? (cap(c) ? 'TAP AGAIN: CALL IT OFF' : 'TAP AGAIN TO LEAVE') : cap(c) ? 'CALL IT OFF' : 'LEAVE THE CREW') + '</button>' +
        (cap(c) && c.going > 1 && c.status === 'on' && !c.past && !c.captain_until ? '<button class="opt" data-act="stepdown">' + (C.confirm === 'stepdown' ? 'TAP AGAIN: HAND IT OVER' : 'I CAN\'T MAKE IT: HAND IT OVER') + '</button>' : '') + '</div>' +
        (cap(c) && c.going > 1 && c.status === 'on' && !c.past ? '<p class="hint">Can\'t make it? Hand it over: the next driver (or most experienced rider) is asked to keep it on, and anyone in the crew can take it.</p>' : '') + '</div>';
      // on the day: check in, the meeting point and the chat first; the forecast and the money after (2.24)
      if (ended) { pMeet = ''; pEdit = ''; }   // H15: nothing to navigate to, add or call off once it's over
      var pCards = cardsStrip(c);
      body = ended ? head + rateBox(c) + pCards + top + pPay + pChat
        : dayOf ? head + welcome + warn + pSpot + pMeet + spotInfo(c) + pChat + top + pPlan + pCards + pPay + pEdit : head + welcome + warn + pPlan + pMeet + spotInfo(c) + pChat + top + pCards + pPay + pEdit;
    } else if (c.status === 'on' && !c.past && !joining) {
      body += '<div class="sec stgw">' + stageBar(c) + '</div>' + spotInfo(c) + '<div class="box"><h3>THE SPOT</h3><div style="font-size:12.5px">' + esc(spot.note || '') + '</div><div class="row" style="margin-top:10px"><a class="opt" target="_blank" rel="noopener" href="' + esc(maps) + '">DIRECTIONS</a><button class="opt" data-act="spot" data-spot="' + esc(c.spot) + '">FULL FORECAST</button></div></div>';
    }
    if (member && !ended) body += offer + '<div class="box keepbox"><h3>RIDE WITH THEM AGAIN</h3><p class="hint">Keep this crew: the people in it stay together. When one of you goes, the rest hear about it first.</p><button class="big start" data-act="keep" data-code="' + esc(c.code) + '">KEEP THIS CREW</button></div>';
    if (!joining && c.reports && c.reports.length) {
      body += '<div class="box"><h3>REPORTS FROM THE SPOT</h3><div class="reports">' + c.reports.slice(0, 5).map(function (r) {
        return '<div class="rep"><span class="tag ' + (r.verdict === 'on' ? 'epic' : r.verdict === 'meh' ? 'ok' : 'no') + '">' + r.verdict.toUpperCase() + '</span><span>' + (r.name ? esc(r.name) + ' · ' : '') + (r.kite ? r.kite + ' m' : '') + (r.ground ? esc(r.ground) : '') + (r.note ? ' · ' + esc(r.note) : '') + '</span><small>' + esc(ago(r.at)) + '</small></div>';
      }).join('') + '</div></div>';
    }
    var foot = !member && S.jf && S.jf.quick && S.jf.busy ? '<button class="big join" disabled><span class="spin"></span> PUTTING YOU IN…</button>' : !member && c.status === 'on' && !c.past && C.pending ? '<button class="big ghost" data-act="resend"' + (Date.now() < (C.pending.next || 0) ? ' disabled' : '') + '>' + (Date.now() < (C.pending.next || 0) ? 'LINK SENT · RESEND IN ' + Math.ceil((C.pending.next - Date.now()) / 1000) + ' S' : 'SEND THE LINK AGAIN') + '</button>'
      : !member && c.status === 'on' && !c.past && c.going >= c.max ? '<button class="big join" data-act="join">OTHER SESSIONS</button><button class="big ghost" data-act="share" style="flex:0 0 34%">SHARE</button>'
      : !member && c.status === 'on' && !c.past && suit(c).k === 'closed' ? '<button class="big join" data-act="join">OTHER SESSIONS</button>'
      : !member && c.status === 'on' && !c.past && !S.jf && suit(c).k === 'hazard' ? '<button class="big join" data-act="join">OTHER SESSIONS</button><button class="big ghost" data-act="jfopen" style="flex:0 0 40%">JOIN ANYWAY</button>'
      : !member && c.status === 'on' && !c.past ? '<button class="big join" data-act="' + (S.jf ? 'jfgo' : 'jfopen') + '"' + (S.jf && S.jf.busy ? ' disabled' : '') + '>' + (S.jf && S.jf.busy ? '<span class="spin"></span>' : S.jf ? 'CONFIRM JOIN' : 'I\'M GOING') + '</button>' + (S.jf ? '' : '<button class="big ghost" data-act="share" style="flex:0 0 34%">SHARE</button>')
      : member && (c.past || c.ended || sessionEnded(c)) ? '<button class="big start" data-act="keep" data-code="' + esc(c.code) + '">KEEP THIS CREW</button>'
      : '<a class="big wa" href="https://wa.me/?text=' + encodeURIComponent(shareText(c)) + '" target="_blank" rel="noopener">SHARE TO WHATSAPP</a>';
    if (C.cardOpen && C.cards) { var ko = C.cards.filter(function (k) { return k.member_id === C.cardOpen; })[0]; if (ko) body += bigCard(ko); }
    return shell(esc(SPORT[c.sport].name.toUpperCase()) + ' CREW', body, foot, true);
  }



  // ---- 2.24 RIDER CARDS: see who you'd ride with before you join
  function loadCards() {
    var C = S.crew; if (!C || !HI8.live) return;
    var p = signedIn() ? HI8.withKey('hi8_crew_cards', { p_code: C.code }, { noQueue: true }) : HI8.rpc('hi8_crew_cards', { p_code: C.code, p_key: null });
    C.cardsAt = Date.now();
    p.then(function (k) { if (S.crew === C) { C.cards = k || []; renderSheet(); } }, noop);
  }
  function cardAv(k, size) {
    var ini = esc(k.initials || String(k.name || '?').slice(0, 1).toUpperCase());
    return k.avatar ? '<img src="' + esc(HI8.avatarUrl(k.avatar)) + '" alt="" width="' + size + '" height="' + size + '" loading="lazy" data-ini="' + ini + '">' : '<span class="ini">' + ini + '</span>';
  }
  // a cartoon that won't load (removed, or Storage down) shows the initials instead of a broken image
  document.addEventListener('error', function (e) {
    var t = e.target; if (!t || t.tagName !== 'IMG' || !t.hasAttribute('data-ini')) return;
    var sp = document.createElement('span'); sp.className = 'ini'; sp.textContent = t.getAttribute('data-ini'); t.replaceWith(sp);
  }, true);
  function cardName(k) { return k.name || 'Rider' + (k.plate ? ' #' + pad3(k.plate) : ''); } // outside the crew: no names (privacy page)
  function cardStats(k) { return k.stats || { sessions: 0, spots: 0, drives: 0, started: 0 }; }
  function miniCard(k) {
    var st = cardStats(k), tag = k.me ? 'YOU' : k.together ? 'RODE WITH YOU ' + k.together + '×' : k.host ? 'CAPTAIN' : st.sessions === 0 && k.stats ? 'FIRST SESSION' : '';
    var none = k.made === false && !k.avatar;
    return '<button class="rc' + (k.me ? ' me' : '') + '" data-act="rcard" data-member="' + esc(k.member_id) + '" aria-label="' + esc(cardName(k)) + '\'s rider card">' +
      '<span class="rc-top"><b>' + (k.plate ? '#' + pad3(k.plate) : '') + '</b><i>' + esc((LEVEL[k.level] || '').toUpperCase()) + '</i></span>' +
      '<span class="rc-av a-' + esc(S.crew && S.crew.data ? S.crew.data.sport : S.sport) + (none ? ' none' : '') + '">' + (none ? '<span class="ini">?</span>' : cardAv(k, 96)) + '</span>' +
      '<span class="rc-name">' + esc(cardName(k)) + '</span>' +
      (k.stats ? '<span class="rc-st"><span><em>' + st.sessions + '</em>RIDES</span><span><em>' + st.spots + '</em>SPOTS</span><span><em>' + st.drives + '</em>DRIVES</span></span>' : '<span class="rc-st closed">' + (k.made === false ? 'NO CARD YET' : 'CARD FOR THEIR CREWS') + '</span>') +
      (tag ? '<span class="rc-tag' + (k.together ? ' tog' : '') + '">' + esc(tag) + '</span>' : '') + '</button>';
  }
  function cardsStrip(c) {
    var K = S.crew.cards;
    if (!K) return '<div class="box rcbox"><h3>' + (c.me ? 'YOUR CREW' : 'WHO YOU\'D RIDE WITH') + '</h3><div class="rcards"><div class="skel" style="height:190px;width:100%"></div></div></div>';
    if (!K.length) return '';
    var known = K.filter(function (k) { return k.together; }).length, made = K.filter(function (k) { return k.made !== false; }).length, mine = K.filter(function (k) { return k.me; })[0];
    if (!c.me && !made && !known) return '';   // UX review H01: no strip of blank "?" cards for a guest; WHO'S GOING says who's in
    var nudge = mine && mine.made === false ? '<div class="cardnudge"><span><b>Your card is empty.</b> Your crew sees a “?” where you are.</span><button class="big start" data-act="mycard">MAKE MY CARD · 1 MIN</button></div>' : '';
    return '<div class="box rcbox"><h3>' + (c.me ? 'YOUR CREW' : 'WHO YOU\'D RIDE WITH') + ' <span class="tag">' + K.length + ' RIDER' + (K.length > 1 ? 'S' : '') + '</span>' + (made < K.length ? ' <span class="tag">' + made + ' WITH A CARD</span>' : '') + (known && !c.me ? ' <span class="tag good">' + known + ' YOU KNOW</span>' : '') + '</h3>' + nudge +
      '<div class="rcards" role="list">' + K.map(miniCard).join('') + '</div>' +
      '<p class="hint" style="margin:8px 0 0">Tap a card: how long they\'ve ridden, where, and how much.' + (c.me ? '' : ' Names show once you\'re in.') + '</p></div>';
  }
  function bigCard(k) {
    var st = cardStats(k), sp = S.crew.data.sport;
    var since = st.since ? (function () { var a = st.since.split('-'); return ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][Number(a[1]) - 1] + ' ' + a[0]; })() : null;
    var facts = [['LEVEL', (LEVEL[k.level] || '–').toUpperCase()], ['YEARS RIDING', k.years != null ? String(k.years) : null], ['HOME SPOT', k.home ? k.home.toUpperCase() : null],
      ['RIDES MOST AT', st.top_spot ? st.top_spot.toUpperCase() : null], ['ON HI8CTANE SINCE', since]].filter(function (x) { return x[1]; });
    return '<div class="bcard-over" role="dialog" aria-modal="true" aria-label="' + esc(cardName(k)) + '\'s rider card"><div class="bcard">' +
      '<div class="bcard-shine" aria-hidden="true"></div>' +
      '<div class="bcard-top"><b>' + (k.plate ? '#' + pad3(k.plate) : 'RIDER') + '</b><span>' + (k.plate && k.plate <= 100 ? 'FOUNDING<br>RIDER' : esc(SPORT[sp].name.toUpperCase()) + '<br>RIDER') + '</span></div>' +
      '<div class="bcard-art a-' + esc(sp) + '">' + cardAv(k, 180) + (k.host ? '<span class="bcard-stamp">CAPTAIN</span>' : '') + '</div>' +
      '<div class="bcard-name">' + esc(cardName(k)) + (k.me ? ' <small>YOU</small>' : '') + '</div>' +
      (k.tagline ? '<div class="bcard-line">“' + esc(k.tagline) + '”</div>' : '') +
      (k.stats ? '<div class="bcard-stats"><span><em>' + st.sessions + '</em>RIDES</span><span><em>' + st.spots + '</em>SPOTS</span><span><em>' + st.drives + '</em>DRIVES</span><span><em>' + st.started + '</em>CREWS<br>STARTED</span></div>' : '') +
      (k.together ? '<div class="bcard-tog">YOU\'VE RIDDEN TOGETHER ' + k.together + (k.together === 1 ? ' TIME' : ' TIMES') + '</div>' : '') +
      // 2.30: reliability, from the no-shows captains mark (only once there's something to go on)
      (k.stats && st.no_shows != null && st.sessions + st.no_shows >= 3 ? '<div class="bcard-rel' + (st.no_shows ? ' some' : '') + '">SHOWED UP ' + st.sessions + ' OF ' + (st.sessions + st.no_shows) + '</div>' : '') +
      '<div class="bcard-facts">' + facts.map(function (x) { return '<span>' + x[0] + '</span><b>' + esc(x[1]) + '</b>'; }).join('') + '</div>' +
      (k.insta ? '<a class="bcard-ig" target="_blank" rel="noopener" href="https://instagram.com/' + esc(k.insta) + '">@' + esc(k.insta) + ' ON INSTAGRAM</a>' : '') +
      (!k.stats ? '<p class="bcard-note">This rider keeps their card for their crews. Join, and you\'ll see it.</p>' : !k.name ? '<p class="bcard-note">Their name shows once you\'re in the crew.' + (signedIn() ? '' : ' Signed in, you also see if you\'ve ridden together.') + '</p>' : '') +
      '<button class="bcard-x" data-act="rcardx">CLOSE</button></div></div>';
  }
  function myCardPreview(p) {
    var st = p.stats || {};
    var k = { made: p.card_public != null || !!S.avatar, member_id: 'me', name: (HI8.mine && (HI8.mine.name || HI8.mine.first_name)) || (myPlate() ? 'Rider #' + myPlate() : 'You'), plate: myPlate(), avatar: S.avatar, level: HI8.store.get('lv.' + S.sport, 'regular'), me: true, stats: st, tagline: p.tagline };
    return '<div class="rcards solo">' + miniCard(k).replace('data-act="rcard"', 'data-act="noop" tabindex="-1"') + '<p class="hint" style="margin:0;align-self:center">This is your card on every crew you join.' + (p.card_public == null ? ' Not made yet: riders see a “?” for now.' : p.card_public === false ? ' Riders outside your crews see just your initials and level.' : ' Riders deciding to join see it with your cartoon, without your name: that\'s for your crew.') + '</p></div>';
  }

  // ---- 2.23 on a crew page: the forecast dropped, how was it, go again
  function sessionEnded(c) { var endH = c.end ? Number(hm(c.end).slice(0, 2)) + (hm(c.end).slice(3) > '00' ? 1 : 0) : Number(hm(c.start).slice(0, 2)) + 3; return c.day < S.today || (c.day === S.today && S.nowH >= endH); }
  function fxDrop(c, f) {
    if (c.status !== 'on' || c.past || c.live || !f || f.score >= 4 || sessionEnded(c)) return '';
    var kite = c.sport === 'kite', nx = nextWindowAt(c.spot, c.sport, null);
    if (nx && nx.date === c.day && nx.from < Number(hm(c.start).slice(0, 2)) + 3 && nx.to > Number(hm(c.start).slice(0, 2))) nx = null;
    var line = (kite ? f.w + ' KT ' + FX.compass(f.dir) : (f.ground || '').toUpperCase() + ' · ' + f.temp + '°C') + ' · ' + f.label;
    var u = suit(c);
    return '<div class="fxdrop s-' + u.k + '" role="status"><b>' + (u.k === 'hazard' ? '⚠ NOT RECOMMENDED: ' : u.k === 'light' ? esc(u.t) + ': ' : 'THE FORECAST DROPPED: ') + esc(line) + '</b><p>' + (u.k === 'hazard' ? esc(u.s) + ' ' : '') +
      (nx ? 'Next good window here: <b>' + esc(dayRel(nx.date) + ' ' + pad(nx.from) + '–' + pad(nx.to)) + '</b>' + (kite ? ', ' + nx.w + ' kt ' + FX.compass(nx.dir) : '') + ', ' + esc(nx.label) + '.' : 'No good window here in the next days.') +
      (cap(c) ? ' You\'re the captain: move it, or call it off.' : (c.me ? ' The captain decides. If you\'re out, leave the crew below: your seat frees up.' : ' The captain decides whether it goes ahead.')) + ' A forecast is never a safety check: every session is your own call.</p>' +
      (cap(c) ? '<div class="row">' + (nx ? '<button class="opt" data-act="movecrew" data-date="' + nx.date + '" data-from="' + nx.from + '" data-to="' + nx.to + '">MOVE IT TO ' + esc(dayRel(nx.date)) + ' ' + pad(nx.from) + '–' + pad(nx.to) + '</button>' : '') +
        '<button class="opt" data-act="leave">' + (S.crew.confirm === 'leave' ? 'TAP AGAIN: CALL IT OFF' : 'CALL IT OFF') + '</button></div>' + (nx ? '<p class="hint">If you move it, everyone is asked STILL IN? Who doesn\'t answer within 24 hours (at the latest 3 hours before the meet) loses their seat.</p>' : '') + '' : '') + '</div>';
  }
  function rateBox(c) {
    if (!c.me || c.status !== 'on' || !sessionEnded(c) || c.day < FX.addDays(S.today, -1)) return '';
    var kite = c.sport === 'kite', me = (c.members || []).filter(function (m) { return m.me; })[0], mine = me ? (c.reports || []).filter(function (r) { return r.name === me.name; })[0] : null;
    var nx = nextWindowAt(c.spot, c.sport, null);
    var again = nx ? '<div class="box"><h3>GO AGAIN <span class="tag ' + FX.tone(nx.score) + '">' + esc(nx.label) + '</span></h3><p class="hint" style="margin:0 0 8px">The next good window at ' + esc(c.spot_name) + ': <b>' + esc(dayRel(nx.date) + ' ' + pad(nx.from) + '–' + pad(nx.to)) + '</b>' + (kite ? ', ' + nx.w + ' kt ' + FX.compass(nx.dir) : '') + '.</p>' +
      '<button class="big start" data-act="again" data-code="' + esc(c.code) + '" data-date="' + nx.date + '" data-from="' + nx.from + '" data-to="' + nx.to + '" style="width:100%">RUN IT AGAIN · SAME CREW SET-UP</button></div>' : '';
    var size = kite ? '<div class="row" style="margin-top:8px">' + [7, 9, 10, 12, 14].map(function (k) { return '<button class="opt sm" data-act="rkite" data-v="' + k + '" aria-pressed="' + (S.crew.rkite === k) + '">' + k + ' M</button>'; }).join('') + '</div>' : '';
    var btns = '<div class="row">' + [['on', 'ON', 'it worked'], ['meh', 'MEH', 'so-so'], ['off', 'OFF', 'it didn\'t']].map(function (v) { return '<button class="opt" data-act="report" data-v="' + v[0] + '" aria-pressed="' + !!(mine && mine.verdict === v[0]) + '">' + v[1] + '<small>' + v[2] + '</small></button>'; }).join('') + '</div>';
    if (mine) return '<div class="box" id="rateBox"><h3>HOW WAS IT? <span class="tag good">STAMPED ✓</span></h3><div class="rated">You said ' + esc(mine.verdict.toUpperCase()) + (mine.kite ? ' on a ' + mine.kite + ' m' : '') + '. It\'s on your rider card' + (S.card ? ': ' + S.card.sessions + ' session' + (S.card.sessions === 1 ? '' : 's') + ' so far' : '') + '.</div><p class="hint">Changed your mind? Tap another one.</p>' + btns + '</div>' + again;
    return '<div class="box" id="rateBox"><h3>HOW WAS IT?</h3><p class="hint" style="margin:0 0 8px">One tap. It goes on your rider card, and the next crew at ' + esc(c.spot_name) + ' sees it.</p>' + btns + size + '</div>' + again;
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
      var rows = FX.dayRows(sp, date, sport, spot, fxo(sport), 6, 21), nowT = S.today + 'T' + pad(S.nowH) + ':00';
      var cell = function (r, html, style) { return '<td' + (r.t === nowT ? ' class="now"' : '') + (style ? ' style="' + style + '"' : '') + '>' + html + '</td>'; };
      var tr = function (label, fn, cls) { return '<tr' + (cls ? ' class="' + cls + '"' : '') + '><th scope="row">' + label + '</th>' + rows.map(fn).join('') + '</tr>'; };
      var windCell = function (w) { return w == null ? '' : 'background:' + window.HI8_WIND_COLOR(w) + ';color:' + (w > 33 ? '#fff' : '#111'); };
      var mname = FX.MODEL_NAME[sp.model] || 'BEST';
      var T = [tr('', function (r) { return cell(r, pad(r.h)); }, 'h')];
      if (sport === 'kite') {
        T.push(tr('WIND KT · ' + mname, function (r) { return cell(r, Math.round(r.w), windCell(r.w)); }));
        T.push(tr('GUSTS', function (r) { return cell(r, Math.round(r.g), windCell(r.g)); }));
        T.push(tr('DIRECTION', function (r) { return cell(r, arrow(r.dir) + '<span class="sr">' + FX.compass(r.dir) + '</span>'); }));
        T.push(tr('SHORE', function (r) { var sh = spot.lake ? 'lagoon' : FX.shore(spot.face, r.dir), ok = spot.lake || spot.good_from == null || FX.inRange(r.dir, spot.good_from, spot.good_to);
          var lab = { onshore: 'ON', 'cross-on': 'X-ON', 'side-shore': 'SIDE', 'cross-off': 'X-OFF', offshore: 'OFF', lagoon: 'FLAT' }[sh] || '';
          var col = sh === 'offshore' || !ok ? 'no' : sh === 'cross-off' ? 'ok' : sh === 'onshore' ? 'ok' : 'good';
          return cell(r, '<span class="shr">' + lab + '</span>', 'background:var(--' + col + ')'); }, 'shore'));
        ['ecmwf_ifs025', 'icon_seamless', 'gfs_seamless'].forEach(function (m) {
          if (rows.some(function (r) { return r.m && r.m[m]; })) T.push(tr(FX.MODEL_NAME[m], function (r) { var x = r.m && r.m[m]; return cell(r, x ? Math.round(x.w) : '', x ? windCell(x.w) + ';opacity:.8' : ''); }));
        });
        T.push(tr('<button class="kgth" data-act="kg">KITE M · ' + kg() + ' KG ✎</button>', function (r) { var k = FX.kiteSize(r.w, kg()); return cell(r, k || ''); }));
        if (rows.some(function (r) { return r.wv != null; })) T.push(tr('WAVES M', function (r) { return cell(r, r.wv != null ? r.wv.toFixed(1) : ''); }));
        if (!spot.lake && rows.some(function (r) { return r.tide != null; })) T.push(tr('TIDE M', function (r) { return cell(r, r.tide != null ? (r.tide > 0 ? '+' : '') + r.tide.toFixed(1) : ''); }));
      } else {
        T.push(tr('GROUND', function (r) { return cell(r, r.rate && r.rate.ground ? r.rate.ground.slice(0, 5).toUpperCase() : ''); }));
        T.push(tr('RAIN 24H MM', function (r) { return cell(r, r.r24 != null ? r.r24 : ''); }));
        T.push(tr('WIND · GUSTS', function (r) { return cell(r, Math.round(r.w) + '·' + Math.round(r.g)); }));
      }
      T.push(tr('RAIN MM', function (r) { return cell(r, r.mm ? r.mm : '', r.mm >= 0.2 ? 'background:#cfe0ff' : ''); }));
      T.push(tr('TEMP °C', function (r) { return cell(r, r.temp != null ? Math.round(r.temp) : ''); }));
      T.push(tr('RATING', function (r) { var t = r.rate ? FX.tone(r.rate.s) : 'none'; return cell(r, r.rate ? (r.rate.dark ? '·' : Math.round(r.rate.s)) : '', 'background:var(--' + (t === 'none' ? 'no' : t) + ')'); }, 'rate'));
      if (sport === 'kite') T.push(tr('KITE M · ' + kg() + ' KG', function (r) { return cell(r, r.rate && r.rate.kite && !r.rate.dark && r.rate.s > 0 ? r.rate.kite : ''); }));
      var ws = FX.windows(sp, date, sport, spot, fxo(sport)), day = sp.days[date] || {};
      var di = FX.dayInfo(sp, date), ag = FX.agreement(rows.filter(function (r) { return r.rate && !r.rate.dark; }), sport), tides = sport === 'kite' && !spot.lake ? FX.tides(sp, date) : [];
      var info = di ? '<div class="dinfo">' + [['RAIN', di.pop != null ? di.pop + '%' : '–'], ['CLOUD', di.cloud != null ? di.cloud + '%' : '–'], ['TEMP', di.tmin != null ? (di.tmin === di.tmax ? di.tmax : di.tmin + '-' + di.tmax) + '°' : '–'],
        sport === 'kite' ? ['WAVES', di.wave != null ? di.wave + ' M' + (di.period ? ' · ' + di.period + ' S' : '') : '–'] : ['RAIN TOTAL', di.mm + ' MM'], sport === 'kite' ? ['WATER', di.sst != null ? di.sst + '°C' : '–'] : ['WIND', di.w + ' KT'],
        ['LIGHT', di.sunrise ? di.sunrise + '-' + di.sunset : '–']].concat(tides.length ? [['HIGH TIDE', tides.filter(function (x) { return x.kind === 'high'; }).map(function (x) { return x.t; }).join(' · ') || '–'], ['LOW TIDE', tides.filter(function (x) { return x.kind === 'low'; }).map(function (x) { return x.t; }).join(' · ') || '–']] : []).concat([['MODELS', ag ? ag.n + '/' + ag.of + ' ' + ag.label : '–'], ['SOURCE', FX.sourceFor(S.city, date, S.today)]]).map(function (x) { return '<span><small>' + x[0] + '</small>' + esc(x[1]) + '</span>'; }).join('') + '</div>' : '';
      table = info + '<div class="tbl-wrap"><table class="fx"><caption class="sr">Hourly forecast for ' + esc(spot.name) + '</caption>' + T.join('') + '</table></div>' +
        '<p class="legend2">' + (ws[0] ? 'Best: ' + pad(ws[0].from) + '–' + pad(ws[0].to) + ' · ' + esc(ws[0].label) + (ws[0].why && ws[0].why.length ? ' · ' + esc(ws[0].why.join(', ')) : '') : 'No good window this day.') +
        (day.sunrise ? ' · Light ' + esc(day.sunrise) + '–' + esc(day.sunset) : '') + '. ' + (sport === 'kite' ? 'Wind in knots. Arrows point where it blows. ' + (spot.lake ? 'Lagoon: any direction works.' : 'This beach faces ' + FX.compass(spot.face) + (spot.good_from != null ? ': it works from ' + FX.compass(spot.good_from) + ' to ' + FX.compass(spot.good_to) + ', and ' + FX.compass((spot.face + 180) % 360) + ' is offshore (no go).' : '.')) + (tides.length ? ' The tide comes from an 8 km sea model: a rough guide, check the local tide table.' : '') : 'Rating: rain now, mud from the last 24 h of rain, heat and wind.') + '</p>';
    }
    var crews = upcoming(sport, 14).filter(function (c) { return c.spot === spot.slug; });
    var reps = S.live ? (S.live.reports || []).filter(function (r) { return r.spot === spot.slug; }) : [];
    // the call for this spot on the chosen day: join who's going, or start a crew in the best window, one tap
    var bw = sp ? FX.windows(sp, date, sport, spot, { kg: kg() })[0] : null, dayCrews = crews.filter(function (c) { return c.day === date; });
    var fav = favList().indexOf(spot.slug) >= 0;
    var call = '<div class="spotcall">' +
      (dayCrews.length ? '<div class="sc-k">' + esc(FX.dayName(date, S.today).toUpperCase()) + ' · ' + dayCrews.length + ' CREW' + (dayCrews.length > 1 ? 'S' : '') + ' GOING</div><div class="crews">' + dayCrews.map(crewCard).join('') + '</div>' : '') +
      (bw ? '<button class="big start" data-act="startwin" data-spot="' + esc(spot.slug) + '" data-sport="' + esc(sport) + '" data-date="' + date + '" data-from="' + bw.from + '" data-to="' + bw.to + '">' + (dayCrews.length ? 'OR START YOUR OWN · ' : 'START A CREW · ') + esc(FX.dayName(date, S.today).toUpperCase()) + ' ' + pad(bw.from) + '–' + pad(bw.to) + '<small>' + esc(bw.label) + (sport === 'kite' && bw.w ? ' · ' + Math.round(bw.w) + ' KT' : '') + ' · THE BEST WINDOW THAT DAY</small></button>'
        : (!dayCrews.length ? '<p class="hint" style="padding:0 0 4px">No good window ' + esc(FX.dayName(date, S.today).toLowerCase()) + '. Try another day.</p>' : '')) +
      '<div class="favrow"><button class="favbtn" data-act="fav" data-spot="' + esc(spot.slug) + '" aria-pressed="' + fav + '">' + (fav ? '★ YOUR SPOT' : '☆ SAVE AS YOUR SPOT') + '</button>' +
      (function () { var a = signedIn() ? myAlert(sport) : null, inA = a && a.spots.indexOf(spot.slug) >= 0;
        return '<button class="favbtn" data-act="alerts" data-sport="' + esc(sport) + '"' + (inA ? '' : ' data-spot="' + esc(spot.slug) + '"') + ' aria-pressed="' + !!inA + '">' + (inA ? '🔔 IN YOUR ALERT · EDIT' : '🔔 ALERT ME HERE') + '</button>'; })() + '</div></div>';
    var body = '<div class="hero"><div class="k">' + esc((spot.sports || []).filter(function (k) { return LIVE_SPORTS.indexOf(k) >= 0; }).map(function (k) { return SPORT[k].name.toUpperCase(); }).join(' · ')) + '</div><h2>' + esc(spot.name) + '</h2>' +
      (spot.note ? '<div class="when2" style="font-weight:400">' + esc(spot.note) + '</div>' : '') +
      (watchN(spot.slug) || (sport === 'kite' && !spot.lake && spot.good_from != null) ? '<div class="when2" style="color:var(--mint);margin-top:6px">' + [sport === 'kite' && !spot.lake && spot.good_from != null ? 'WORKS IN ' + FX.compass(spot.good_from) + ' TO ' + FX.compass(spot.good_to) : sport === 'kite' && spot.lake ? 'ANY WIND DIRECTION' : '', watchN(spot.slug) ? watchN(spot.slug) + ' RIDERS WATCH THIS SPOT' : ''].filter(Boolean).join(' · ') + '</div>' : '') + '</div>' +
      (crews.length ? '<div class="sec"><h2>CREWS HERE <small>' + crews.length + ' COMING UP</small></h2><div class="crews">' + crews.map(crewCard).join('') + '</div></div>' : '') + tabs + call + table +
      (reps.length ? '<div class="box"><h3>REPORTS · LAST HOURS</h3><div class="reports">' + reps.map(function (r) { return '<div class="rep"><span class="tag ' + (r.verdict === 'on' ? 'epic' : r.verdict === 'meh' ? 'ok' : 'no') + '">' + r.verdict.toUpperCase() + '</span><span>' + (r.kite ? 'on a ' + r.kite + ' m' : '') + (r.ground ? esc(r.ground) : '') + '</span><small>' + esc(ago(r.at)) + '</small></div>'; }).join('') + '</div></div>' : '') +
      (S.plans || []).filter(function (p) { return p.spot === spot.slug; }).map(function (p) { return '<div class="f"><button class="opt wide" data-act="plan" data-plan="' + esc(p.slug) + '"><span>PLAN: ' + esc(p.title.toUpperCase()) + '<small>' + esc(p.blurb.split('. ')[0]) + '.</small></span><span class="tag good">' + (p.interested ? p.interested + ' IN' : 'SEE IT') + '</span></button></div>'; }).join('') +
      (crews.length ? '' : '<div class="sec"><h2>CREWS HERE <small>NONE YET</small></h2><p class="lede">Nobody has posted a crew here yet. Start one and everyone near you sees it.</p></div>') +
      '<div class="f"><a class="big ghost" target="_blank" rel="noopener" href="' + esc(navUrls({ q: spot.maps || spot.name }).google) + '">DIRECTIONS</a></div>';
    var c0 = crews[0];
    return shell(esc(spot.name.toUpperCase()), body, c0 ? '<button class="big join" data-act="going" data-code="' + esc(c0.code) + '">JOIN ' + esc(String(c0.host).toUpperCase()) + '\'S CREW<small>' + esc(dayRel(c0.day) + ' ' + hm(c0.start)) + ' · ' + c0.going + ' going</small></button><button class="big ghost" data-act="startspot" data-spot="' + esc(spot.slug) + '" data-sport="' + esc(sport) + '" style="flex:0 0 34%">START ONE</button>'
      : '<button class="big start" data-act="startspot" data-spot="' + esc(spot.slug) + '" data-sport="' + esc(sport) + '">START A CREW HERE</button>', true);
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
      (me ? '' : '<div class="f"><span class="lb">YOU <small>so the organiser can reach you</small></span><label class="sr" for="plEmail">Email</label><input class="inp" id="plEmail" type="email" inputmode="email" autocomplete="email" placeholder="Email (only the app sees it)"></div>') +
      (f.err ? '<div class="err" role="alert">' + f.err + '</div>' : '') +
      '<div class="f"><div class="row">' + (liveSport ? '<button class="opt" data-act="startspot" data-spot="' + esc(p.spot) + '" data-sport="' + esc(p.kind) + '">START A CREW FOR IT</button>' : '') +
      (p.maps ? '<a class="opt" target="_blank" rel="noopener" href="' + esc(navUrls({ q: p.maps }).google) + '">DIRECTIONS</a>' : '') +
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
    var P = passPrices(), perks = '<ul class="perks"><li>' + P.member + '% Hi8 fee instead of ' + P.fee + '% on every shared ride</li><li>Crew rates at partner schools, shops, tracks and cable parks</li><li>Season stats: days out, euros saved</li></ul>';
    if (!(w.pass && w.pass.active) && !(w.live && S.settings && S.settings.fee_live === true)) return '<div class="box pass">' + passCard('me') + '</div>';
    if (w.pass && w.pass.active) return '<div class="box pass"><h3>HI8 PASS <span class="tag good">ON</span></h3><p class="hint" style="margin:0">' + (w.pass.plan === 'year' ? 'Yearly' : 'Monthly') + (w.pass.until ? ', renews ' + esc(dayLong(String(w.pass.until).slice(0, 10))) : '') + '. Cancel any time from the Stripe receipt email.</p>' + perks + '</div>';
    var fee = S.settings && S.settings.fee_live === true;
    var P2 = passPrices(), fOpen = S.settings && S.settings.pass_founding_open !== false, price = fOpen ? P2.founding : P2.month;
    return '<div class="box pass"><h3>HI8 PASS <span class="tag">' + euro(price) + ' A MONTH</span></h3>' + perks +
      (w.live && fee ? '<div class="row"><button class="opt" data-act="pass" data-plan="month">' + euro(price) + ' A MONTH<small>' + (fOpen ? 'founding price, kept for good · ' : '') + 'SEPA or card</small></button></div>'
        : '') + '</div>';
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
      (S.avatar ? '<img class="meav" src="' + esc(HI8.avatarUrl(S.avatar)) + '" alt="Your cartoon" width="72" height="72">' : '') +
      '<div><div style="font:400 30px/1 var(--big)">' + esc(m.name || '') + '</div><div class="hint">' + esc(m.email_hint || '') + (m.captain ? ' · captain' : '') + '</div></div></div>' +
      cartoonBox() + cardBox() + lookBox() + alertsBox() + profileBox() + squadsBox() + walletBox() + passBox() +
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
  // ---------------------------------------------------------------- 2.23 ALERTS: your conditions, your spots, on your phone
  var CFG = window.HI8_CONFIG || {};
  var PUSH = { sub: null, checked: false, busy: false, saved: false };
  function isIOS() { return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function isAndroid() { return /Android/i.test(navigator.userAgent); }
  function standalone() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  function inAppBrowser() { return /Instagram|FBAN|FBAV|FB_IAB|Line\/|Snapchat|TikTok|musical_ly|LinkedInApp/i.test(navigator.userAgent); }
  function pushSupported() { return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window; }
  // on | off | ios (add to home screen first) | inapp | denied | unsupported | nokey
  function vkey() { return CFG.vapidKey || (S.settings && S.settings.vapid_public) || ''; }
  function pushState() {
    if (!vkey()) return 'nokey';
    if (inAppBrowser()) return 'inapp';
    if (isIOS() && !standalone()) return 'ios';
    if (!pushSupported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'denied';
    return PUSH.sub ? 'on' : 'off';
  }
  function swReg() { return navigator.serviceWorker.register('sw.js', { scope: './' }); }
  function pushCheck() {
    if (!pushSupported()) { PUSH.checked = true; return Promise.resolve(null); }
    return navigator.serviceWorker.getRegistration('./').then(function (r) { return r ? r.pushManager.getSubscription() : null; })
      .then(function (s) { PUSH.sub = s; PUSH.checked = true; return s; }, function () { PUSH.checked = true; return null; });
  }
  function u8(b64) { var s = atob((b64 + '==='.slice((b64.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/')), a = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function pushSave(sub) {
    var j = sub.toJSON();
    return HI8.withKey('hi8_push_sub', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth, p_ua: isIOS() ? 'iPhone' : isAndroid() ? 'Android' : 'Computer' }, { noQueue: true })
      .then(function (r) { PUSH.saved = true; return r; });
  }
  function pushOn() {
    if (!signedIn()) { toast('First set an alert (it asks your email), then turn on push.', 5000); go('#alerts'); return; }
    if (PUSH.busy) return;
    PUSH.busy = true; renderSheet();
    Notification.requestPermission().then(function (p) {
      if (p !== 'granted') throw new Error(p === 'denied' ? 'denied' : 'dismissed');
      return swReg();
    }).then(function () { return navigator.serviceWorker.ready; }).then(function (reg) {
      return reg.pushManager.getSubscription().then(function (s) { return s || reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(vkey()) }); });
    }).then(function (sub) { PUSH.sub = sub; return pushSave(sub); }).then(function () {
      PUSH.busy = false; drawSessions(); renderSheet(); toast('Push is on for this phone. Send yourself a test to see one.', 5000);
    }, function (e) {
      PUSH.busy = false; renderSheet();
      toast(e && e.message === 'denied' ? 'Blocked on this phone: the steps to allow it are on this page.' : e && e.message === 'dismissed' ? 'Nothing changed: tap again and choose Allow.' : 'Push didn\'t turn on here: ' + esc(errText(e)), 6000);
    });
  }
  function pushOff() {
    var s = PUSH.sub; PUSH.sub = null; renderSheet(); drawSessions(); if (!s) return;
    var ep = s.endpoint; s.unsubscribe().catch(noop);
    if (signedIn()) HI8.withKey('hi8_push_unsub', { p_endpoint: ep }, { noQueue: true }).catch(noop);
    toast('Push is off on this phone. Your alerts come by email if you ticked it.', 5000);
  }
  function pushTest() {
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.showNotification('Hi8ctane · test', { body: 'This is how an alert shows up: the spot, the hours, the wind, and who\'s going.', icon: 'icon-192.png', badge: 'badge-72.png', tag: 'test', data: { url: location.origin + location.pathname + '#alerts' } });
    }).then(function () { toast('Sent. Look at the top of your screen (or your lock screen).'); }, function () { toast('The test didn\'t show: check notifications are allowed for this site.'); });
  }

  var HOURS = { all: [8, 20, 'ALL DAY', '08–20'], morning: [7, 13, 'MORNINGS', '07–13'], afternoon: [12, 19, 'AFTERNOONS', '12–19'], evening: [17, 21, 'AFTER WORK', '17–21'] };
  function windy(k) { return k === 'kite' || k === 'wing' || k === 'windsurf'; }
  function myAlert(sport) { return (S.walerts || []).filter(function (a) { return a.city === S.city && a.sport === sport; })[0] || null; }
  function loadAlerts() {
    if (!HI8.live || !signedIn()) return Promise.resolve();
    return HI8.withKey('hi8_wind_alerts', {}, { noQueue: true }).then(function (r) { S.walerts = r.alerts || []; drawSessions(); if (S.view === 'alerts' || S.view === 'me' || S.view === 'spot') renderSheet(); }, noop);
  }
  function hoursKey(a) { var k = Object.keys(HOURS).filter(function (x) { return HOURS[x][0] === a.from_h && HOURS[x][1] === a.to_h; })[0]; return k || 'all'; }
  function nearSpots(sport) { return spotsFor(S.city, sport).map(function (s) { return { s: s, m: driveFromMe(s) || 999 }; }).sort(function (a, b) { return a.m - b.m; }).map(function (x) { return x.s; }); }
  function newAlert(sport, spot) {
    var a = myAlert(sport);
    var favs = favList().filter(function (sl) { var x = HI8.spot(sl); return x && x.city === S.city && (x.sports || []).indexOf(sport) >= 0; });
    if (a) S.al = Object.assign({}, a, { spots: a.spots.slice(), saved: true });
    else S.al = { sport: sport, spots: favs.length ? favs : nearSpots(sport).slice(0, 2).map(function (s) { return s.slug; }), min_kt: windy(sport) ? 15 : null, max_kt: windy(sport) ? 30 : null,
      gust_max: windy(sport) ? 35 : null, days: 'any', from_h: 8, to_h: 20, min_hours: 2, min_score: 6, by_push: true, by_email: true, saved: false };
    if (spot && S.al.spots.indexOf(spot) < 0) { S.al.spots.push(spot); S.al.saved = false; }
    S.al.err = null; S.al.busy = false;
  }
  // what these settings would have sent this week (the same check the alert worker runs)
  function alertPreview(al) {
    if (!FX.data[S.city]) return null;
    var out = [];
    for (var i = 0; i < 7; i++) {
      var d = FX.addDays(S.today, i), best = null;
      al.spots.forEach(function (slug) {
        var sp = HI8.spot(slug), fs = fxSpot(slug); if (!sp || !fs) return;
        var ws = FX.alertWindows(fs, d, al.sport, sp, al, { kg: kg() });
        if (i === 0) ws = ws.filter(function (x) { return x.to - Math.max(x.from, S.nowH + 1) >= (al.min_hours || 2); });
        if (ws[0] && (!best || ws[0].score * Math.sqrt(ws[0].hours) > best.score * Math.sqrt(best.hours))) best = Object.assign({ spot: sp }, ws[0]);
      });
      if (best) out.push(best);
    }
    return out;
  }
  function alertLine(a) {
    var names = a.spots.map(function (s) { return (HI8.spot(s) || { name: s }).name; });
    return (names.length > 2 ? names.slice(0, 2).join(', ') + ' +' + (names.length - 2) : names.join(', ')) + ' · ' +
      (windy(a.sport) ? (a.min_kt != null ? a.min_kt : 10) + (a.max_kt != null ? '–' + a.max_kt : '+') + ' kt' : a.min_score >= 9 ? 'epic only' : 'good or better') +
      (a.days !== 'any' ? ' · ' + a.days + 's' : '') + ' · ' + pad(a.from_h) + '–' + pad(a.to_h);
  }
  function alertCta() {
    var a = signedIn() ? myAlert(S.sport) : null, st = pushState();
    if (a) return '<button class="alcta on" data-act="alerts"><span class="bell">' + BELL + '</span><span><b>ALERT ON · ' + esc(SPORT[S.sport].name.toUpperCase()) + '</b><small>' + esc(alertLine(a)) + ' · ' + (a.by_push && st === 'on' ? 'PUSH' : '') + (a.by_push && st === 'on' && a.by_email ? ' + ' : '') + (a.by_email || !(a.by_push && st === 'on') ? 'EMAIL' : '') + '</small></span><i>EDIT</i></button>';
    return '<button class="alcta" data-act="alerts"><span class="bell">' + BELL + '</span><span><b>TELL ME WHEN IT\'S ON</b><small>Your ' + (windy(S.sport) ? 'wind' : 'conditions') + ', your spots, your hours. One message: the evening before or that morning.</small></span><i>SET IT</i></button>';
  }
  var BELL = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2.4" stroke-linejoin="round" aria-hidden="true"><path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z"/><path d="M10 21h4" stroke-linecap="round"/></svg>';
  function sheetAlerts() {
    if (!S.al) newAlert(S.sport);
    var al = S.al, sp = al.sport, W = windy(sp), spots = nearSpots(sp), st = pushState(), mine = myAlert(sp);
    var chip = function (act, v, label, on, sub) { return '<button class="opt" data-act="' + act + '" data-v="' + v + '" aria-pressed="' + on + '">' + label + (sub ? '<small>' + sub + '</small>' : '') + '</button>'; };
    var f = function (lb, html, sub) { return '<div class="f"><span class="lb">' + lb + (sub ? ' <small>' + sub + '</small>' : '') + '</span>' + html + '</div>'; };
    var head = '<div class="hero"><div class="k">' + BELL.replace('#111', '#8DF5E8') + ' WHEN IT\'S ON, YOU KNOW</div><h2>Your conditions. Your spots.</h2><div class="when2" style="font-weight:400">One message a day at most per sport: the evening before (18–22h) or that morning. Checked against the forecast every 10 minutes.</div></div>';
    var tabs = '<div class="tabs" role="group" aria-label="Sport">' + LIVE_SPORTS.map(function (k) { return '<button class="tab" data-act="alsport" data-sport="' + k + '" aria-pressed="' + (k === sp) + '">' + esc(SPORT[k].name.toUpperCase()) + (myAlert(k) ? ' ●' : '') + '</button>'; }).join('') + '</div>';
    var pSpots = f('SPOTS', '<div class="row">' + spots.map(function (s) {
      var m = driveFromMe(s), dir = W ? (s.lake ? 'any direction' : s.good_from != null ? FX.compass(s.good_from) + ' to ' + FX.compass(s.good_to) : '') : '';
      return chip('alspot', s.slug, esc(s.name.toUpperCase()), al.spots.indexOf(s.slug) >= 0, (m ? m + ' MIN' : '') + (m && dir ? ' · ' : '') + dir);
    }).join('') + '</div>', W ? 'the wind direction is checked for each one' : '');
    var pCond = W ? f('WIND FROM', '<div class="row">' + [12, 15, 18, 20, 25].map(function (k) { return chip('almin', k, k + ' KT', al.min_kt === k); }).join('') + '</div>') +
        f('UP TO', '<div class="row">' + [25, 30, 35].map(function (k) { return chip('almax', k, k + ' KT', al.max_kt === k); }).join('') + chip('almax', '', 'NO LIMIT', al.max_kt == null) + '</div>') +
        f('GUSTS UP TO', '<div class="row">' + [30, 35, 40].map(function (k) { return chip('algust', k, k + ' KT', al.gust_max === k); }).join('') + chip('algust', '', 'ANY', al.gust_max == null) + '</div>',
          al.min_kt != null && FX.kiteSize(al.min_kt, kg()) ? 'at ' + al.min_kt + ' kt you\'re on ' + (/^(8|11|18)$/.test(String(FX.kiteSize(al.min_kt, kg()))) ? 'an ' : 'a ') + FX.kiteSize(al.min_kt, kg()) + ' m (' + kg() + ' kg)' : '')
      : f('RATED AT LEAST', '<div class="row">' + chip('alscore', 6, 'GOOD', al.min_score < 9, sp === 'mtb' ? 'dry enough, not too hot' : 'a good day on the track') + chip('alscore', 9, 'EPIC', al.min_score >= 9, sp === 'mx' ? 'tacky: hero dirt' : 'dry, 10-24°C') + '</div>');
    var pDays = f('DAYS', '<div class="row">' + [['any', 'ANY DAY'], ['weekend', 'WEEKENDS'], ['weekday', 'WEEKDAYS']].map(function (x) { return chip('aldays', x[0], x[1], al.days === x[0]); }).join('') + '</div>');
    var hk = hoursKey(al);
    var pHours = f('HOURS', '<div class="row">' + Object.keys(HOURS).map(function (k) { return chip('alhours', k, HOURS[k][2], hk === k, HOURS[k][3]); }).join('') + '</div>');
    var pLen = f('FOR AT LEAST', '<div class="row">' + [1, 2, 3, 4].map(function (k) { return chip('allen', k, k + (k === 1 ? ' HOUR' : ' HOURS'), al.min_hours === k); }).join('') + '</div>');
    // H10: three ready-made starts; the detail stays one tap away (the same chips as before)
    var PRE = { wknd: ['weekend', 'all', 'WEEKENDS', 'all day, 2+ hours'], work: ['weekday', 'evening', 'AFTER WORK', 'weekdays 17–21'], any: ['any', 'all', 'ANY GOOD DAY', 'all day, 2+ hours'] };
    var preOn = function (k) { return al.days === PRE[k][0] && hk === PRE[k][1] && al.min_hours === 2; };
    var pPre = f('WHEN DO YOU RIDE?', '<div class="row">' + Object.keys(PRE).map(function (k) { return chip('alpre', k, PRE[k][2], preOn(k), PRE[k][3]); }).join('') + '</div>');
    var sum = (W ? (al.min_kt + (al.max_kt ? '–' + al.max_kt : '+') + ' kt' + (al.gust_max ? ', gusts up to ' + al.gust_max : '')) : (al.min_score >= 9 ? 'epic days' : 'good days')) + ' · ' +
      { any: 'any day', weekend: 'weekends', weekday: 'weekdays' }[al.days] + ' · ' + HOURS[hk][3] + ' · ' + al.min_hours + '+ h';
    var pTune = al.tune ? pCond + pDays + pHours + pLen + '<div class="f"><button class="lnk" data-act="altune">HIDE THE DETAIL</button></div>'
      : '<div class="f altune"><span class="lb">THE DETAIL</span><p class="hint" style="margin:0 0 8px">' + esc(sum) + '</p><button class="opt" data-act="altune">' + (W ? 'WIND, GUSTS, HOURS' : 'RATING, HOURS') + ' ▾</button></div>';
    var P = alertPreview(al), prev;
    if (!P) prev = '<div class="box alprev"><h3>THIS WEEK</h3><p class="hint" style="margin:0"><span class="spin"></span> Loading the forecast…</p></div>';
    else prev = '<div class="box alprev"><h3>THIS WEEK YOU\'D GET <span class="tag ' + (P.length ? 'good' : 'none') + '">' + P.length + ' ALERT' + (P.length === 1 ? '' : 'S') + '</span></h3>' +
      (P.length ? P.map(function (w) {
        return '<button class="alrow" data-act="spotat" data-spot="' + w.spot.slug + '" data-date="' + w.date + '"><b>' + esc(dayRel(w.date)) + '</b><span>' + esc(w.spot.name) + ' · ' + pad(w.from) + '–' + pad(w.to) + '</span><em>' +
          esc(W ? (w.wmin === w.wmax ? w.w : w.wmin + '–' + w.wmax) + ' KT ' + FX.compass(w.dir) : w.label + (w.ground ? ' · ' + w.ground.toUpperCase() : '')) + '</em></button>';
      }).join('') : '<p class="hint" style="margin:0">Nothing this week with these settings' + (W && al.min_kt > 12 ? ': a lower minimum would catch more.' : '.') + ' The alert still waits for the day it\'s on.</p>') +
      '<p class="hint">From the forecast right now. It changes: the alert goes out on the forecast of the evening before or that morning.</p></div>';
    var pushTxt = { on: 'ON ON THIS PHONE ✓', off: 'NOT SET UP ON THIS PHONE YET', ios: 'IPHONE: ADD TO HOME SCREEN FIRST', inapp: 'OPEN IN SAFARI OR CHROME FIRST', denied: 'BLOCKED ON THIS PHONE', unsupported: 'THIS BROWSER CAN\'T', nokey: 'COMING SOON' }[st];
    var pHow = f('HOW YOU HEAR IT', '<div class="row">' + chip('alpush', '', 'PUSH', al.by_push, pushTxt) + chip('almail', '', 'EMAIL', al.by_email, 'with a stop link in every one') + '</div>' +
      (al.by_push && st !== 'on' ? '<button class="pushset" data-act="pushguide"><b>' + (st === 'off' ? 'TURN ON PUSH: ONE TAP →' : st === 'ios' ? 'HOW TO GET PUSH ON IPHONE (1 MIN) →' : st === 'denied' ? 'HOW TO ALLOW IT AGAIN →' : 'HOW PUSH WORKS →') + '</b><small>' +
        (st === 'nokey' || st === 'unsupported' || st === 'inapp' ? 'Until then, it comes by email.' : 'Until it\'s on, the alert comes by email.') + '</small></button>' : ''));
    var pYou = signedIn() ? '' : f('YOUR EMAIL', '<label class="sr" for="alEmail">Email</label><input class="inp" id="alEmail" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com"><p class="hint">Where the alert goes until push is on. Only the app sees your email.</p>');
    var body = head + tabs + pPre + pSpots + pTune + prev + pHow + pYou +
      (al.err ? '<div class="err" role="alert">' + al.err + '</div>' : '') +
      (mine ? '<div class="f"><button class="lnk" data-act="aloff">TURN OFF MY ' + esc(SPORT[sp].name.toUpperCase()) + ' ALERT</button></div>' : '');
    var foot = '<button class="big start" data-act="alsave"' + (al.busy || (al.saved && mine) ? ' disabled' : '') + '>' + (al.busy ? '<span class="spin"></span>' : al.saved && mine ? 'SAVED ✓' : mine ? 'SAVE CHANGES' : 'SET MY ALERT') + '</button>';
    return shell('ALERTS', body, foot, true);
  }
  function alertSave() {
    var al = S.al; if (!al || al.busy) return;
    if (!al.spots.length) { al.err = 'Pick at least one spot.'; renderSheet(); return; }
    if (!al.by_push && !al.by_email) { al.err = 'Pick push, email or both.'; renderSheet(); return; }
    var rule = { spots: al.spots, min_kt: al.min_kt, max_kt: al.max_kt, gust_max: al.gust_max, days: al.days, from_h: al.from_h, to_h: al.to_h, min_hours: al.min_hours, min_score: al.min_score, by_push: al.by_push, by_email: al.by_email };
    var ready;
    if (signedIn()) ready = Promise.resolve();
    else {
      var em = (($('#alEmail') || {}).value || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { al.err = "Add your email: that's where alerts go until push is on."; renderSheet(); return; }
      ready = HI8.rpc('hi8_alert_signup', { p_email: em, p_city: S.city, p_sport: al.sport, p_source: src().source || 'alert', p_ref: src().ref || null }).then(function (out) { HI8.saveMe(out); al.plate = out.plate; drawTop(); HI8.loadMine(true).catch(noop); });
    }
    al.busy = true; al.err = null; renderSheet();
    ready.then(function () { return HI8.withKey('hi8_wind_alert', { p_city: S.city, p_sport: al.sport, p_rule: rule, p_on: true }, { noQueue: true }); }).then(function (r) {
      S.walerts = r.alerts || []; al.busy = false; al.saved = true; drawSessions(); renderSheet();
      if (PUSH.sub && !PUSH.saved) pushSave(PUSH.sub).catch(noop);
      var st = pushState();
      toast((al.plate ? 'Founding plate #' + pad3(al.plate) + ' is yours. ' : '') + (al.by_push && st !== 'on' ? 'Saved. Push isn\'t on for this phone yet: until it is, the alert comes by email.' : 'Saved. You hear it the evening before or that morning.'), 6000); al.plate = null;
    }, function (e) { al.busy = false; al.err = errText(e); renderSheet(); });
  }
  var SHARE_I = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#0A6CFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-label="the Share icon"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5"/><path d="M8.5 10H6.5a1.5 1.5 0 0 0-1.5 1.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5h-2"/></svg>';
  var ADD_I = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#111" stroke-width="2.2" stroke-linecap="round" aria-label="the Add icon"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>';
  function steps(list) { return '<ol class="psteps">' + list.map(function (x, i) { return '<li><b>' + (i + 1) + '</b><span>' + x + '</span></li>'; }).join('') + '</ol>'; }
  function sheetPush() {
    var st = pushState(), body, foot = '';
    var head = '<div class="hero"><div class="k">' + BELL.replace('#111', '#8DF5E8') + ' PUSH · NO APP NEEDED</div><h2>Alerts on your phone</h2>' +
      '<div class="when2" style="font-weight:400">A message on your lock screen, like a text, from hi8ctane.com. You get one when your alert hits or when a crew you\'re in changes. Nothing from the app store.</div></div>';
    var state = { on: ['good', 'ON FOR THIS PHONE'], off: ['ok', 'ONE TAP AWAY'], ios: ['ok', 'IPHONE: 3 STEPS'], inapp: ['no', 'OPEN IN YOUR BROWSER FIRST'], denied: ['no', 'BLOCKED: 4 TAPS TO FIX'], unsupported: ['no', 'NOT IN THIS BROWSER'], nokey: ['none', 'COMING SOON'] }[st];
    var how;
    if (st === 'on') {
      how = '<p class="hint" style="margin:0 0 10px">It\'s set. Send yourself a test to see how an alert looks.</p><div style="display:grid;gap:8px"><button class="big ghost" data-act="pushtest">SEND ME A TEST</button><button class="opt" data-act="pushoff">TURN PUSH OFF ON THIS PHONE</button></div>';
    } else if (st === 'off') {
      how = steps(['Tap <b>TURN ON PUSH</b> below.', 'Your ' + (isIOS() ? 'iPhone' : isAndroid() ? 'phone' : 'browser') + ' asks if hi8ctane.com may send notifications: tap <b>Allow</b>.', 'Done. Send yourself a test to see one.']) +
        (signedIn() ? '' : '<p class="hint">First set an alert: it asks your email, so we know whose phone this is.</p>');
      foot = signedIn() ? '<button class="big start" data-act="pushon"' + (PUSH.busy ? ' disabled' : '') + '>' + (PUSH.busy ? '<span class="spin"></span>' : 'TURN ON PUSH') + '</button>' : '<button class="big start" data-act="alerts">SET AN ALERT FIRST</button>';
    } else if (st === 'ios') {
      how = steps(['In <b>Safari</b>, tap <b>Share</b> ' + SHARE_I + '. Don\'t see it? Tap <b>⋯</b> next to the address first.', 'Scroll down, tap <b>Add to Home Screen</b> ' + ADD_I + ', then <b>Add</b>.', 'Open <b>Hi8ctane</b> from your home screen, set your alert there (just your email) and tap <b>TURN ON PUSH</b>. Then tap <b>Allow</b>.']) +
        '<p class="hint">Why: on iPhone, only sites on your home screen may send notifications (iOS 16.4 or newer: Settings › General › About › iOS Version). It opens full screen, like an app. Your alerts by email keep working meanwhile.</p>';
      foot = '<button class="big ghost" data-act="copy" data-text="https://hi8ctane.com/">COPY THE LINK FOR SAFARI</button>';
    } else if (st === 'inapp') {
      how = steps(['Tap <b>⋯</b> or <b>⋮</b> (top right of this screen).', 'Choose <b>Open in browser</b> (or Open in Safari / Chrome).', 'Come back to Alerts there and turn on push.']) + '<p class="hint">Apps like Instagram open links in their own browser, and that one can\'t keep notifications.</p>';
      foot = '<button class="big ghost" data-act="copy" data-text="https://hi8ctane.com/#alerts">COPY THE LINK</button>';
    } else if (st === 'denied') {
      how = isIOS() ? steps(['Open <b>Settings</b> on your iPhone.', 'Tap <b>Notifications</b>, then <b>Hi8ctane</b>.', 'Switch on <b>Allow Notifications</b>.', 'Come back here and tap TURN ON PUSH.'])
        : isAndroid() ? steps(['In Chrome, tap <b>⋮</b> › <b>Settings</b> › <b>Site settings</b> › <b>Notifications</b>.', 'Find <b>hi8ctane.com</b> under Blocked and tap it.', 'Choose <b>Allow</b>.', 'Come back here and tap TURN ON PUSH.'])
        : steps(['Click the icon left of the address (the lock or the sliders).', 'Find <b>Notifications</b> and set it to <b>Allow</b>.', 'Reload this page.', 'Tap TURN ON PUSH.']);
      foot = '<button class="big start" data-act="pushon">TURN ON PUSH</button>';
    } else if (st === 'unsupported') {
      how = '<p class="hint" style="margin:0">This browser can\'t do push. On a phone, open hi8ctane.com in ' + (isAndroid() ? 'Chrome' : 'Safari (iPhone) or Chrome (Android)') + '. Your alerts by email work the same, with a stop link in each one.</p>';
    } else how = '<p class="hint" style="margin:0">Push is almost ready on our side. Until then your alerts come by email, with a stop link in each one.</p>';
    body = head + '<div class="box"><h3>ON THIS PHONE <span class="tag ' + state[0] + '">' + state[1] + '</span></h3>' + how + '</div>' +
      '<div class="box"><h3>FAIR QUESTIONS</h3><div class="faq"><b>How many?</b><span>At most one wind alert a day per sport. Crew messages only for crews you\'re in.</span>' +
      '<b>Battery, data?</b><span>Nothing runs on your phone. It arrives like a text.</span><b>Stop it?</b><span>Here, in your phone\'s settings, or with the stop link in any email.</span>' +
      '<b>Who sees my phone?</b><span>Nobody. We keep an address your browser gives us for this site, nothing else.</span></div></div>' +
      '<div class="f"><button class="lnk" data-act="alerts">← MY ALERTS</button></div>';
    return shell('PUSH', body, foot, true);
  }

  // ---------------------------------------------------------------- 2.23 trust: your rider profile, the crew's people
  function loadPeople() {
    var C = S.crew; if (!C || !C.data || !C.data.me || !HI8.live) return;
    HI8.withKey('hi8_crew_people', { p_code: C.code }, { noQueue: true }).then(function (p) { if (S.crew === C) { C.people = p; renderSheet(); } }, noop);
  }
  function personOf(m) { var P = (S.crew && S.crew.people) || []; return P.filter(function (x) { return x.member_id === m.member_id; })[0] || null; }
  function loadProf(force) {
    if (!signedIn() || !HI8.live) return Promise.resolve(null);
    if (S.profP && !force) return S.profP;
    S.profP = HI8.withKey('hi8_rider_profile', {}, { noQueue: true }).then(function (r) { S.prof = r || {}; return S.prof; }, function () { return null; }); // a failure stays failed until the next visit (no retry loop)
    return S.profP;
  }
  function cardMade() { return !!(S.prof && S.prof.card_public != null); }
  function profileBox() {
    var p = S.prof; if (!p) { if (!S.profP) loadProf().then(function (r) { if (r && S.view === 'me') renderSheet(); }); return ''; }
    return '<div class="box"><h3>YOUR RIDER CARD <span class="tag ' + (cardMade() ? 'good' : 'ok') + '">' + (!cardMade() ? 'NOT MADE YET' : p.card_public ? 'RIDERS DECIDING TO JOIN SEE IT' : 'ONLY YOUR CREWS') + '</span></h3>' + myCardPreview(p) +
      '<button class="big ' + (cardMade() ? 'dark' : 'start') + '" data-act="mycard" style="width:100%;margin-top:10px;font-size:17px">' + (cardMade() ? 'EDIT MY CARD' : 'MAKE MY CARD · 1 MIN') + '</button></div>';
  }
  // ---- 2.26 MAKE YOUR RIDER CARD: your face (a cartoon of your selfie), a line, and who sees it. Your choice, every part.
  function sheetCard() {
    if (!signedIn()) return shell('YOUR CARD', '<div class="hero"><div class="k">YOUR RIDER CARD</div><h2>First, your rider number</h2><div class="when2" style="font-weight:400">Your card belongs to your rider number: join a crew or set an alert, then make it.</div></div>', '<button class="big start" data-act="alerts">SET AN ALERT</button>', true);
    var p = S.prof;
    if (!p) { if (!S.profP) loadProf().then(function (r) { if (r && S.view === 'card') renderSheet(); }); return shell('YOUR CARD', '<div class="skel" style="height:300px;margin:16px"></div>', '', true); }
    var f = S.cf || (S.cf = { who: p.card_public == null ? null : p.card_public });
    var spots = HI8.spotsOf(S.city).filter(function (x) { return (x.sports || []).some(function (k) { return LIVE_SPORTS.indexOf(k) >= 0; }); });
    var step = function (n, title, sub, body, done) { return '<div class="cstep' + (done ? ' done' : '') + '"><div class="cs-h"><b>' + (done ? '✓' : n) + '</b><span>' + title + (sub ? '<small>' + sub + '</small>' : '') + '</span></div>' + body + '</div>'; };
    var face = S.cartoonsOn ? cartoonBox().replace('<div class="box ct"><h3>YOUR CARTOON <span class="tag">NEW</span></h3>', '<div class="ct ct-in">').replace(/<h3>YOUR CARTOON[^<]*<span class="tag">NEW<\/span><\/h3>/, '')
      : '<p class="hint" style="margin:0">Cartoons are almost ready. Until then, your card shows your first letter.</p>';
    var about = '<label><span class="lb">A LINE ABOUT YOU</span><input class="inp" id="prLine" maxlength="70" value="' + esc(f.line != null ? f.line : p.tagline || '') + '" placeholder="e.g. Early mornings, big air, coffee after"></label>' +
      '<div class="two" style="margin-top:8px"><label><span class="lb">YEARS RIDING</span><input class="inp" id="prYears" type="number" inputmode="numeric" min="0" max="60" value="' + (f.years != null ? f.years : p.years != null ? p.years : '') + '" placeholder="e.g. 4"></label>' +
      '<label><span class="lb">HOME SPOT</span><select class="inp" id="prHome"><option value="">–</option>' + spots.map(function (x) { var hs = f.home != null ? f.home : p.home_spot; return '<option value="' + x.slug + '"' + (hs === x.slug ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select></label></div>' +
      '<label><span class="lb" style="margin-top:8px">INSTAGRAM <small>only your crews see it</small></span><input class="inp" id="prInsta" autocapitalize="off" autocomplete="off" maxlength="40" value="' + esc(f.insta != null ? f.insta : p.insta ? '@' + p.insta : '') + '" placeholder="@yourname"></label>';
    var who = '<div class="cwho" role="radiogroup" aria-label="Who sees your card">' +
      '<button class="opt" role="radio" data-act="cardwho" data-v="1" aria-pressed="' + (f.who === true) + '" aria-checked="' + (f.who === true) + '"><b>RIDERS DECIDING TO JOIN</b><small>Before they join your crew they see your cartoon, years, home spot, your line and how much you ride. Never your name: that\'s for your crew.</small></button>' +
      '<button class="opt" role="radio" data-act="cardwho" data-v="0" aria-pressed="' + (f.who === false) + '" aria-checked="' + (f.who === false) + '"><b>ONLY MY CREWS</b><small>Outside your crews, riders see your first letter and level. Inside, your whole card.</small></button></div>' +
      '<p class="hint">Change it any time in Me.</p>';
    var prev = Object.assign({}, p, { tagline: f.line != null ? f.line : p.tagline });
    var body = '<div class="hero"><div class="k">YOUR RIDER CARD · ABOUT A MINUTE</div><h2>Ride with people you\'ve seen</h2><div class="when2" style="font-weight:400">Before anyone rides with you, they see your card, and you see theirs. Make yours: a cartoon of you, a line, and you choose who sees it.</div></div>' +
      '<div class="box"><h3>HOW IT LOOKS</h3>' + myCardPreview(prev) + '</div>' +
      step(1, 'YOUR FACE', 'a selfie, drawn as a salty surf cartoon. Optional', face, !!S.avatar) +
      step(2, 'ABOUT YOU', 'all optional', about, !!(p.tagline || p.years != null || p.home_spot)) +
      step(3, 'WHO SEES IT', 'you decide', who, f.who != null) +
      (f.err ? '<div class="err" role="alert">' + esc(f.err) + '</div>' : '');
    var foot = '<button class="big start" data-act="cardsave"' + (f.busy ? ' disabled' : '') + '>' + (f.busy ? '<span class="spin"></span>' : cardMade() ? 'SAVE MY CARD' : 'MAKE MY CARD') + '</button>';
    return shell('YOUR CARD', body, foot, true);
  }
  function cardKeep() { // keep what was typed when the sheet redraws (a cartoon arrives, a choice is tapped)
    var f = S.cf; if (!f) return;
    var g = function (id) { var e = $('#' + id); return e ? e.value : null; };
    if (g('prLine') != null) { f.line = g('prLine'); f.years = g('prYears'); f.home = g('prHome'); f.insta = g('prInsta'); }
  }
  function cardSave() {
    cardKeep(); var f = S.cf, p = S.prof || {}; if (!f || f.busy) return;
    if (f.who == null) { f.err = 'One more thing: choose who sees your card (step 3).'; renderSheet(); return; }
    var yv = f.years != null ? f.years : (p.years != null ? String(p.years) : '');
    f.busy = true; f.err = null; renderSheet();
    HI8.withKey('hi8_rider_profile', { p_save: true, p_years: yv === '' ? null : Number(yv), p_home_spot: (f.home != null ? f.home : p.home_spot) || null,
      p_insta: (f.insta != null ? f.insta : p.insta) || null, p_tagline: (f.line != null ? f.line : p.tagline) || null, p_card_public: f.who }, { noQueue: true }).then(function (r) {
      S.prof = r; S.profP = Promise.resolve(r); S.cf = null;
      toast(r.card_public ? 'Your card is out there. Riders deciding to join see it.' : 'Your card is made. Only your crews see it.', 5000);
      if (S.cardFrom) { var code = S.cardFrom; S.cardFrom = null; openCrew(code); } else go('#me');
    }, function (e) { f.busy = false; f.err = errText(e); renderSheet(); });
  }
  function alertsBox() {
    var A = (S.walerts || []).filter(function (a) { return a.city === S.city; }), st = pushState();
    return '<div class="box"><h3>YOUR ALERTS <span class="tag ' + (st === 'on' ? 'good' : 'none') + '">PUSH ' + (st === 'on' ? 'ON' : 'OFF') + '</span></h3>' +
      (A.length ? '<div class="row">' + A.map(function (a) { return '<button class="opt wide" data-act="alerts" data-sport="' + a.sport + '"><span>' + esc(SPORT[a.sport].name.toUpperCase()) + '<small>' + esc(alertLine(a)) + '</small></span><span class="tag good">EDIT</span></button>'; }).join('') + '</div>'
        : '<p class="hint" style="margin:0 0 8px">None yet: tell us your wind and your spots, we tell you when it\'s on.</p>') +
      '<div class="row" style="margin-top:8px"><button class="opt" data-act="alerts">' + (A.length ? '+ ANOTHER SPORT' : 'SET AN ALERT') + '</button><button class="opt" data-act="pushguide">PUSH ON THIS PHONE</button></div></div>';
  }
  // the next good window at this crew's spot, after the session (for "go again")
  function nextWindowAt(spotSlug, sport, fromDate) {
    var sp = HI8.spot(spotSlug), fs = fxSpot(spotSlug); if (!sp || !fs) return null;
    for (var i = 0; i < 7; i++) {
      var d = FX.addDays(S.today, i); if (fromDate && d < fromDate) continue;
      var w = FX.windows(fs, d, sport, sp, fxo(sport)).map(function (x) { return d === S.today ? Object.assign({}, x, { from: Math.max(x.from, S.nowH + 1) }) : x; }) // today: what's still ahead
        .filter(function (x) { return x.score >= 6 && x.to - x.from >= 2; })[0];
      if (w) return w;
    }
    return null;
  }
  // ---- YOUR CARTOON (2.18): a selfie, drawn as a surf-mag cartoon by an image AI; only the cartoon is kept
  var CT = { step: 'idle', photo: null, consent: false, err: '', left: null };
  function loadAvatarKeep() { if (S.view === 'card') cardKeep(); }
  function loadAvatar() {
    if (!signedIn() || !HI8.live) return Promise.resolve(null);
    return HI8.withKey('hi8_my_avatar', {}, { noQueue: true }).then(function (r) {
      var was = S.avatar; S.avatar = r && r.path || null; S.cartoonsOn = !!(r && r.on);
      if (was !== S.avatar) drawTop();
      if (S.view === 'me' || S.view === 'card') { loadAvatarKeep(); renderSheet(); } return r;
    }, function () { return null; });
  }
  function cartoonBox() {
    if (!HI8.live || !S.cartoonsOn) return '';
    var head = '<h3>YOUR CARTOON <span class="tag">NEW</span></h3>';
    var pick = '<div class="row ctpick"><label class="opt ctbtn"><input type="file" accept="image/*" capture="user" data-change="selfie" class="sr">TAKE A SELFIE</label>' +
      '<label class="opt ctbtn"><input type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" data-change="selfie" class="sr">PICK A PHOTO</label></div>';
    if (CT.step === 'busy') return '<div class="box ct">' + head + '<div class="ctstage"><div class="ctframe drawing"><img src="' + CT.photo + '" alt=""><span class="ctpen" aria-hidden="true"></span></div>' +
      '<p class="lede" role="status" aria-live="polite"><span class="spin"></span> <b id="ctMsg">Drawing you…</b><br><span class="hint">Takes about 30 seconds. Keep this open.</span></p></div></div>';
    if (CT.step === 'photo') return '<div class="box ct">' + head + '<div class="ctstage"><div class="ctframe"><img src="' + CT.photo + '" alt="Your photo"></div>' +
      '<div><label class="ckline"><input type="checkbox" data-change="ctconsent"' + (CT.consent ? ' checked' : '') + '> <span>Send this photo to OpenAI to draw my cartoon. Hi8ctane keeps only the cartoon, never the photo. The cartoon goes on my rider card.</span></label>' +
      (CT.err ? '<p class="err" role="alert">' + esc(CT.err) + '</p>' : '') +
      '<div class="row"><button class="jn lm" data-act="ctdraw"' + (CT.consent ? '' : ' disabled') + '>DRAW ME</button><button class="jn wh" data-act="ctcancel">CANCEL</button></div></div></div></div>';
    if (S.avatar) return '<div class="box ct">' + head + '<div class="ctstage"><div class="ctframe done"><img src="' + esc(HI8.avatarUrl(S.avatar)) + '" alt="Your cartoon"></div>' +
      '<div><p class="hint" style="margin-top:0">It\'s the picture on your rider card: riders deciding to join see it (not your name), your crew sees it next to your name.' + (S.prof && S.prof.card_public === false ? ' Your card is set to just the basics: outside your crews, only your initials show.' : '') + '</p>' + (CT.err ? '<p class="err" role="alert">' + esc(CT.err) + '</p>' : '') +
      '<p class="hint" style="margin:8px 0 4px">New one?' + (CT.left != null ? ' ' + CT.left + ' left today.' : '') + '</p>' + pick + '<button class="lnk" data-act="ctremove" style="margin-top:8px">Remove my cartoon</button></div></div></div>';
    return '<div class="box ct">' + head + '<div class="ctstage"><div class="ctframe empty" aria-hidden="true"><span>?</span></div><div><p class="hint" style="margin-top:0">Snap a selfie and we draw you as a salty surf-mag cartoon: sun-bleached, sea-spray, ready to ride. It\'s the picture on your rider card.</p>' +
      (CT.err ? '<p class="err" role="alert">' + esc(CT.err) + '</p>' : '') + pick + '</div></div></div>';
  }
  // the photo: turned upright, cropped square around the middle, 1024 px, JPEG (so a 12 MB phone photo goes up as ~200 KB)
  function prepSelfie(file) {
    var load = window.createImageBitmap ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return null; }) : Promise.resolve(null);
    return load.then(function (bm) {
      return bm || new Promise(function (res, rej) { var u = URL.createObjectURL(file), im = new Image(); im.onload = function () { res(im); }; im.onerror = function () { rej(new Error('bad_photo')); }; im.src = u; });
    }).then(function (im) {
      var w = im.width || im.naturalWidth, h = im.height || im.naturalHeight, side = Math.min(w, h);
      if (side < 256) throw new Error('small_photo');
      var sx = (w - side) / 2, sy = Math.max(0, (h - side) / 2 - (h > w ? side * 0.08 : 0)); // portrait: a little above the middle, where faces are
      var cv = document.createElement('canvas'), N = Math.min(1024, side); cv.width = cv.height = N;
      cv.getContext('2d').drawImage(im, sx, sy, side, side, 0, 0, N, N);
      return cv.toDataURL('image/jpeg', 0.86);
    });
  }
  var CT_MSGS = ['Drawing you…', 'Inking the outlines…', 'Wind in the hair…', 'Adding the sun…', 'Almost there…'];
  function ctDraw() {
    CT.step = 'busy'; CT.err = ''; renderSheet();
    var i = 0, tick = setInterval(function () { var m = $('#ctMsg'); i = Math.min(i + 1, CT_MSGS.length - 1); if (m) m.textContent = CT_MSGS[i]; }, 7000);
    HI8.fn('cartoon', { key: HI8.me().key, image: CT.photo, consent: true }).then(function (r) {
      clearInterval(tick); S.avatar = r.path; CT = { step: 'idle', photo: null, consent: false, err: '', left: CT.left == null ? 2 : Math.max(0, CT.left - 1) };
      drawTop(); renderSheet(); toast('There you are. Your crew will see this one.', 4000);
    }, function (e) {
      clearInterval(tick); CT.step = 'photo'; CT.err = e && e.hint || errText(e);
      // no function deployed yet answers 404, or fails the browser's CORS check (looks like no connection): not the rider's fault
      if (e && (e.status === 404 || (HI8.unreachable(e) && navigator.onLine !== false))) CT.err = 'Cartoons are being switched on. Try again in a few minutes.';
      if (e && e.message === 'slow_down') { CT.left = 0; CT.err = 'That\'s 3 cartoons today. Try again tomorrow.'; }
      renderSheet();
    });
  }

  // ---- YOUR LEVEL: what the ratings are for (and the safety caps), per sport, on this phone
  function sheetLevel() {
    var k = S.sport, cur = lvSet(k);
    var opts = [['rookie', 'LEARNING', k === 'kite' ? "can't launch, ride upwind or self-rescue on my own yet" : "still learning: ride with someone who knows"],
      ['regular', 'INDEPENDENT', k === 'kite' ? 'I launch, ride upwind and get back in on my own' : 'I ride on my own'], ['ripper', 'RIPPER', 'advanced: strong wind, waves, jumps']];
    return shell('YOUR LEVEL · ' + esc(SPORT[k].name.toUpperCase()), '<div class="sec"><p class="lede">Every EPIC, GOOD, OK and NO GO on the page is for your level. Gusty, onshore or uncertain sessions are capped harder for learners. Stays on this phone.</p>' +
      '<div class="row" style="margin:12px 0">' + opts.map(function (o) { return '<button class="opt wide" data-act="lvset" data-v="' + o[0] + '" aria-pressed="' + (cur === o[0]) + '"><span>' + o[1] + '<small>' + esc(o[2]) + '</small></span></button>'; }).join('') + '</div>' +
      (cur === 'rookie' ? '<p class="hint">Learners ride in crews run by an approved captain. Ask a school in the meantime: <a href="schools/">schools near you</a>.</p>' : '') + '</div>' + (k === 'kite' ? kgBox() : ''),
      '<button class="big join" data-act="close">DONE</button>', true);
  }
  // ---- THE HI8 PASS: shown where it pays; while it isn't on sale, "count me in"
  function passPrices() {
    var st = S.settings || {}, w = S.wallet || {};
    return { month: Number(w.pass_month_cents || st.pass_month_cents || 1699), founding: Number(w.pass_founding_cents || st.pass_founding_cents || 999), member: memberPct(), fee: feePct() };
  }
  function passCard(where) {
    var P = passPrices(), on = S.wallet && S.wallet.pass && S.wallet.pass.active, asked = HI8.store.get('passAsked', false);
    if (on) return '';
    return '<div class="passc"><div class="pch"><b>HI8 PASS</b><span><s>' + euro(P.month) + '</s> ' + euro(P.founding) + ' <small>A MONTH · FOUNDING RIDERS</small></span></div>' +
      '<ul class="perks"><li><b>' + P.member + '% instead of ' + P.fee + '%</b> on every shared ride, for life</li><li>Crew rates at partner schools, rental shops, tracks and cable parks</li><li>Season stats: days out, euros saved</li></ul>' +
      '<p class="hint">Free while the pilot runs: nobody pays a fee until rides are paid in the app. Founding riders keep ' + euro(P.founding) + ' a month for good.</p>' +
      (asked ? '<p class="okline">You\'re on the list: we email you before it opens.</p>'
        : signedIn() ? '<button class="jn lm" data-act="passin" data-src="' + where + '">COUNT ME IN</button>'
        : '<form class="send" data-form="pass" data-src="' + where + '"><label class="sr" for="passEmail-' + where + '">Email</label><input class="inp" id="passEmail-' + where + '" type="email" inputmode="email" autocomplete="email" placeholder="you@email.com" required><button type="submit">COUNT ME IN</button></form>') + '</div>';
  }
  function sheetPass() { return shell('HI8 PASS', '<div class="sec">' + passCard('crew') + '</div>', '', true); }
  function passIn(email, where) {
    var args = { p_city: S.city, p_sport: S.sport, p_source: where || 'other' };
    var call = signedIn() ? HI8.withKey('hi8_pass_interest', args, { noQueue: true }) : HI8.rpc('hi8_pass_interest', Object.assign({ p_email: email }, args));
    return after(call, function () { HI8.store.set('passAsked', true); toast('You\'re on the Hi8 Pass list. Founding price kept for you.', 5000); drawPass(); if (S.view) renderSheet(); });
  }
  function drawPass() { var el = $('#passSlot'); if (el) el.innerHTML = passCard('landing'); }

  // ---- MY CREW: a group that stays together after a session (squads), your card and your log
  function loadSocial() {
    if (!HI8.live || !signedIn()) return Promise.resolve();
    return Promise.all([
      HI8.withKey('hi8_squads', {}, { noQueue: true }).then(function (q) { S.squads = q || []; }, noop),
      HI8.withKey('hi8_card', {}, { noQueue: true }).then(function (c) { S.card = c; }, noop),
      HI8.withKey('hi8_watch', { p_spot: null }, { noQueue: true }).then(function (w) { // your stars, on every phone you sign in on
        var f = favList(); (w && w.spots || []).forEach(function (x) { if (f.indexOf(x) < 0) f.push(x); }); HI8.store.set('favs', f);
        f.filter(function (x) { return (w && w.spots || []).indexOf(x) < 0; }).forEach(function (x) { HI8.withKey('hi8_watch', { p_spot: x, p_on: true }, { noQueue: true }).catch(noop); });
      }, noop)
    ]).then(function () { drawMapSpots(); if (S.view === 'me' || S.view === 'start' || S.view === 'crew') renderSheet(); });
  }
  function openSquad(code) {
    code = String(code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    S.view = 'squad'; S.sq = { code: code, data: null, err: null, busy: false };
    if (new URLSearchParams(location.search).get('s') !== code) history.pushState(null, '', '?s=' + code);
    renderSheet();
    HI8.rpc('hi8_squad', { p_code: code, p_key: HI8.me().key || null }).then(function (d) { S.sq.data = d; renderSheet(); }, function (e) { S.sq.err = errText(e); renderSheet(); });
  }
  function squadUrl(q) { return location.origin + location.pathname + '?s=' + q.code; }
  function squadShare(q) { return 'Ride with us: ' + q.name + ' on Hi8ctane. When one of us goes, everyone hears. Join the crew: ' + squadUrl(q); }
  function riderChips(q) {
    return '<div class="sqr">' + (q.riders || []).map(function (r, i) { return '<span class="sqp" style="background:' + AVC[i % AVC.length] + '">' + (r.plate ? '<b>#' + pad3(r.plate) + '</b>' : '') + esc(r.name || 'Rider') + (r.me ? ' · YOU' : '') + '</span>'; }).join('') + '</div>';
  }
  function sheetSquad() {
    var Q = S.sq || {}, q = Q.data;
    if (Q.err) return shell('CREW', '<div class="err">' + esc(Q.err) + '</div>', '', true);
    if (!q) return shell('CREW', '<div class="sec"><div class="skel"></div></div>', '', true);
    var sport = (SPORT[q.sport] || { name: q.sport }).name.toUpperCase();
    var body = '<div class="hero sqhero"><div class="k">' + esc(sport) + ' · A CREW THAT RIDES TOGETHER</div><h2>' + esc(q.name) + '</h2>' +
      '<div class="when2">' + q.size + ' RIDER' + (q.size === 1 ? '' : 'S') + ' · ' + q.sessions + ' SESSION' + (q.sessions === 1 ? '' : 'S') + ' TOGETHER</div></div>' +
      '<div class="sec">' + riderChips(q) + '</div>' +
      '<div class="sec"><h2>NEXT <small>' + q.next.length + ' COMING UP</small></h2>' + (q.next.length ? '<div class="crews">' + q.next.map(crewCard).join('') + '</div>' : '<p class="lede">Nothing posted yet. When one of you starts a crew, tap TELL THE CREW and everyone gets an email.</p>') + '</div>';
    var foot;
    if (q.mine) {
      body += '<div class="f"><button class="opt" data-act="sqleave">' + (Q.confirm ? 'TAP AGAIN TO LEAVE' : 'LEAVE THIS CREW') + '</button></div>';
      foot = '<a class="big invite" href="https://wa.me/?text=' + encodeURIComponent(squadShare(q)) + '" target="_blank" rel="noopener">INVITE A MATE</a><button class="big start" data-act="sqstart" style="flex:0 0 42%">GO RIDE</button>';
    } else if (signedIn()) {
      foot = '<button class="big join" data-act="sqjoin"' + (Q.busy ? ' disabled' : '') + '>' + (Q.busy ? '<span class="spin"></span>' : 'JOIN THIS CREW') + '</button>';
    } else {
      body += '<div class="f"><label class="lb" for="sqEmail">YOUR EMAIL</label><input class="inp" id="sqEmail" type="email" autocomplete="email" placeholder="you@example.com">' +
        '<p class="hint">You hear when one of them goes. No app, no password. ' + (Q.err2 ? '<b style="color:var(--pink)">' + esc(Q.err2) + '</b>' : '') + '</p></div>';
      foot = '<button class="big join" data-act="sqjoin"' + (Q.busy ? ' disabled' : '') + '>' + (Q.busy ? '<span class="spin"></span>' : 'JOIN THIS CREW') + '</button>';
    }
    return shell('CREW', body, foot, true);
  }
  function squadJoin() {
    var Q = S.sq; if (!Q || !Q.data || Q.busy) return;
    var p;
    if (signedIn()) p = HI8.withKey('hi8_squad_join', { p_code: Q.code }, { noQueue: true });
    else {
      var em = (($('#sqEmail') || {}).value || '').trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) { Q.err2 = "That email doesn't look right."; renderSheet(); return; }
      p = HI8.rpc('hi8_join', { p_email: em, p_city: Q.data.city, p_source: 'squad-link', p_ref: Q.code }).then(keyOrLink(em)).then(function (out) { return HI8.withKey('hi8_squad_join', { p_code: Q.code }, { noQueue: true }); });
    }
    Q.busy = true; Q.err2 = null; renderSheet();
    p.then(function (d) { Q.busy = false; Q.data = d; drawTop(); renderSheet(); loadSocial(); toast("You're in the crew. When one of them goes, you hear first."); },
      function (e) { Q.busy = false; Q.err2 = errText(e); renderSheet(); });
  }
  // the Me page: your card and your crews
  function cardBox() {
    var c = S.card; if (!c) return '';
    var stat = function (n, l, col) { return '<span class="cs" style="border-color:' + col + '"><b style="color:' + col + '">' + n + '</b>' + l + '</span>'; };
    return '<div class="box ridercard"><h3>YOUR RIDER CARD</h3><div class="csr">' + stat(c.sessions, 'SESSIONS', 'var(--lime)') + stat(c.spots, 'SPOTS', 'var(--yellow)') + stat(c.drives, 'DRIVES', 'var(--pink)') + stat(c.squads, 'CREWS', 'var(--mint)') + '</div>' +
      (c.log && c.log.length ? '<div class="log">' + c.log.map(function (x) {
        return '<div class="lg"><span class="lg-d">' + esc(FX.dayName(x.day, S.today).toUpperCase()) + '<small>' + esc(x.day.slice(8, 10) + '/' + x.day.slice(5, 7)) + '</small></span><span class="lg-s"><b>' + esc(x.spot_name.toUpperCase()) + '</b><small>' + (x.role === 'drive' ? 'YOU DROVE · ' : '') + (x.riders && x.riders.length ? 'WITH ' + esc(x.riders.slice(0, 3).join(', ').toUpperCase()) + (x.riders.length > 3 ? ' +' + (x.riders.length - 3) : '') : 'SOLO') + '</small></span>' +
          (x.squad ? '<button class="opt" data-act="squad" data-code="' + esc(x.squad) + '">THE CREW</button>' : '<button class="opt" data-act="keep" data-code="' + esc(x.code) + '">KEEP CREW</button>') + '</div>';
      }).join('') + '</div>' : '<p class="hint">Your sessions show here after the day: who came, where, who drove.</p>') + '</div>';
  }
  function squadsBox() {
    var Q = S.squads || [];
    return '<div class="sec"><h2>CREWS THAT STAY <small>' + Q.length + '</small></h2>' + (Q.length ? Q.map(function (q) {
      return '<button class="sqcard" data-act="squad" data-code="' + esc(q.code) + '"><span class="sqn">' + esc(q.name.toUpperCase()) + '</span><span class="hint">' + q.size + ' rider' + (q.size === 1 ? '' : 's') + ' · ' + q.sessions + ' session' + (q.sessions === 1 ? '' : 's') + ' · ' + (q.next.length ? 'next: ' + esc(dayRel(q.next[0].day)) + ' ' + esc(q.next[0].spot_name) : 'nothing posted yet') + '</span></button>';
    }).join('') : '<p class="lede">After a session, tap KEEP CREW: the people you rode with stay together, and when one of you goes the rest hear about it.</p>') + '</div>';
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
  // P0-4 (2.31): the calendar entry. Times in UTC from the city's time zone (right on any phone, across daylight
  // saving); the pick-up or pin for the crew, the spot for others; the same UID with a newer SEQUENCE, so opening it
  // again after a move updates the entry, and CANCELLED when it's called off.
  function zoned(ms, tz) {
    var p = {}; new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms)).forEach(function (x) { p[x.type] = x.value; });
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute);
  }
  function utcOf(day, t, tz) {
    var d = day.split('-').map(Number), q = hm(t).split(':').map(Number), want = Date.UTC(d[0], d[1] - 1, d[2], q[0], q[1]), ms = want;
    for (var i = 0; i < 3; i++) ms -= zoned(ms, tz) - want;
    return ms;
  }
  function icsTime(ms) { return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); }
  function icsText(t) { return String(t || '').replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function icsFile(c) {
    var tz = cityObj(c.city).tz || 'Europe/Amsterdam', st = utcOf(c.day, c.start, tz), en = c.end ? utcOf(c.day, c.end, tz) : st + 3 * 3600e3;
    var hub = hubOf(c), spot = HI8.spot(c.spot) || {}, g = stage(c), member = !!c.me;
    var pin = member && c.meet_lat != null ? [c.meet_lat, c.meet_lon] : spot.lat != null ? [spot.lat, spot.lon] : null;
    var where = (member && hub && c.me.getting !== 'own' ? 'Pick-up ' + title(hub.name) + (c.meet_time ? ' ' + hm(c.meet_time) : '') + ', then ' : '') + (c.spot_name || spot.name) + (pin ? ' (' + pin[0].toFixed(5) + ', ' + pin[1].toFixed(5) + ')' : '');
    var desc = (g.k === 'off' ? 'Called off' + (c.off_reason ? ': ' + c.off_reason : '') + '. ' : '') + where + '. The forecast is a model: the captain calls it on the day. ' + crewUrl(c.code);
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Hi8ctane//Crews//EN', 'METHOD:PUBLISH', 'BEGIN:VEVENT', 'UID:' + c.code + '@hi8ctane.com',
      'SEQUENCE:' + Math.floor(Date.now() / 1000), 'DTSTAMP:' + icsTime(Date.now()), 'DTSTART:' + icsTime(st), 'DTEND:' + icsTime(en),
      'STATUS:' + (g.k === 'off' ? 'CANCELLED' : g.k === 'prop' ? 'TENTATIVE' : 'CONFIRMED'),
      'SUMMARY:' + icsText((g.k === 'off' ? 'CALLED OFF · ' : '') + SPORT[c.sport].name + ' crew · ' + (c.spot_name || spot.name)),
      'LOCATION:' + icsText(where), pin ? 'GEO:' + pin[0].toFixed(5) + ';' + pin[1].toFixed(5) : null, 'URL:' + crewUrl(c.code),
      'DESCRIPTION:' + icsText(desc), 'END:VEVENT', 'END:VCALENDAR'].filter(Boolean).join('\r\n');
  }
  function ics(c) {
    track('ics', c.code);
    var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([icsFile(c)], { type: 'text/calendar' })); a.download = 'hi8ctane-' + c.code + '.ics'; document.body.appendChild(a); a.click(); a.remove();
  }
  HI8.icsFile = icsFile; // for tests
  function after(p, ok) {
    return p.then(ok, function (e) { toast(errText(e), 4500); throw e; });
  }
  function joinGo() {
    if (S.jf && S.jf.getting) HI8.store.set('getting', S.jf.getting);
    if (S.jf && S.jf.getting === 'drive') HI8.store.set('seats', S.jf.seats);
    var C = S.crew, c = C.data, f = S.jf;
    if (f.busy) return;
    var email = ($('#jfEmail') || {}).value, name = ($('#jfName') || {}).value;
    f.err = null;
    if (!f.getting) { f.err = 'How are you getting there? Pick one.'; renderSheet(); return; }
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
      var was = !!c.me; f.busy = false; S.jf = null; C.data = d; S.me = HI8.me(); drawTop(); if (!was) track('join', c.code);
      HI8.loadCrews(true).catch(noop); HI8.loadMine(true).catch(noop); loadLive();
      startChat(); renderSheet(); if (home()) loadPlan(true);
      if (!was && f.quick) {
        var how = f.getting === 'drive' ? 'you drive, ' + f.seats + ' seat' + (f.seats > 1 ? 's' : '') + ' free' : f.getting === 'seat' ? (d.me && d.me.car_with ? 'you have a seat' : 'you\'re on the list for a seat') : 'you meet there';
        toast("You're in: " + how + '. <button class="opt" data-act="jfopen" style="margin-left:8px">CHANGE</button>', 8000);
      } else if (!was) {
        var al = (HI8.mine && HI8.mine.alerts) || [];
        C.welcome = { plate: d.plate || null, offer: !al.some(function (a) { return a.sport === c.sport; }) }; renderSheet();
        var sb = document.querySelector('#sheet .sh-body'); if (sb) sb.scrollTop = 0;
        HI8.store.del('joinIntent');
      } else toast('Saved.');
    }, function (e) {
      f.busy = false; f.quick = false;
      if (e && e.message === 'needs_link' && email) {   // HI8.rpc has already asked Supabase Auth for the link
        HI8.store.set('joinIntent', { code: c.code, level: f.level, getting: f.getting, seats: f.seats, at: Date.now() });
        C.pending = { email: email.trim(), next: Date.now() + 60000 }; S.jf = null; renderSheet(); pendingTick(C); return;
      }
      f.err = errText(e); renderSheet();
    });
  }
  function pendingTick(C) {
    clearInterval(S.pendT); S.pendT = setInterval(function () { if (S.crew !== C || !C.pending) return clearInterval(S.pendT); if (S.view === 'crew') renderSheet(); if (Date.now() >= C.pending.next) clearInterval(S.pendT); }, 1000);
  }
  function pendingBox(C) {
    var p = C.pending; if (!p) return '';
    return '<div class="box pend" role="status" aria-live="polite"><h3>✉ CHECK YOUR INBOX</h3><p style="margin:0 0 8px">We sent a sign-in link to <b>' + esc(p.email) + '</b>. Open it on this phone to finish joining: you\'ll come back here and confirm.</p>' +
      '<p class="hint" style="margin:0 0 8px"><b>You\'re not in the crew yet.</b> No email after a few minutes? Check spam, or send it again.</p>' +
      '<div class="row"><button class="opt" data-act="pendedit">USE ANOTHER EMAIL</button></div></div>';
  }
  function startPost() {
    var f = S.sf; if (f.busy) return;
    var note = ($('#sfNote') || {}).value || '', email = ($('#sfEmail') || {}).value, name = ($('#sfName') || {}).value;
    f.note = note; f.err = null; f.errAt = null;
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
    if (!f.getting) { f.err = 'Pick how you\'re getting there: drive, a seat, or meet there.'; f.errAt = 'how'; renderSheet(); return; }
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
    if (f.min) p = p.then(function (c) { return HI8.withKey('hi8_crew_min', { p_code: c.code, p_min: f.min }, { noQueue: true }).then(function (c2) { return Object.assign({}, c, c2); }, function () { return c; }); });
    p.then(function (c) {
      HI8.loadPlaces && HI8.loadPlaces(true).then(function () { drawTowns(); }, noop);
      f.busy = false; f.done = c; f.force = false; drawTop(); track('publish', c.code, f.squad ? 'propose' : f.again ? 'again' : null);
      if (f.squad && c.code) HI8.withKey('hi8_squad_call', { p_code: f.squad, p_crew: c.code }, { noQueue: true }).then(function (r) { f.told = r && r.told; renderSheet(); toast((r && r.told ? r.told + ' in your crew are asked.' : 'Your crew is asked.') + ' Each says yes for themselves.', 4000); }, noop);
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
    S.sport = k; HI8.store.set('sport28', k); S.layerSet = false; fitMap(); drawAll(); if (!(S.asks || {})[S.city + '|' + k]) loadAsks(k);
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act]'); if (!t) return;
    var a = t.getAttribute('data-act'), d = t.dataset;
    if (/^sf/.test(a) && S.sf) S.sf.touched = true;
    if (t.tagName === 'A' && (a === 'shared' || t.target === '_blank')) { if (a === 'shared') track('share', (S.crew && S.crew.code) || (S.sf && S.sf.done && S.sf.done.code) || (S.next && S.next.code) || null); if (a === 'shared') toast('Paste it in your group chats. Every share brings riders.'); return; }
    if (t.tagName === 'A' || t.tagName === 'BUTTON') e.preventDefault();
    switch (a) {
      case 'kg': S.kgBack = S.view ? location.hash : null; go('#kg'); break;
      case 'kgset': HI8.store.set('kg', Number(d.v)); drawAll(); renderSheet(); break;
      case 'level': go('#level'); break;
      case 'ctdraw': if (CT.photo && CT.consent && CT.step !== 'busy') ctDraw(); break;
      case 'ctcancel': CT = { step: 'idle', photo: null, consent: false, err: '', left: CT.left }; renderSheet(); break;
      case 'ctremove':
        if (!S.confirmCt) { S.confirmCt = true; t.textContent = 'Tap again to remove it'; setTimeout(function () { S.confirmCt = false; if (S.view === 'me') renderSheet(); }, 4000); break; }
        S.confirmCt = false;
        HI8.fn('cartoon', { key: HI8.me().key, kind: 'remove' }).then(function () { S.avatar = null; drawTop(); renderSheet(); toast('Cartoon removed.'); }, function (e) { toast(errText(e), 5000); });
        break;
      case 'lvset': HI8.store.set('lv.' + S.sport, d.v); drawAll(); renderSheet(); break;
      case 'passinfo': go('#pass'); break;
      case 'passin': passIn(null, d.src); break;
      case 'close': if (S.view === 'kg' && S.kgBack) { var kb = S.kgBack; S.kgBack = null; closeSheet(); go(kb); } else if (S.view === 'from' && S.fromBack) { var back = S.fromBack; S.fromBack = null; closeSheet(); go(back); } else closeSheet(); break;
      case 'join': if (S.view === 'crew') closeSheet(); go('#join'); break;
      case 'start': if (S.view === 'crew') closeSheet(); newStart({}); go('#start'); break;
      // P0-5 (2.31): run it again: the start form filled from this session, on the next good window there
      case 'again': {
        var src0 = S.crew && S.crew.code === d.code ? S.crew.data : null; if (!src0) break;
        var cl0 = clash(src0.sport, src0.spot, d.date, d.from); if (cl0) { S.autoJoin = cl0.code; openCrew(cl0.code); toast('A crew is already going then: join it.', 3500); break; }
        if (src0.sport !== S.sport && LIVE_SPORTS.indexOf(src0.sport) >= 0) setSport(src0.sport);
        newStart({ sport: src0.sport, spot: src0.spot, date: d.date, from: d.from, to: d.to });
        var f0 = S.sf; f0.levels = src0.levels || f0.levels; f0.max = src0.max || f0.max; if (src0.min) f0.min = src0.min;
        if (src0.meet_hub && hubBy(src0.meet_hub)) { f0.hub = src0.meet_hub; autoMeet(); }
        if (src0.me) { f0.getting = src0.me.getting === 'seat' ? 'own' : src0.me.getting; if (src0.me.getting === 'drive' && src0.me.seats) f0.seats = src0.me.seats; }
        f0.again = src0.code; f0.touched = true;
        closeSheet(); go('#start'); track('again', src0.code);
        break;
      }
      case 'startwin': { var cl = clash(S.sport, d.spot, d.date, d.from); if (cl) { S.autoJoin = cl.code; openCrew(cl.code); toast('A crew is already going then: join it.', 3500); break; }
        newStart({ date: d.date, from: d.from, to: d.to, spot: d.spot, quick: true }); go('#start'); break; }
      case 'going': S.autoJoin = String(d.code).toUpperCase(); openCrew(d.code); break;
      case 'goingbest': { var nx = sessions().filter(function (x) { return !x.crews.length ? FX.tone(x.fx && x.fx.score) !== 'no' : suitRank(x.crews[0]) < 2; })[0];
        if (nx && nx.crews.length) { S.autoJoin = String(nx.crews[0].code).toUpperCase(); openCrew(nx.crews[0].code); }
        else if (nx) { newStart({ date: nx.date, from: nx.from, to: nx.to, spot: nx.spot.slug, quick: true }); go('#start'); }
        else { newStart({}); go('#start'); }
        break; }
      case 'allsess': S.allSess = true; drawSessions(); break;
      case 'top': { var sc = $('#sessions'); if (sc) sc.scrollIntoView({ behavior: 'smooth', block: 'start' }); var pn = $('#panel'); if (pn && pn.scrollHeight > pn.clientHeight) pn.scrollTo({ top: 0, behavior: 'smooth' }); break; }
      case 'sffull': S.sf.quick = false; if (!S.sf.getting) S.sf.getting = 'drive'; renderSheet(); break;
      case 'sfmin': S.sf.min = Number(d.v) || null; renderSheet(); break;
      case 'sfnote': S.sf.noteOpen = true; renderSheet(); setTimeout(function () { var n = $('#sfNote'); if (n) n.focus(); }, 30); break;
      case 'startspot': if (d.sport !== S.sport) setSport(d.sport); newStart({ spot: d.spot, sport: d.sport }); go('#start'); break;
      case 'me': go('#me'); break;
      case 'city': go('#city'); break;
      case 'waitlist':
        if (S.wlBusy) break;
        S.wlBusy = d.city; drawWhere();
        after(HI8.withKey('hi8_waitlist', { p_city: d.city }, { noQueue: true }), function (out) { S.wlBusy = null; S.waitlisted = Object.assign({}, S.waitlisted, (function () { var o = {}; o[d.city] = 1; return o; })()); drawWhere(); toast(out.already ? "You're already on the " + esc(out.name) + ' list.' : "You're on the " + esc(out.name) + ' list. You hear first.'); }).catch(function () { S.wlBusy = null; drawWhere(); });
        break;
      case 'setcity': S.city = d.city; HI8.store.set('city28', d.city); S.hi = null; closeSheet(); initMap(); loadForecast(); loadLive(); loadPlans(); look(); drawAll(); break;
      case 'sport': setSport(d.sport); break;
      case 'looking': S.lk = null; newLook(S.view === 'start' && S.sf ? S.sf.sport : S.sport); go('#looking'); break;
      case 'lksport': newLook(d.sport); loadAsks(d.sport); renderSheet(); break;
      case 'lkday': { var ix = S.lk.days.indexOf(d.day); if (ix >= 0) S.lk.days.splice(ix, 1); else S.lk.days.push(d.day); S.lk.days.sort(); S.lk.err = null; renderSheet(); break; }
      case 'lkpreset': {   // flexible availability: a quick set of days, still editable one by one
        var D7 = FX.data[S.city] ? FX.bestDays(S.city, spotsFor(S.city, S.lk.sport), S.lk.sport, fxo(S.lk.sport), 7) : [], pick = [];
        for (var di = 0; di < 7; di++) { var dd = FX.addDays(S.today, di), dw = new Date(dd + 'T12:00:00Z').getUTCDay(), bb = D7.filter(function (x) { return x.date === dd; })[0];
          if (d.k === 'all' || (d.k === 'wknd' && (dw === 0 || dw === 6)) || (d.k === 'good' && bb && !bb.none && FX.tone(bb.score) !== 'no' && FX.tone(bb.score) !== 'none')) pick.push(dd); }
        S.lk.days = pick; S.lk.err = pick.length ? null : 'No good day in the forecast yet: pick days yourself.'; renderSheet(); break; }
      case 'lkseat': S.lk.seat = d.v === '1'; renderSheet(); break;
      case 'lkhub': S.lk.hub = d.v; renderSheet(); break;
      case 'lklevel': S.lk.level = d.v; renderSheet(); break;
      case 'lksave': lookSave(); break;
      case 'askdriver': {
        var cc = S.crew && S.crew.code === d.code ? S.crew.data : S.next && S.next.code === d.code ? S.next.data : null, hb = cc ? hubOf(cc) : null;
        var msg = (d.who === 'me' ? 'I still need a lift' : d.who + ' still needs a lift') + (hb ? ' from ' + title(hb.name) : '') + (cc && cc.meet_time ? ' at ' + hm(cc.meet_time) : '') + '. Can anyone drive, or has a seat?';
        HI8.withKey('hi8_send', { p_code: d.code, p_body: msg }, { noQueue: true }).then(function () { toast('Asked in the crew chat.'); if (S.crew && S.crew.code === d.code) pollChat(); }, function (e) { toast(errText(e)); });
        break;
      }
      case 'stillin': case 'captain': {
        var fn = d.act === 'stillin' ? 'hi8_still_in' : 'hi8_captain', body = { p_code: d.code };
        if (d.act === 'captain') body.p_yes = d.v === '1';
        else if (d.v) body.p_v = Number(d.v);   // 0027: only for the version of the plan the rider saw
        HI8.withKey(fn, body, { noQueue: true }).then(function (dd) {
          if (S.crew && S.crew.code === d.code) { S.crew.data = dd; renderSheet(); }
          S.next = { code: d.code, data: dd, at: Date.now() }; drawNext(); HI8.loadMine(true).then(drawNext, noop);
          toast(d.act === 'stillin' ? "You're still in. The crew sees it." : d.v === '1' ? "You're the captain. It's on." : 'Passed on to the next rider.');
        }, function (e) { toast((e && (e.hint || e.message)) || 'That didn\'t go through. Try again.'); if (e && /plan_changed|crew_off|crew_done/.test(e.message)) { HI8.loadMine(true).then(drawNext, noop); if (S.crew && S.crew.code === d.code) loadCrew(); } });
        break;
      }
      // UX review H16: CAN'T MAKE IT answers in place; the second tap within 4 s leaves the crew
      // I'm running late: one tap tells the chat, your driver and the captain (0028 hi8_late)
      case 'late': {
        HI8.withKey('hi8_late', { p_code: d.code, p_min: Number(d.min) }, { noQueue: true }).then(function (r) {
          if (S.crew && S.crew.code === d.code && r && r.crew) { S.crew.data = r.crew; renderSheet(); pollChat && pollChat(); }
          track('late', d.code); toast(r && r.told ? 'Done: ' + (r.told === 1 ? 'your driver knows' : 'your driver and the captain know') + ', and the crew chat says it.' : 'Done: the crew chat says it.', 3500);
        }, function (e) { toast((e && (e.hint || e.message)) || 'That didn\'t go through. Try again.'); });
        break;
      }
      // Plan B and the weekend proposal both open the start form, filled in; nothing is posted until you tap POST
      case 'planb': case 'propose': {
        var srcC = d.act === 'planb' ? ((S.crew && S.crew.code === d.code && S.crew.data) || (S.next && S.next.code === d.code && S.next.data) || null) : null;
        var q0 = d.act === 'propose' ? (S.weekend || []).filter(function (x) { return x.code === d.squad; })[0] : null, last = q0 ? q0.last || {} : {};
        var sp0 = d.sport && LIVE_SPORTS.indexOf(d.sport) >= 0 ? d.sport : srcC ? srcC.sport : q0 ? q0.sport : S.sport;
        var cl1 = clash(sp0, d.spot, d.date, Number(d.from)); if (cl1) { S.autoJoin = cl1.code; openCrew(cl1.code); toast('A crew is already going then: join it.', 3500); break; }
        if (sp0 !== S.sport && LIVE_SPORTS.indexOf(sp0) >= 0) setSport(sp0);
        newStart({ sport: sp0, spot: d.spot, date: d.date, from: Number(d.from), to: Number(d.to) });
        var fz = S.sf, base = srcC || last;
        if (base.levels && sp0 === (srcC ? srcC.sport : q0 ? q0.sport : null)) fz.levels = base.levels; if (base.max) fz.max = base.max; if (base.min) fz.min = base.min;
        var hb0 = (srcC && srcC.meet_hub) || last.hub; if (hb0 && hubBy(hb0)) { fz.hub = hb0; autoMeet(); }
        if (srcC && srcC.me) { fz.getting = srcC.me.getting === 'seat' ? 'own' : srcC.me.getting; if (srcC.me.getting === 'drive' && srcC.me.seats) fz.seats = srcC.me.seats; }
        if (srcC) fz.again = srcC.code; if (q0) fz.squad = q0.code; fz.touched = true;
        closeSheet(); go('#start'); track(d.act === 'planb' ? 'planb' : 'propose', srcC ? srcC.code : null);
        break;
      }
      case 'cantmake': {
        if (S.cantArm !== d.code) { S.cantArm = d.code; if (S.crew && S.crew.code === d.code) renderSheet(); drawNext(); setTimeout(function () { if (S.cantArm === d.code) { S.cantArm = null; if (S.crew && S.crew.code === d.code) renderSheet(); drawNext(); } }, 4000); break; }
        S.cantArm = null;
        HI8.withKey('hi8_leave_crew', { p_code: d.code, p_reason: null }, { noQueue: true }).then(function (dd) {
          if (S.crew && S.crew.code === d.code) { S.crew.data = dd; renderSheet(); }
          HI8.loadMine(true).then(function () { drawNext(); drawAll(); }, noop); toast('You\'re out. The crew sees it.');
        }, function (e) { toast((e && (e.hint || e.message)) || 'That didn\'t go through. Try again.'); });
        break;
      }
      case 'offseen': { var seen = HI8.store.get('offSeen', []) || []; if (seen.indexOf(d.code) < 0) seen.push(d.code); HI8.store.set('offSeen', seen.slice(-30)); drawNext(); break; }
      case 'stepdown': {
        var C2 = S.crew; if (!C2) break;
        if (C2.confirm !== 'stepdown') { C2.confirm = 'stepdown'; renderSheet(); setTimeout(function () { if (S.crew === C2 && C2.confirm === 'stepdown') { C2.confirm = null; renderSheet(); } }, 4000); break; }
        C2.confirm = null;
        after(HI8.withKey('hi8_step_down', { p_code: C2.code }, { noQueue: true }), function (dd) { C2.data = dd; stopChat(); HI8.loadCrews(true).then(drawAll, noop); HI8.loadMine(true).then(drawNext, noop); toast('Handed over. The crew is asking the next rider to captain.'); });
        break;
      }
      case 'pin': {
        var C3 = S.crew; if (!C3 || !navigator.geolocation) { toast('Your phone can\'t share where you are.'); break; }
        C3.pinBusy = true; renderSheet();
        navigator.geolocation.getCurrentPosition(function (pos) {
          C3.pinBusy = false;
          after(HI8.withKey('hi8_set_pin', { p_code: C3.code, p_lat: Math.round(pos.coords.latitude * 1e5) / 1e5, p_lon: Math.round(pos.coords.longitude * 1e5) / 1e5 }, { noQueue: true }), function (dd) { C3.data = dd; renderSheet(); toast('Pinned. Your crew sees the exact spot.'); });
        }, function () { C3.pinBusy = false; renderSheet(); toast('No location: allow it for this site, then try again.'); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
        break;
      }
      case 'soon': go('#soon/' + d.sport); break;
      case 'soonpick': S.soonSport = d.sport; history.replaceState(null, '', '#soon/' + d.sport); renderSheet(); break;
      case 'spot': { closeSheet(); var tm = times()[S.hi]; if (d.spot === S.mapSel && tm) S.spotDay = Math.max(0, Math.min(6, Math.round((dDate(tm.slice(0, 10)) - dDate(S.today)) / 864e5))); go('#spot/' + d.spot); break; }
      case 'crew': e.preventDefault(); openCrew(d.code); break;
      case 'zoom': if (map) map.zoom(Number(d.d)); break;
      case 'layer': S.layer = effLayer() === 'rain' ? 'wind' : 'rain'; S.layerSet = true; drawTime(); drawMapSpots(); break;
      case 'play': togglePlay(); break;
      case 'hourpick': S.hi = Number(d.i); stopPlay(); drawTime(); drawMapSpots(); break;
      case 'mapcardx': S.mapSel = null; drawMapSpots(); break;
      case 'mapspot': pickSpot(d.spot); break;
      case 'now': S.hi = Math.max(0, times().indexOf(S.today + 'T' + pad(S.nowH) + ':00')); drawTime(); drawMapSpots(); break;
      case 'mapday': { S.hoursTouched = false; // that day at the best hour: now if it's today and light, else the best window of the day, else noon
        var T2 = times(), want = d.date === S.today && S.nowH >= 8 && S.nowH < 18 ? S.today + 'T' + pad(S.nowH) + ':00' : null;
        if (!want && FX.data[S.city]) { var b2 = null; spotsFor(S.city, S.sport).forEach(function (sp) { var fs = fxSpot(sp.slug); if (!fs) return; var w = FX.windows(fs, d.date, S.sport, sp, { kg: kg() })[0]; if (w && (!b2 || w.score > b2.score)) b2 = w; }); if (b2) want = d.date + 'T' + pad(b2.from) + ':00'; }
        var i2 = T2.indexOf(want || d.date + 'T12:00'); if (i2 < 0) i2 = T2.indexOf(d.date + 'T12:00');
        if (i2 >= 0) { S.hi = i2; drawTime(); drawMapSpots(); }
        break; }
      case 'fav': { var on = toggleFav(d.spot); if (signedIn()) HI8.withKey('hi8_watch', { p_spot: d.spot, p_on: on }, { noQueue: true }).catch(noop);
        toast(on ? (signedIn() ? 'Saved: it glows on your map, and you get an email when a crew goes there.' : 'Saved: it glows on your map.') : 'Removed from your spots.'); renderSheet(); drawMapSpots(); break; }
      case 'squad': openSquad(d.code); break;
      case 'movecrew': after(HI8.withKey('hi8_move_crew', { p_code: S.crew.code, p_day: d.date, p_start: pad(Number(d.from)) + ':00', p_end: pad(Math.min(23, Number(d.to))) + ':00' }, { noQueue: true }), function (dd) { S.crew.data = dd; renderSheet(); pollChat(); HI8.loadCrews(true).then(drawAll, noop); toast('Moved. Everyone in the crew hears it.', 5000); }).catch(noop); break;
      case 'phonesave': after(HI8.withKey('hi8_set_phone', { p_code: S.crew.code, p_phone: ($('#myPhone') || {}).value || null }, { noQueue: true }), function (pp) { S.crew.people = pp; renderSheet(); toast('Shared with this crew only.'); }).catch(noop); break;
      case 'noshow': after(HI8.withKey('hi8_no_show', { p_code: S.crew.code, p_member: d.member, p_on: d.on === 'true' }, { noQueue: true }), function (pp) { S.crew.people = pp; renderSheet(); }).catch(noop); break;
      case 'alerts': S.al = null; if (S.view === 'crew') closeSheet(); go('#alerts/' + (d.sport || S.sport) + (d.spot ? '/' + d.spot : '')); break;
      case 'alsport': if (S.al && S.al.sport !== d.sport) { newAlert(d.sport); history.replaceState(null, '', '#alerts/' + d.sport); } renderSheet(); break;
      case 'alspot': { var L2 = S.al.spots, ix = L2.indexOf(d.v); if (ix >= 0) L2.splice(ix, 1); else L2.push(d.v); S.al.saved = false; renderSheet(); break; }
      case 'almin': S.al.min_kt = Number(d.v); if (S.al.max_kt != null && S.al.max_kt <= S.al.min_kt) S.al.max_kt = null; S.al.saved = false; renderSheet(); break;
      case 'almax': S.al.max_kt = d.v === '' ? null : Number(d.v); if (S.al.max_kt != null && S.al.min_kt != null && S.al.min_kt >= S.al.max_kt) S.al.min_kt = S.al.max_kt - 5; S.al.saved = false; renderSheet(); break;
      case 'algust': S.al.gust_max = d.v === '' ? null : Number(d.v); S.al.saved = false; renderSheet(); break;
      case 'alscore': S.al.min_score = Number(d.v); S.al.saved = false; renderSheet(); break;
      case 'alpre': { var pr = { wknd: ['weekend', 'all'], work: ['weekday', 'evening'], any: ['any', 'all'] }[d.v]; if (!pr) break;
        S.al.days = pr[0]; S.al.from_h = HOURS[pr[1]][0]; S.al.to_h = HOURS[pr[1]][1]; S.al.min_hours = 2; S.al.saved = false; renderSheet(); break; }
      case 'altune': S.al.tune = !S.al.tune; renderSheet(); break;
      case 'aldays': S.al.days = d.v; S.al.saved = false; renderSheet(); break;
      case 'alhours': S.al.from_h = HOURS[d.v][0]; S.al.to_h = HOURS[d.v][1]; S.al.saved = false; renderSheet(); break;
      case 'allen': S.al.min_hours = Number(d.v); S.al.saved = false; renderSheet(); break;
      case 'alpush': S.al.by_push = !S.al.by_push; S.al.saved = false; renderSheet(); break;
      case 'almail': S.al.by_email = !S.al.by_email; S.al.saved = false; renderSheet(); break;
      case 'alsave': alertSave(); break;
      case 'aloff': after(HI8.withKey('hi8_wind_alert', { p_city: S.city, p_sport: S.al.sport, p_rule: null, p_on: false }, { noQueue: true }), function (r) { S.walerts = r.alerts || []; newAlert(S.al.sport); drawSessions(); renderSheet(); toast('Alert off.'); }).catch(noop); break;
      case 'pushguide': go('#push'); break;
      case 'pushon': pushOn(); break;
      case 'pushoff': pushOff(); break;
      case 'pushtest': pushTest(); break;
      case 'rcard': S.crew.cardOpen = d.member; renderSheet(); setTimeout(function () { var b = $('.bcard-x'); if (b) b.focus(); }, 30); break;
      case 'rcardx': { var back = S.crew.cardOpen; S.crew.cardOpen = null; renderSheet(); setTimeout(function () { var b = document.querySelector('[data-act=rcard][data-member="' + back + '"]'); if (b) b.focus(); }, 30); break; }
      case 'prcard': S.prof.card_public = !S.prof.card_public; renderSheet(); break;
      case 'mycard': S.cardFrom = S.view === 'crew' && S.crew ? S.crew.code : null; if (S.view === 'crew') closeSheet(); go('#card'); break;
      case 'cardwho': cardKeep(); S.cf.who = d.v === '1'; renderSheet(); break;
      case 'cardsave': cardSave(); break;
      case 'profsave': {
        var yv = ($('#prYears') || {}).value, hv = ($('#prHome') || {}).value, iv = ($('#prInsta') || {}).value, tv = ($('#prLine') || {}).value;
        after(HI8.withKey('hi8_rider_profile', { p_save: true, p_years: yv === '' ? null : Number(yv), p_home_spot: hv || null, p_insta: iv || null, p_tagline: tv || null, p_card_public: S.prof.card_public !== false }, { noQueue: true }), function (r) { S.prof = r; renderSheet(); toast('Saved: it\'s on your rider card.'); }).catch(noop); break; }
      case 'sqjoin': squadJoin(); break;
      case 'sqleave':
        if (!S.sq.confirm) { S.sq.confirm = true; renderSheet(); break; }
        after(HI8.withKey('hi8_squad_leave', { p_code: S.sq.code }, { noQueue: true }), function () { toast('You left the crew.'); S.sq.confirm = false; loadSocial(); closeSheet(); });
        break;
      case 'sqstart': if (S.sq && S.sq.data && S.sq.data.sport !== S.sport && LIVE_SPORTS.indexOf(S.sq.data.sport) >= 0) setSport(S.sq.data.sport); newStart({ sport: S.sq && S.sq.data ? S.sq.data.sport : null }); go('#start'); break;
      case 'sqcall':
        after(HI8.withKey('hi8_squad_call', { p_code: d.squad, p_crew: d.code }, { noQueue: true }), function (r) {
          S.told = S.told || {}; S.told[d.squad + ':' + d.code] = 1; renderSheet(); loadSocial();
          toast(r.told ? 'Told ' + r.told + ' rider' + (r.told > 1 ? 's' : '') + ': they get an email with the crew link.' : 'Everyone in that crew is already in this one.');
        });
        break;
      case 'keep':
        after(HI8.withKey('hi8_squad_keep', { p_crew: d.code }, { noQueue: true }), function (q) { loadSocial(); openSquad(q.code); toast('Kept: ' + esc(q.name) + '. Invite whoever else rides with you.'); });
        break;
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
      case 'sfclashok': S.sf.clashOk = true; renderSheet(); break;
      case 'sfpost': startPost(); break;
      case 'jfopen': openJoin(); break;
      case 'resend': { var Cr = S.crew; if (!Cr || !Cr.pending || Date.now() < Cr.pending.next) break;
        Cr.pending.next = Date.now() + 60000; renderSheet(); pendingTick(Cr);
        HI8.sendLink(Cr.pending.email).then(function () { toast('Sent again.'); }, function () { toast("We couldn't send it. Try again in a minute.", 5000); }); break; }
      case 'pendedit': if (S.crew) { S.crew.pending = null; HI8.store.del('joinIntent'); openJoin(); } break;
      case 'tofx': { var fa = $('#fxAnchor'); if (fa) fa.scrollIntoView({ block: 'start', behavior: 'smooth' }); break; }
      case 'tochat': { var ch = $('#chatAnchor'); if (ch) ch.scrollIntoView({ block: 'start', behavior: 'smooth' }); break; }
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
          function (dd) { var was = sessionEnded(dd); S.crew.data = dd; renderSheet(); loadLive(); pollChat(); toast(was ? 'Stamped on your rider card. Thanks: the next crew sees it.' : 'Thanks: the crew and the map have it.');
            if (was) HI8.withKey('hi8_card', {}, { noQueue: true }).then(function (cd) { S.card = cd; renderSheet(); }, noop); }).catch(noop); break;
      case 'settle': {
        var cost = Number(($('#payCost') || {}).value), link = ($('#payLink') || {}).value, bz = ($('#payBizum') || {}).value;
        if (!(cost >= 0)) { toast('Add what the car cost.'); break; }
        after(HI8.withKey('hi8_settle', { p_code: S.crew.code, p_cost: cost, p_link: link || null, p_bizum: bz || null }, { noQueue: true }), function (dd) { S.crew.data = dd; renderSheet(); pollChat(); toast('Saved. Your car can pay you now.'); }).catch(noop); break;
      }
      case 'paid': after(HI8.withKey('hi8_paid', { p_code: S.crew.code, p_paid: d.v === 'true' }, { noQueue: true }), function (dd) { S.crew.data = dd; renderSheet(); }).catch(noop); break;
      case 'ics': ics(d.code && !(S.crew && S.crew.code === d.code) && S.next && S.next.code === d.code ? S.next.data : S.crew.data); break;
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
  function rerank() { var f = S.sf, rank = FX.rankSpots(S.city, spotsFor(S.city, f.sport), f.sport, f.date, f.from, f.to, fxo(f.sport)); if (rank[0] && rank[0].fx && !f.spotPicked) f.spot = rank[0].spot.slug; f.hub = null; autoMeet(); renderSheet(); }
  document.addEventListener('change', function (e) {
    var t = e.target, a = t.getAttribute('data-change');
    if (!a) return;
    if (/^sf/.test(a) && S.sf) S.sf.touched = true;
    if (a === 'sffrom') { S.sf.from = Number(t.value); if (S.sf.to <= S.sf.from) S.sf.to = S.sf.from + 2; rerank(); }
    if (a === 'sfto') { S.sf.to = Number(t.value); rerank(); }
    if (a === 'sfmeet') { S.sf.meet = t.value; S.sf.meetAuto = false; }
    if (a === 'selfie' && t.files && t.files[0]) {
      var f = t.files[0]; t.value = '';
      if (f.size > 25 * 1024 * 1024) { CT.err = 'That photo is too big. Try another one.'; renderSheet(); return; }
      prepSelfie(f).then(function (url) { CT.photo = url; CT.step = 'photo'; CT.err = ''; renderSheet(); },
        function (er) { CT.err = er && er.message === 'small_photo' ? 'That photo is too small. Try a closer selfie.' : "We couldn't open that photo. Try a JPEG or PNG."; renderSheet(); });
      return;
    }
    if (a === 'ctconsent') { CT.consent = t.checked; var db = document.querySelector('[data-act=ctdraw]'); if (db) db.disabled = !t.checked; return; }
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
    if (kind === 'pass') {
      var pem = fm.querySelector('input[type=email]').value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(pem)) { toast("That email doesn't look right."); return; }
      passIn(pem, fm.getAttribute('data-src')).catch(noop);
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
  function togglePlay() { // plays the day on the map, hour by hour (6 to 21), then stops on the best hour
    if (playT) return stopPlay(); var T = times(), day = (T[S.hi] || '').slice(0, 10), H = [];
    for (var h = day === S.today ? Math.max(6, S.nowH) : 6; h <= 21; h++) { var i = T.indexOf(day + 'T' + pad(h) + ':00'); if (i >= 0) H.push(i); }
    if (!H.length) return; var k = 0; $('#play').textContent = '❚❚';
    playT = setInterval(function () { S.hi = H[k++]; drawTime(); drawMapSpots(); if (k >= H.length) stopPlay(); }, 600); }
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
    HI8.rpc('hi8_watchers', { p_city: S.city }).then(function (w) { S.watch = w || {}; drawSessions(); if (S.view === 'spot') renderSheet(); }, noop);
    return HI8.rpc('hi8_live', { p_city: S.city }).then(function (l) { S.live = l; drawMapSpots(); drawCrews(); drawSessions(); drawNow(); drawLive(); if (S.view && S.view !== 'start') renderSheet(); }, noop);
  }
  // WHO'S LOOKING: a random visitor id (not the rider key), one "I'm here" a minute while the page is open.
  // Shown from 2 looking now / 5 today: never "1 looking" (that's just you).
  function look() {
    if (!HI8.live || document.hidden) return;
    var v = HI8.store.get('visitor', null);
    if (!v) { v = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return (Math.random() * 16 | 0).toString(16); }); HI8.store.set('visitor', v); }
    HI8.rpc('hi8_look', { p_visitor: v, p_city: S.city }).then(function (r) {
      var parts = [];
      if (r && r.now >= 2) parts.push('<b>' + r.now + '</b> LOOKING NOW');
      if (r && r.today >= 5) parts.push('<b>' + r.today + '</b> TODAY');
      ['#looking', '#looking2'].forEach(function (id) { var el = $(id); if (!el) return; el.hidden = !parts.length; el.innerHTML = parts.length ? '<span class="dot"></span>' + parts.join(' · ') + (id === '#looking' ? ' IN ' + esc(regionName().toUpperCase()) : '') : ''; });
    }, noop);
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
    if (stop && HI8.live) HI8.rpc('hi8_unsubscribe', { p_token: stop }).then(function (r) { toast(r.kind === 'wind' ? (r.stopped ? 'Stopped: no more alert emails.' + (pushState() === 'on' ? ' Push on this phone keeps them: change it in Alerts.' : '') : 'Already stopped.') : r.stopped ? 'Stopped: no more ' + esc((SPORT[r.sport] || { name: r.sport }).name) + ' crew emails.' : 'Already stopped.', 6000); }, function () { toast('That stop link didn\'t work. Email hello@hi8ctane.com and we\'ll do it.'); });
    drawAll(); initMap();
    if (HI8.live) {
      loadAvatar();
      HI8.rpc('hi8_settings', {}).then(function (s) { S.settings = s; drawTop(); drawSave(); drawWeek(); drawPass(); drawSessions(); if (S.view) renderSheet(); }, noop); // prices and the fee can change what an open sheet says
      HI8.onData(function () { drawTop(); drawCrews(); drawSessions(); drawMapSpots(); if (S.view === 'join' || S.view === 'me') renderSheet(); });
      window.addEventListener('focus', function () { if (Date.now() - (S.plansAt || 0) > 120000) { S.plansAt = Date.now(); loadPlans(); } });
      HI8.loadPlaces().then(function () { fitMap(); loadForecast(); drawAll(); }, function () { loadForecast(); });
      loadLive(); loadPlans(); look(); setInterval(look, 60000); loadAsks(); if (signedIn()) { loadSocial(); loadAlerts(); loadProf(); loadMates(); loadMyAsks(); }
      if (pushSupported()) pushCheck().then(function (sub) {
        if (sub && signedIn()) pushSave(sub).catch(noop); // keeps this phone tied to the rider (the address can change)
        else if (!sub && standalone() && Notification.permission === 'default' && !HI8.store.get('pushAsked', false)) {
          HI8.store.set('pushAsked', true); setTimeout(function () { toast('Alerts on this phone? <button class="opt" data-act="pushguide" style="margin-left:8px">TURN ON</button>', 9000); }, 1500);
        }
        drawSessions();
      });
      document.addEventListener('visibilitychange', function () { if (!document.hidden) look(); });
      setInterval(function () { if (!document.hidden) { loadLive(); HI8.loadCrews(true).catch(noop); } }, 60000);
    } else loadForecast();
    setInterval(function () { if (!document.hidden) loadForecast(); }, 30 * 60e3);
    setInterval(function () { var h = S.nowH; refreshToday(); if (h !== S.nowH) drawTime(); }, 60000);
    route();
  }
  boot();
})();
