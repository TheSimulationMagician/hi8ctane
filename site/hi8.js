/*
 * Hi8ctane data layer (hi8.js), loaded by every screen before live.js and the player.
 *
 *   HI8.rpc(fn, args)     the hi8_* functions in Supabase (publishable key from config.js)
 *   HI8.me()              this browser's rider: key, plates, profile (kept in localStorage)
 *   HI8.counts / crews / places / mine / fx    the live data screens render, refreshed in the background
 *   HI8.watch(component)  re-render a screen when any of it changes
 *   HI8.fx                the real forecast: Open-Meteo, per spot, today and the next three days
 *
 * window.DC_READY makes the player (support.js) wait for the forecast (cached for 30 minutes) so the
 * screens never draw a made-up one. Nothing here is sample data: when Supabase or Open-Meteo can't be
 * reached, screens show that, not stand-ins.
 */
(function () {
  'use strict';

  var CFG = window.HI8_CONFIG || {};
  var API = String(CFG.supabaseUrl || '').trim().replace(/\/+$/, '');
  var KEY = String(CFG.publishableKey || '').trim();
  // Open-Meteo: the free API is for non-commercial use; with a paid plan, put its key in config.js (meteoKey)
  var MKEY = String(CFG.meteoKey || '').trim();
  var METEO = String(CFG.forecastApi || (MKEY ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com')).replace(/\/+$/, '');
  var MARINE = String(CFG.marineApi || (MKEY ? 'https://customer-marine-api.open-meteo.com' : 'https://marine-api.open-meteo.com')).replace(/\/+$/, '');
  var KEYQ = MKEY ? '&apikey=' + encodeURIComponent(MKEY) : '';
  var noop = function () {};

  var HI8 = window.HI8 = {
    live: !!(API && KEY), api: API, key: KEY, cfg: CFG,
    screen: (location.pathname.split('/').pop() || '').replace(/\.dc\.html$/, ''),
    params: new URLSearchParams(location.search),
    SPORTS: ['kite', 'wing', 'surf', 'sup', 'mtb', 'mx'],
    counts: null, crews: null, places: null, mine: null, fx: null, fxError: null
  };

  // ---------------------------------------------------------------- storage (this browser only)
  var store = HI8.store = {
    get: function (k, d) {
      try { var v = window.localStorage.getItem('hi8.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    set: function (k, v) { try { window.localStorage.setItem('hi8.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del: function (k) { try { window.localStorage.removeItem('hi8.' + k); } catch (e) { /* private mode */ } }
  };
  HI8.me = function () { return store.get('me', null) || {}; };

  // ---------------------------------------------------------------- screens that re-render on new data
  var watchers = [], hooks = [];
  HI8.watch = function (cmp) { if (watchers.indexOf(cmp) < 0) watchers.push(cmp); };
  HI8.onData = function (fn) { hooks.push(fn); }; // e.g. the forecast engine rebuilding itself
  HI8.changed = function () {
    hooks.forEach(function (fn) { try { fn(); } catch (e) { if (window.console) console.error('[hi8]', e); } });
    watchers.forEach(function (c) { try { c.forceUpdate(); } catch (e) { /* gone */ } });
  };

  // ---------------------------------------------------------------- Supabase
  HI8.rpc = function (fn, args, jwt) {
    if (!HI8.live) return Promise.reject(Object.assign(new Error('offline_build'), { status: 0 }));
    var h = { 'Content-Type': 'application/json', 'Accept': 'application/json', 'apikey': KEY };
    if (jwt) h.Authorization = 'Bearer ' + jwt;
    else if (/^eyJ/.test(KEY)) h.Authorization = 'Bearer ' + KEY; // an older project's anon key
    return fetch(API + '/rest/v1/rpc/' + fn, { method: 'POST', headers: h, body: JSON.stringify(args || {}) })
      .then(function (r) {
        return r.text().then(function (t) {
          var b = null;
          try { b = t ? JSON.parse(t) : null; } catch (e) { b = null; }
          if (!r.ok) {
            var err = new Error((b && b.message) || ('HTTP ' + r.status));
            err.status = r.status; err.hint = b && b.hint; err.code = b && b.code;
            throw err;
          }
          return b;
        });
      });
  };
  HI8.timeout = function (p, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { rej(new Error('timeout')); }, ms);
      p.then(function (v) { clearTimeout(t); res(v); }, function (e) { clearTimeout(t); rej(e); });
    });
  };
  // no answer at all (offline, a dropped connection) as opposed to Supabase saying no
  HI8.unreachable = function (e) { return !e || !e.status; };

  // calls that couldn't reach Supabase are kept in this browser and sent again on the next page
  HI8.later = function (fn, args) {
    var q = store.get('queue', []);
    q.push({ fn: fn, args: args, at: Date.now() });
    store.set('queue', q.slice(-20));
  };
  var flushing = null;
  HI8.flushQueue = function () {
    if (flushing) return flushing;
    var q = store.get('queue', []);
    if (!q.length || !HI8.live) return Promise.resolve();
    store.set('queue', []);
    flushing = q.reduce(function (p, item) {
      return p.then(function () {
        if (Date.now() - item.at > 7 * 864e5) return null;
        var args = Object.assign({}, item.args);
        if ('p_key' in args) {
          if (!HI8.me().key) return null; // never signed up on this device: nothing to attach it to
          args.p_key = HI8.me().key;
        }
        return HI8.rpc(item.fn, args).then(function (out) {
          if (item.fn === 'hi8_join') HI8.saveMe(out);
        }, function (e) { if (HI8.unreachable(e) || e.status >= 500 || e.status === 404) HI8.later(item.fn, item.args); });
      });
    }, Promise.resolve()).then(function () { flushing = null; });
    return flushing;
  };
  // a call made with this browser's key; queued if Supabase can't be reached
  HI8.withKey = function (fn, args, opts) {
    var k = HI8.me().key, queue = !(opts && opts.noQueue);
    if (!k) { if (queue) HI8.later(fn, Object.assign({ p_key: null }, args)); return Promise.reject(Object.assign(new Error('no_key'), { status: 401 })); }
    return HI8.rpc(fn, Object.assign({ p_key: k }, args)).catch(function (e) {
      if (queue && HI8.unreachable(e)) HI8.later(fn, Object.assign({ p_key: null }, args));
      if (e.message === 'unknown_key') store.del('me'); // the list was reset: sign up again
      throw e;
    });
  };
  HI8.saveMe = function (out) {
    if (!out || !out.key) return;
    var m = HI8.me();
    if (out.existing === false && m.key) {
      // a different person on this device: forget the last one's choices
      m = {};
      ['rsvp', 'cities', 'cityMine', 'mine'].forEach(store.del);
    }
    m.key = out.key;
    m.city = out.city || m.city;
    m.plates = m.plates || {};
    if (out.city && out.plate != null) m.plates[out.city] = out.plate;
    store.set('me', m);
  };

  // ---------------------------------------------------------------- live data, refreshed in the background
  function loader(name, fn, args, cacheKey) {
    var running = null;
    HI8[name] = store.get(cacheKey, null);
    return function (force) {
      if (running && !force) return running;
      running = fn().then(function (v) {
        HI8[name] = v; store.set(cacheKey, v); HI8.changed(); running = null; return v;
      }, function (e) { running = null; throw e; });
      return running;
    };
  }
  HI8.EVENT = 'founding-night-bcn';
  HI8.loadCounts = loader('counts', function () { return HI8.rpc('hi8_counts', { p_event: HI8.EVENT }); }, null, 'counts');
  HI8.loadCrews = loader('crews', function () { return HI8.rpc('hi8_crews', {}); }, null, 'crews');
  HI8.loadMine = loader('mine', function () { return HI8.withKey('hi8_me', {}, { noQueue: true }); }, null, 'mine');
  HI8.loadPlaces = loader('places', function () { return HI8.rpc('hi8_places', {}); }, null, 'places');

  // the open cities' spots, used until Supabase answers (same as supabase/migrations/0003_crews.sql)
  var BUILT_IN = {
    cities: [
      { slug: 'amsterdam', name: 'Amsterdam', status: 'open', tz: 'Europe/Amsterdam' }, { slug: 'barcelona', name: 'Barcelona', status: 'open', tz: 'Europe/Madrid' },
      { slug: 'berlin', name: 'Berlin', status: 'soon', tz: 'Europe/Berlin' }, { slug: 'lisbon', name: 'Lisbon', status: 'soon', tz: 'Europe/Lisbon' },
      { slug: 'tarifa', name: 'Tarifa', status: 'soon', tz: 'Europe/Madrid' }],
    hubs: [
      { city: 'amsterdam', slug: 'west', name: 'SLOTERDIJK', sub: 'AMSTERDAM WEST', lat: 52.3889, lon: 4.8378 },
      { city: 'amsterdam', slug: 'cs', name: 'CENTRAAL', sub: 'THE CENTRE', lat: 52.3791, lon: 4.9003 },
      { city: 'amsterdam', slug: 'zuid', name: "A'DAM ZUID", sub: 'ZUID + AMSTELVEEN', lat: 52.3389, lon: 4.8730 },
      { city: 'amsterdam', slug: 'hlm', name: 'HAARLEM', sub: 'HAARLEM STATION', lat: 52.3874, lon: 4.6383 },
      { city: 'barcelona', slug: 'sants', name: 'SANTS', sub: 'SANTS STATION', lat: 41.3793, lon: 2.1400 },
      { city: 'barcelona', slug: 'gracia', name: 'GRÀCIA', sub: 'PASSEIG DE GRÀCIA', lat: 41.3926, lon: 2.1648 },
      { city: 'barcelona', slug: 'sagrera', name: 'LA SAGRERA', sub: 'SANT ANDREU', lat: 41.4220, lon: 2.1890 }],
    spots: [
      ['wijk-aan-zee', 'amsterdam', 'Wijk aan Zee', 52.496, 4.582, ['kite', 'wing', 'surf'], 280, 200, 320],
      ['ijmuiden', 'amsterdam', 'IJmuiden', 52.460, 4.555, ['kite', 'wing', 'sup'], 275, 200, 340],
      ['zandvoort', 'amsterdam', 'Zandvoort', 52.373, 4.523, ['surf', 'kite'], 285, 200, 330],
      ['sloterplas', 'amsterdam', 'Sloterplas', 52.365, 4.810, ['sup'], null, null, null, true],
      ['schoorl', 'amsterdam', 'Schoorl dunes', 52.701, 4.687, ['mtb']],
      ['amsterdamse-bos', 'amsterdam', 'Amsterdamse Bos', 52.330, 4.840, ['mtb']],
      ['lelystad-mx', 'amsterdam', 'Lelystad MX', 52.490, 5.510, ['mx'], null, null, null, false, "Check the track's opening days before you go"],
      ['castelldefels', 'barcelona', 'Castelldefels', 41.268, 1.985, ['kite', 'wing'], 170, 90, 250, false, 'Kite is banned in bathing zones 1 June to 30 September'],
      ['sant-pere-pescador', 'barcelona', 'Sant Pere Pescador', 42.190, 3.110, ['kite', 'wing'], 100, 350, 190],
      ['masnou', 'barcelona', 'Masnou', 41.476, 2.318, ['surf'], 150, 60, 220],
      ['barceloneta', 'barcelona', 'Barceloneta', 41.378, 2.193, ['sup', 'surf'], 140, 60, 220],
      ['garraf', 'barcelona', 'Garraf', 41.250, 1.900, ['sup'], 200, 120, 280],
      ['collserola', 'barcelona', 'Collserola', 41.418, 2.115, ['mtb']],
      ['garraf-park', 'barcelona', 'Garraf park', 41.290, 1.870, ['mtb']],
      ['carcavelos', 'lisbon', 'Carcavelos', 38.678, -9.335, ['surf'], 200, 120, 280],
      ['guincho', 'lisbon', 'Guincho', 38.730, -9.473, ['kite', 'surf'], 270, 300, 30],
      ['costa-da-caparica', 'lisbon', 'Costa da Caparica', 38.640, -9.240, ['surf'], 260, 180, 340],
      ['lagoa-albufeira', 'lisbon', 'Lagoa de Albufeira', 38.510, -9.170, ['wing', 'sup'], null, null, null, true],
      ['sintra', 'lisbon', 'Sintra', 38.790, -9.390, ['mtb']],
      ['los-lances', 'tarifa', 'Los Lances', 36.030, -5.630, ['kite'], 200, 60, 300],
      ['valdevaqueros', 'tarifa', 'Valdevaqueros', 36.070, -5.680, ['kite', 'wing'], 200, 60, 300],
      ['el-palmar', 'tarifa', 'El Palmar', 36.240, -6.070, ['surf'], 250, 170, 330],
      ['alcornocales', 'tarifa', 'Alcornocales', 36.400, -5.600, ['mtb']],
      ['muggelsee', 'berlin', 'Müggelsee', 52.440, 13.650, ['wing', 'sup'], null, null, null, true],
      ['wannsee', 'berlin', 'Wannsee', 52.430, 13.170, ['sup'], null, null, null, true],
      ['grunewald', 'berlin', 'Grunewald', 52.480, 13.250, ['mtb']],
      ['teufelsberg', 'berlin', 'Teufelsberg', 52.497, 13.241, ['mtb']]
    ].map(function (x) {
      return { slug: x[0], city: x[1], name: x[2], lat: x[3], lon: x[4], sports: x[5], face: x[6] == null ? null : x[6],
        good_from: x[7] == null ? null : x[7], good_to: x[8] == null ? null : x[8], lake: !!x[9], note: x[10] || null };
    })
  };
  HI8.placesNow = function () { return HI8.places && HI8.places.spots && HI8.places.spots.length ? HI8.places : BUILT_IN; };
  HI8.spotsOf = function (city) { return HI8.placesNow().spots.filter(function (s) { return s.city === city; }); };
  HI8.spot = function (slug) { return HI8.placesNow().spots.filter(function (s) { return s.slug === slug; })[0] || null; };
  HI8.hubsOf = function (city) { return HI8.placesNow().hubs.filter(function (h) { return h.city === city; }); };
  HI8.km = function (a, b) {
    var R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.sqrt(x));
  };
  // driving time, roughly: roads are 1.3x the straight line at about 60 km/h, plus 8 minutes of town
  HI8.driveMin = function (a, b) { return Math.max(5, Math.round(HI8.km(a, b) * 1.3 / 60 * 60 + 8)); };
  // fuel for the round trip (6.5 l/100 km at €1.95) split by everyone in the car, rounded up to 10 cents
  HI8.fuelEach = function (a, b, people) { var e = HI8.km(a, b) * 1.3 * 2 * 0.065 * 1.95 / Math.max(1, people || 1); return '€' + (Math.ceil(e * 10) / 10).toFixed(2); };

  // ---------------------------------------------------------------- the real forecast (Open-Meteo)
  var FX_TTL = 30 * 60e3;
  var HRS = [8, 9, 10, 11, 12, 13, 14, 15, 16];
  function avg(a) { a = a.filter(function (x) { return x != null && !isNaN(x); }); return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
  function vecDir(dirs, ws) { // mean wind direction, weighted by speed
    var x = 0, y = 0;
    dirs.forEach(function (d, i) { var w = ws[i] || 1, r = d * Math.PI / 180; x += Math.sin(r) * w; y += Math.cos(r) * w; });
    var deg = Math.atan2(x, y) * 180 / Math.PI;
    return Math.round((deg + 360) % 360);
  }
  function hhmm(iso) { return iso ? iso.slice(11, 16) : null; }
  function list(x) { return Array.isArray(x) ? x : [x]; }

  // one location's Open-Meteo answer → today and the next three days, hours 08:00–16:00
  function normalise(wx, sea, models) {
    var H = wx.hourly, idx = {}, seaAt = {}, modAt = {};
    H.time.forEach(function (t, i) { idx[t] = i; });
    if (sea && sea.hourly) sea.hourly.time.forEach(function (t, i) { seaAt[t] = i; });
    if (models && models.hourly) models.hourly.time.forEach(function (t, i) { modAt[t] = i; });
    var offset = (wx.utc_offset_seconds || 0) * 1000;
    var local = new Date(Date.now() + offset).toISOString(), today = local.slice(0, 10), nowHour = Number(local.slice(11, 13));
    var dates = [0, 1, 2, 3].map(function (n) { var d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); });
    var S = sea && sea.hourly ? sea.hourly : {};
    var M = models && models.hourly ? models.hourly : null;
    var days = dates.map(function (date) {
      var hrs = HRS.map(function (h) {
        var t = date + 'T' + (h < 10 ? '0' : '') + h + ':00', i = idx[t], j = seaAt[t];
        if (i === undefined) return null;
        return { h: h, w: H.wind_speed_10m[i], g: H.wind_gusts_10m[i], dir: H.wind_direction_10m[i], r: H.precipitation_probability ? H.precipitation_probability[i] : null,
          mm: H.precipitation ? H.precipitation[i] : null, t: H.temperature_2m ? H.temperature_2m[i] : null, cc: H.cloud_cover ? H.cloud_cover[i] : null,
          wv: j !== undefined && S.wave_height ? S.wave_height[j] : null, per: j !== undefined && S.wave_period ? S.wave_period[j] : null,
          wdir: j !== undefined && S.wave_direction ? S.wave_direction[j] : null, sst: j !== undefined && S.sea_surface_temperature ? S.sea_surface_temperature[j] : null };
      });
      if (hrs.some(function (x) { return !x || x.w == null; })) return { date: date, none: true };
      // rain in the 24 hours before 09:00: muddy trails, tacky MX tracks
      var nine = idx[date + 'T09:00'], wet = 0;
      for (var k = Math.max(0, nine - 24); k < nine; k++) wet += (H.precipitation && H.precipitation[k]) || 0;
      // tide from the sea level (tide + surge): high water nearest midday, the day's high and low
      var tide = null;
      if (S.sea_level_height_msl) {
        var lv = [];
        for (var hh = 0; hh < 24; hh++) { var jj = seaAt[date + 'T' + (hh < 10 ? '0' : '') + hh + ':00']; if (jj !== undefined && S.sea_level_height_msl[jj] != null) lv.push({ h: hh, v: S.sea_level_height_msl[jj] }); }
        if (lv.length >= 20) {
          var hi = Math.max.apply(null, lv.map(function (x) { return x.v; })), lo = Math.min.apply(null, lv.map(function (x) { return x.v; }));
          if (hi - lo >= 0.3) {
            var peaks = lv.filter(function (x, n) { return n > 0 && n < lv.length - 1 && x.v >= lv[n - 1].v && x.v >= lv[n + 1].v; });
            var pk = (peaks.length ? peaks : lv).slice().sort(function (a, b) { return Math.abs(a.h - 12.5) - Math.abs(b.h - 12.5); })[0];
            tide = { th: pk.h, hiM: Math.round(hi * 10) / 10, loM: Math.round(lo * 10) / 10 };
          }
        }
      }
      // how many of three weather models agree on the day's wind (within 4 knots of the middle one)
      var agree = null;
      if (M) {
        var keys = ['wind_speed_10m_ecmwf_ifs025', 'wind_speed_10m_icon_seamless', 'wind_speed_10m_gfs_seamless'].filter(function (k2) { return M[k2]; });
        var peaksM = keys.map(function (k2) { return Math.max.apply(null, [10, 11, 12, 13, 14, 15, 16].map(function (h) { var q = modAt[date + 'T' + h + ':00']; return q === undefined ? 0 : (M[k2][q] || 0); })); });
        if (peaksM.length === 3) { var srt = peaksM.slice().sort(function (a, b) { return a - b; }), mid = srt[1]; agree = peaksM.filter(function (p) { return Math.abs(p - mid) <= 4; }).length; }
      }
      var win = hrs.slice(2, 9);
      var cc = avg(win.map(function (x) { return x.cc; })), rmax = Math.max.apply(null, win.map(function (x) { return x.r || 0; }));
      var di = wx.daily ? wx.daily.time.indexOf(date) : -1;
      return {
        date: date, hrs: hrs, wet: wet >= 2 ? 1 : 0, wetMm: Math.round(wet * 10) / 10,
        dir: vecDir(win.map(function (x) { return x.dir; }), win.map(function (x) { return x.w; })),
        swd: avg(win.map(function (x) { return x.wdir; })) == null ? null : vecDir(win.map(function (x) { return x.wdir || 0; }), win.map(function () { return 1; })),
        per: avg(win.map(function (x) { return x.per; })) == null ? null : Math.round(avg(win.map(function (x) { return x.per; }))),
        air: Math.round(avg(win.map(function (x) { return x.t; }))),
        sst: avg(hrs.map(function (x) { return x.sst; })) == null ? null : Math.round(avg(hrs.map(function (x) { return x.sst; }))),
        sky: rmax >= 60 ? 'RAINY' : cc == null ? 'BRIGHT' : cc < 25 ? 'SUNNY' : cc < 65 ? 'BRIGHT' : 'CLOUDY',
        sunset: di >= 0 && wx.daily.sunset ? hhmm(wx.daily.sunset[di]) : null, tide: tide, agree: agree
      };
    });
    var cur = idx[today + 'T' + (nowHour < 10 ? '0' : '') + nowHour + ':00'];
    return { days: days, now: cur === undefined ? null : { w: Math.round(H.wind_speed_10m[cur]), g: Math.round(H.wind_gusts_10m[cur]), dir: H.wind_direction_10m[cur], h: nowHour } };
  }

  function getJSON(u) {
    return HI8.timeout(fetch(u).then(function (r) { if (!r.ok) throw new Error('forecast_' + r.status); return r.json(); }), 9000);
  }
  // fetches the forecast for these cities' spots (one call for the weather, one for the sea, one for model agreement)
  HI8.fetchForecast = function (cities) {
    var spots = HI8.placesNow().spots.filter(function (s) { return cities.indexOf(s.city) >= 0; });
    if (!spots.length) return Promise.resolve({});
    var lat = spots.map(function (s) { return s.lat; }).join(','), lon = spots.map(function (s) { return s.lon; }).join(',');
    var sea = spots.filter(function (s) { return !s.lake && s.face != null; });
    var lead = cities.map(function (c) { return spots.filter(function (s) { return s.city === c; })[0]; }).filter(Boolean);
    var wxU = METEO + '/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation_probability,precipitation,temperature_2m,cloud_cover' +
      '&daily=sunset&wind_speed_unit=kn&timezone=auto&forecast_days=4&past_days=1' + KEYQ;
    var seaU = sea.length ? MARINE + '/v1/marine?latitude=' + sea.map(function (s) { return s.lat; }).join(',') + '&longitude=' + sea.map(function (s) { return s.lon; }).join(',') +
      '&hourly=wave_height,wave_period,wave_direction,sea_surface_temperature,sea_level_height_msl&timezone=auto&forecast_days=4&past_days=1' + KEYQ : null;
    var modU = METEO + '/v1/forecast?latitude=' + lead.map(function (s) { return s.lat; }).join(',') + '&longitude=' + lead.map(function (s) { return s.lon; }).join(',') +
      '&hourly=wind_speed_10m&models=ecmwf_ifs025,icon_seamless,gfs_seamless&wind_speed_unit=kn&timezone=auto&forecast_days=4' + KEYQ;
    return Promise.all([getJSON(wxU), seaU ? getJSON(seaU).catch(function () { return null; }) : null, getJSON(modU).catch(function () { return null; })])
      .then(function (r) {
        var wx = list(r[0]), sl = r[1] ? list(r[1]) : [], md = r[2] ? list(r[2]) : [], out = {};
        spots.forEach(function (s, i) {
          var si = sea.indexOf(s), li = lead.map(function (x) { return x.city; }).indexOf(s.city);
          out[s.slug] = normalise(wx[i], si >= 0 ? sl[si] : null, li >= 0 ? md[li] : null);
        });
        return out;
      });
  };
  // the forecast for the cities this screen shows, from this browser's cache when it's under 30 minutes old
  HI8.loadForecast = function (cities, force) {
    var key = 'fx.' + cities.slice().sort().join('+'), c = store.get(key, null);
    var today = new Date().toISOString().slice(0, 10);
    if (c && !force && Date.now() - c.at < FX_TTL && c.day === today) { HI8.fx = Object.assign(HI8.fx || {}, c.spots); HI8.fxAt = c.at; return Promise.resolve(HI8.fx); }
    return HI8.fetchForecast(cities).then(function (spots) {
      store.set(key, { at: Date.now(), day: today, spots: spots });
      HI8.fx = Object.assign(HI8.fx || {}, spots); HI8.fxAt = Date.now(); HI8.fxError = null; HI8.changed(); return HI8.fx;
    }, function (e) {
      HI8.fxError = e && e.message || 'forecast_unavailable';
      if (c) { HI8.fx = Object.assign(HI8.fx || {}, c.spots); HI8.fxAt = c.at; } // an older forecast beats none; screens say how old
      HI8.changed();
      return HI8.fx;
    });
  };

  // ---------------------------------------------------------------- sign-in links, first touch, the queue
  (function firstTouch() {
    if (store.get('src', null)) return;
    var P = HI8.params, src = P.get('utm_source'), camp = P.get('utm_campaign'), ref = P.get('ref'), host = '';
    try { host = document.referrer ? new URL(document.referrer).hostname : ''; } catch (e) { host = ''; }
    if (!src && host && host !== location.hostname) src = host.replace(/^www\./, '');
    if (src || ref) store.set('src', { source: src ? [src, camp].filter(Boolean).join('/').slice(0, 80) : null, ref: ref ? ref.slice(0, 40) : null });
  })();

  // back from the email link or Google: swap the sign-in for this browser's key
  HI8.claiming = null;
  (function claim() {
    var h = location.hash;
    if (!h || h.length < 2 || !/access_token=|error/.test(h)) return;
    var hp = new URLSearchParams(h.slice(1)), at = hp.get('access_token');
    history.replaceState(null, '', location.pathname + location.search);
    if (!at || !HI8.live) return;
    var after = store.get('after', null) || {};
    HI8.claiming = HI8.rpc('hi8_claim', { p_city: after.city || (store.get('pick', null) || {}).city || 'amsterdam' }, at).then(function (out) {
      HI8.saveMe(Object.assign({ existing: true }, out));
      store.del('after');
      var next = after.next && after.next.indexOf('B27-Onboard') !== 0 ? after.next : (out.onboarded ? 'B27-Home.dc.html' : null);
      if (next && next.split('?')[0] !== HI8.screen + '.dc.html') location.replace(next);
    }, function (e) { if (window.console) console.warn('[hi8] sign-in link:', e.message); });
  })();

  HI8.ready = HI8.live ? HI8.flushQueue() : Promise.resolve();
  if (HI8.live) {
    HI8.loadPlaces().catch(noop);
    HI8.loadCounts().catch(noop);
    HI8.loadCrews().catch(noop);
    HI8.ready.then(function () { if (HI8.me().key) HI8.loadMine().catch(noop); });
  }

  // every screen re-draws when its live data changes
  // the plate badge in the app's top bar shows this rider's own plate (or + to get one)
  function plateBadge() {
    var t = document.querySelector('.tb25 a[href="B27-Me.dc.html"] svg text');
    if (!t) return;
    var m = HI8.me(), pl = m.plates || {}, n = pl[m.city] || pl[Object.keys(pl)[0]], want = n ? String(n) : '+';
    if (t.textContent !== want) t.textContent = want;
  }
  window.DC_EXTEND = (window.DC_EXTEND || []).concat([function (C) {
    return class extends C {
      componentDidMount() { if (super.componentDidMount) super.componentDidMount(); HI8.watch(this); plateBadge(); }
      componentDidUpdate() { if (super.componentDidUpdate) super.componentDidUpdate(); plateBadge(); }
    };
  }]);

  // which cities' forecast this screen needs before it draws
  var FX_SCREENS = { 'B27-Landing': 1, 'B27-Web': 1, 'B27-Home': 1, 'B27-Spot': 1, 'B27-Map': 1, 'B27-Start': 1, 'B27-Crew': 1, 'B27-Onboard': 1 };
  if (FX_SCREENS[HI8.screen]) {
    window.DC_READY = HI8.timeout(HI8.loadForecast(['amsterdam', 'barcelona']), 6000).catch(noop);
  } else if (HI8.screen === 'B27-City') {
    window.DC_READY = HI8.timeout(HI8.loadForecast(['lisbon', 'tarifa', 'berlin']), 6000).catch(noop);
  }
  // keep it fresh while the page stays open
  setInterval(function () { if (FX_SCREENS[HI8.screen]) HI8.loadForecast(['amsterdam', 'barcelona'], true).catch(noop); }, FX_TTL);
})();
