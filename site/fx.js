/*
 * Hi8ctane forecast engine (2.9). The real forecast from Open-Meteo, rated hour by hour per sport.
 *
 *   FX.load(city, spots)      weather + three other models + sea, per spot, 7 days hourly (cached 30 min)
 *   FX.dayInfo(...)           a day's numbers (rain chance, cloud, temperatures, waves, water, light)
 *   FX.agreement(rows)        how many of ECMWF, ICON and GFS see the same as the main model
 *   FX.grid(city)             wind on a grid over the region, for the live map (cached 30 min)
 *   FX.rate(sport, spot, h)   one hour: score 0-10, label, why, kite size, shore, ground
 *   FX.windows(...)           the good stretches of a day; FX.bestDays(...) the best window per day
 *
 * Kite: 15-25 kt is the sweet spot, gusts and wind direction matter (offshore = no go, on lagoons any
 * direction works). MTB: rain now, mud from the last 24 hours of rain, heat, cold, storms. MX: light rain
 * before = tacky (the best), heavy rain = mud. Kite size = 2.2 x weight (kg) / wind (kt).
 *
 * Nothing is made up: when Open-Meteo can't be reached, FX says so (FX.error) and the screens show that.
 * Open-Meteo's free API is for non-commercial use: put a paid plan's key in config.js (meteoKey).
 */
(function (root) {
  'use strict';
  var CFG = (root.HI8_CONFIG || {});
  var MKEY = String(CFG.meteoKey || '').trim();
  var METEO = String(CFG.forecastApi || (MKEY ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com')).replace(/\/+$/, '');
  var MARINE = String(CFG.marineApi || (MKEY ? 'https://customer-marine-api.open-meteo.com' : 'https://marine-api.open-meteo.com')).replace(/\/+$/, '');
  var KEYQ = MKEY ? '&apikey=' + encodeURIComponent(MKEY) : '';
  var TTL = 30 * 60e3;
  var V = 4; // cache version
  var DAYS = 7; // the spots: a week ahead (the sharp model covers the first two days, best_match the rest)

  // the sharpest model per city, with best_match filling anything it doesn't give
  var CITY_MODEL = { amsterdam: 'knmi_seamless', barcelona: 'meteofrance_seamless', berlin: 'icon_seamless' };
  var MODEL_NAME = { knmi_seamless: 'HARMONIE', meteofrance_seamless: 'AROME', icon_seamless: 'ICON', best_match: 'BEST', ecmwf_ifs025: 'ECMWF', gfs_seamless: 'GFS' };
  var OTHER = ['ecmwf_ifs025', 'icon_seamless', 'gfs_seamless'];
  // the map's wind grid per city: [south, west, north, east, rows, cols]
  var GRID = { barcelona: [40.4, 0.4, 42.6, 3.4, 6, 8], amsterdam: [51.9, 3.9, 53.1, 5.9, 5, 6], berlin: [52.2, 12.9, 52.8, 13.9, 4, 5] };

  var FX = { CITY_MODEL: CITY_MODEL, MODEL_NAME: MODEL_NAME, GRID: GRID, data: {}, gridData: {}, error: null };

  // ---------------------------------------------------------------- small helpers
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function num(x) { return x == null || isNaN(x) ? null : Number(x); }
  function avg(a) { a = a.filter(function (x) { return x != null && !isNaN(x); }); return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; }
  function angDiff(a, b) { var d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; }
  function inRange(d, from, to) { if (from == null || to == null) return true; d = (d % 360 + 360) % 360; return from <= to ? d >= from && d <= to : d >= from || d <= to; }
  function vecDir(dirs, ws) {
    var x = 0, y = 0;
    dirs.forEach(function (d, i) { if (d == null) return; var w = ws && ws[i] ? ws[i] : 1, r = d * Math.PI / 180; x += Math.sin(r) * w; y += Math.cos(r) * w; });
    if (!x && !y) return null;
    return Math.round((Math.atan2(x, y) * 180 / Math.PI + 360) % 360);
  }
  var COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  FX.compass = function (d) { return d == null ? '' : COMPASS[Math.round(((d % 360) + 360) % 360 / 22.5) % 16]; };
  FX.clamp = clamp; FX.avg = avg; FX.vecDir = vecDir; FX.angDiff = angDiff; FX.inRange = inRange;
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  FX.pad = pad;

  // "now" in a forecast's own time zone, as 'YYYY-MM-DDTHH:00'
  FX.localNow = function (offsetSec) {
    var d = new Date(Date.now() + (offsetSec || 0) * 1000);
    return d.toISOString().slice(0, 13) + ':00';
  };
  FX.addDays = function (date, n) { var d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  FX.dayName = function (date, today) {
    if (date === today) return 'TODAY';
    if (date === FX.addDays(today, 1)) return 'TOMORROW';
    return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(date + 'T12:00:00Z').getUTCDay()];
  };
  FX.dayShort = function (date) { return ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'][new Date(date + 'T12:00:00Z').getUTCDay()]; };

  // the model a value came from, merged: <var>_<model>, else <var>_best_match, else <var>
  function pickModel(j, m) {
    if (!j || !j.hourly) return j;
    var B = j.hourly, out = { time: B.time }, sfx = '_' + m, any = false;
    Object.keys(B).forEach(function (k) {
      if (m && k.length > sfx.length && k.slice(-sfx.length) === sfx) {
        any = true;
        var base = k.slice(0, -sfx.length), alt = B[base + '_best_match'] || [];
        out[base] = B[k].map(function (v, i) { return v == null ? (alt[i] == null ? null : alt[i]) : v; });
      }
    });
    Object.keys(B).forEach(function (k) {
      var b = k.replace(/_best_match$/, '');
      if (b !== k && !out[b]) out[b] = B[k];
      else if (!any && k.indexOf('_') > 0 && !out[k] && !/_best_match$/.test(k)) out[k] = B[k];
    });
    var d = j.daily;
    if (d) {
      var dd = { time: d.time };
      Object.keys(d).forEach(function (k) { var b = k.replace(/_(best_match|[a-z]+_seamless|[a-z]+_ifs025)$/, ''); if (!dd[b]) dd[b] = d[k]; });
      d = dd;
    }
    return Object.assign({}, j, { hourly: out, daily: d });
  }
  FX.pickModel = pickModel;
  function list(x) { return Array.isArray(x) ? x : [x]; }

  // ---------------------------------------------------------------- fetching
  var fetchJSON = function (u) {
    var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var t = setTimeout(function () { if (ctl) ctl.abort(); }, 12000);
    return fetch(u, ctl ? { signal: ctl.signal } : {}).then(function (r) {
      clearTimeout(t);
      if (!r.ok) throw new Error('forecast_' + r.status);
      return r.json();
    }, function (e) { clearTimeout(t); throw e; });
  };
  FX.setFetch = function (f) { fetchJSON = f; };
  function store(k, v) { try { if (v === undefined) return JSON.parse(root.localStorage.getItem('hi8.' + k)); root.localStorage.setItem('hi8.' + k, JSON.stringify(v)); } catch (e) { return null; } }

  FX.urls = function (city, spots) {
    var m = CITY_MODEL[city], lat = spots.map(function (s) { return s.lat; }).join(','), lon = spots.map(function (s) { return s.lon; }).join(',');
    var sea = spots.filter(function (s) { return !s.lake && s.face != null; });
    return {
      wx: METEO + '/v1/forecast?latitude=' + lat + '&longitude=' + lon +
        '&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,temperature_2m,precipitation,precipitation_probability,cloud_cover,weather_code' +
        '&daily=sunrise,sunset&wind_speed_unit=kn&timezone=auto&forecast_days=' + DAYS + '&past_days=1' + (m ? '&models=' + m + ',best_match' : '') + KEYQ,
      models: METEO + '/v1/forecast?latitude=' + lat + '&longitude=' + lon +
        '&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation&models=' + OTHER.join(',') + '&wind_speed_unit=kn&timezone=auto&forecast_days=' + DAYS + KEYQ,
      sea: sea.length ? MARINE + '/v1/marine?latitude=' + sea.map(function (s) { return s.lat; }).join(',') + '&longitude=' + sea.map(function (s) { return s.lon; }).join(',') +
        '&hourly=wave_height,wave_period,wave_direction,sea_surface_temperature&timezone=auto&forecast_days=' + DAYS + KEYQ : null,
      seaSpots: sea
    };
  };

  // one spot's answers -> hourly rows (yesterday + 3 days), keyed by local time
  function build(spot, wx, mod, sea, city) {
    var H = wx.hourly, M = mod && mod.hourly, S = sea && sea.hourly, mi = {}, si = {};
    if (M) M.time.forEach(function (t, i) { mi[t] = i; });
    if (S) S.time.forEach(function (t, i) { si[t] = i; });
    var g = function (A, i) { return A && A[i] != null ? A[i] : null; };
    var hours = H.time.map(function (t, i) {
      var j = mi[t], k = si[t];
      var row = { t: t, d: t.slice(0, 10), h: Number(t.slice(11, 13)), w: num(g(H.wind_speed_10m, i)), g: num(g(H.wind_gusts_10m, i)), dir: num(g(H.wind_direction_10m, i)),
        temp: num(g(H.temperature_2m, i)), mm: num(g(H.precipitation, i)), pop: num(g(H.precipitation_probability, i)), cc: num(g(H.cloud_cover, i)), code: num(g(H.weather_code, i)) };
      if (k !== undefined) { row.wv = num(g(S.wave_height, k)); row.per = num(g(S.wave_period, k)); row.wdir = num(g(S.wave_direction, k)); row.sst = num(g(S.sea_surface_temperature, k)); }
      if (j !== undefined) {
        row.m = {};
        OTHER.forEach(function (mm) {
          var w = g(M['wind_speed_10m_' + mm], j);
          if (w != null) row.m[mm] = { w: num(w), g: num(g(M['wind_gusts_10m_' + mm], j)), dir: num(g(M['wind_direction_10m_' + mm], j)), mm: num(g(M['precipitation_' + mm], j)) };
        });
      }
      return row;
    });
    // rain in the 24 hours before each hour (needs yesterday: past_days=1)
    var run = 0;
    hours.forEach(function (r, i) {
      run += r.mm || 0;
      if (i >= 24) run -= hours[i - 24].mm || 0;
      r.r24 = Math.round(Math.max(0, run - (r.mm || 0)) * 10) / 10;
    });
    var days = {};
    if (wx.daily && wx.daily.time) wx.daily.time.forEach(function (d, i) {
      days[d] = { sunrise: wx.daily.sunrise && wx.daily.sunrise[i] ? wx.daily.sunrise[i].slice(11, 16) : null, sunset: wx.daily.sunset && wx.daily.sunset[i] ? wx.daily.sunset[i].slice(11, 16) : null };
    });
    return { slug: spot.slug, city: city, model: CITY_MODEL[city] || 'best_match', offset: wx.utc_offset_seconds || 0, hours: hours, days: days };
  }

  FX.fetchCity = function (city, spots) {
    if (!spots.length) return Promise.resolve({});
    var u = FX.urls(city, spots), m = CITY_MODEL[city];
    return Promise.all([
      fetchJSON(u.wx),
      fetchJSON(u.models).catch(function () { return null; }),
      u.sea ? fetchJSON(u.sea).catch(function () { return null; }) : null
    ]).then(function (r) {
      var wx = list(r[0]).map(function (x) { return pickModel(x, m); }), md = r[1] ? list(r[1]) : [], sl = r[2] ? list(r[2]) : [], out = {};
      spots.forEach(function (s, i) {
        var si = u.seaSpots.indexOf(s);
        if (wx[i] && wx[i].hourly) out[s.slug] = build(s, wx[i], md[i] || null, si >= 0 ? sl[si] : null, city);
      });
      return out;
    });
  };

  // the forecast for a city's spots, from this browser's cache when it's under 30 minutes old
  FX.load = function (city, spots, force) {
    var key = 'fx28.' + city, c = store(key);
    var fresh = c && c.v === V && Date.now() - c.at < TTL && spots.every(function (s) { return c.spots[s.slug]; });
    if (fresh && !force) { FX.data[city] = c; FX.error = null; return Promise.resolve(c); }
    return FX.fetchCity(city, spots).then(function (sp) {
      var out = { v: V, at: Date.now(), city: city, spots: sp };
      store(key, out); FX.data[city] = out; FX.error = null; return out;
    }, function (e) {
      FX.error = (e && e.message) || 'forecast_unavailable';
      if (c && c.v === V) { FX.data[city] = c; c.stale = true; return c; } // an older forecast beats none; screens say how old
      throw e;
    });
  };

  // the map's wind grid: speed (kt), direction and rain for every hour, on rows x cols points
  FX.gridPoints = function (city) {
    var G = GRID[city]; if (!G) return [];
    var pts = [];
    for (var r = 0; r < G[4]; r++) for (var c = 0; c < G[5]; c++)
      pts.push([Math.round((G[0] + (G[2] - G[0]) * r / (G[4] - 1)) * 1000) / 1000, Math.round((G[1] + (G[3] - G[1]) * c / (G[5] - 1)) * 1000) / 1000]);
    return pts;
  };
  FX.grid = function (city, force) {
    var key = 'fxgrid.' + city, c = store(key), G = GRID[city];
    if (!G) return Promise.resolve(null);
    if (c && c.v === V && Date.now() - c.at < TTL && !force) { FX.gridData[city] = c; return Promise.resolve(c); }
    var pts = FX.gridPoints(city), m = CITY_MODEL[city];
    var u = METEO + '/v1/forecast?latitude=' + pts.map(function (p) { return p[0]; }).join(',') + '&longitude=' + pts.map(function (p) { return p[1]; }).join(',') +
      '&hourly=wind_speed_10m,wind_direction_10m,precipitation&wind_speed_unit=kn&timezone=auto&forecast_days=3' + (m ? '&models=' + m + ',best_match' : '') + KEYQ;
    return fetchJSON(u).then(function (j) {
      var L = list(j).map(function (x) { return pickModel(x, m); });
      var H0 = L[0].hourly;
      var out = { v: V, at: Date.now(), city: city, rows: G[4], cols: G[5], box: G.slice(0, 4), time: H0.time, offset: L[0].utc_offset_seconds || 0,
        // per point: [speeds], [directions], [rain mm x10], rounded to keep it small
        w: L.map(function (x) { return x.hourly.wind_speed_10m.map(function (v) { return v == null ? null : Math.round(v); }); }),
        d: L.map(function (x) { return x.hourly.wind_direction_10m.map(function (v) { return v == null ? null : Math.round(v); }); }),
        r: L.map(function (x) { return (x.hourly.precipitation || []).map(function (v) { return v == null ? 0 : Math.round(v * 10); }); }) };
      store(key, out); FX.gridData[city] = out; return out;
    }, function (e) {
      if (c && c.v === V) { FX.gridData[city] = c; c.stale = true; return c; }
      throw e;
    });
  };

  // ---------------------------------------------------------------- rating
  // where the wind comes from, compared with where the beach looks out to
  FX.shore = function (face, dir) {
    if (face == null || dir == null) return null;
    var d = angDiff(dir, face);
    return d <= 22.5 ? 'onshore' : d <= 67.5 ? 'cross-on' : d <= 112.5 ? 'side-shore' : d <= 157.5 ? 'cross-off' : 'offshore';
  };
  FX.kiteSize = function (w, kg) {
    if (w == null || w < 9) return null;
    return clamp(Math.round(2.2 * (kg || 75) / w), 5, 17);
  };
  FX.label = function (s) { return s == null ? '' : s >= 9 ? 'EPIC' : s >= 6 ? 'GOOD' : s >= 4 ? 'OK' : 'NO GO'; };
  FX.tone = function (s) { return s == null ? 'none' : s >= 9 ? 'epic' : s >= 6 ? 'good' : s >= 4 ? 'ok' : 'no'; };
  function dark(r, day) {
    if (!day || !day.sunrise || !day.sunset) return r.h < 7 || r.h > 19;
    var sr = Number(day.sunrise.slice(0, 2)) + Number(day.sunrise.slice(3, 5)) / 60, ss = Number(day.sunset.slice(0, 2)) + Number(day.sunset.slice(3, 5)) / 60;
    return r.h + 0.5 < sr || r.h + 0.5 > ss; // the middle of the hour is before sunrise or after sunset
  }
  FX.ground = function (sport, r24, temp) {
    if (r24 == null) return null;
    if (sport === 'mx') return r24 >= 15 ? 'muddy' : r24 >= 6 ? 'wet' : r24 >= 0.5 ? 'tacky' : 'dry';
    return r24 >= 10 ? 'muddy' : r24 >= 3 ? 'wet' : 'dry';
  };

  function wind(w) { // kite: how good is this much wind (kt), 0-10
    if (w < 10) return 0;
    if (w < 12) return 2 + (w - 10) * 0.5;
    if (w < 15) return 3 + (w - 12);
    if (w <= 18) return 7 + (w - 15) * (2 / 3);
    if (w <= 23) return 9.5;
    if (w <= 26) return 9.5 - (w - 23) * 0.5;
    if (w <= 30) return 8 - (w - 26) * 0.6;
    if (w <= 35) return 5.6 - (w - 30) * 0.6;
    return 1;
  }

  // one hour at one spot for one sport -> { s, label, why[], kite, shore, ground }
  FX.rate = function (sport, spot, r, day, opts) {
    if (!r || r.w == null) return null;
    opts = opts || {};
    var why = [], s, out = {};
    var storm = r.code != null && r.code >= 95;
    if (dark(r, day)) return { s: 0, label: 'DARK', why: ['dark'], dark: true };
    if (sport === 'kite' || sport === 'wing') {
      var w = r.w, g = r.g == null ? r.w : r.g;
      out.shore = spot.lake ? 'lagoon' : FX.shore(spot.face, r.dir);
      var okDir = spot.lake || inRange(r.dir, spot.good_from, spot.good_to);
      s = sport === 'wing' ? wind(w + 3) : wind(w);
      if (w < 10) why.push('too light');
      else if (w < 14) why.push('light: big kite');
      else if (w > 30) why.push('very strong');
      if (out.shore === 'offshore' || !okDir) { s = 0; why.push(out.shore === 'offshore' ? 'offshore: no go' : 'wrong direction here'); }
      else if (out.shore === 'cross-off') { s -= 3; why.push('cross-offshore: experts'); }
      else if (out.shore === 'onshore') { s -= 1; why.push('onshore: choppy'); }
      var gf = g - w;
      if (gf > 15 || g > 40) { s -= 3; why.push('very gusty'); } else if (gf > 10) { s -= 1.5; why.push('gusty'); }
      if (w >= 9) out.kite = FX.kiteSize(w, opts.kg);
    } else if (sport === 'mtb') {
      out.ground = FX.ground('mtb', r.r24);
      s = 9;
      if (out.ground === 'muddy') { s = 3; why.push('muddy: give the trails a day'); } else if (out.ground === 'wet') { s = 6; why.push('wet trails'); }
      if (r.temp != null) {
        if (r.temp >= 10 && r.temp <= 24 && out.ground === 'dry') s += 1;
        if (r.temp < 2) { s -= 3; why.push('freezing'); } else if (r.temp < 6) { s -= 1; why.push('cold'); }
        if (r.temp > 33) { s -= 3; why.push('very hot'); } else if (r.temp > 28) { s -= 1; why.push('hot: ride early'); }
      }
      if (r.g != null && r.g > 45) { s = Math.min(s, 2); why.push('storm gusts'); } else if (r.g != null && r.g > 35) { s -= 2; why.push('windy'); }
    } else if (sport === 'mx') {
      out.ground = FX.ground('mx', r.r24);
      s = out.ground === 'tacky' ? 9.5 : out.ground === 'dry' ? 7.5 : out.ground === 'wet' ? 5 : 2;
      why.push(out.ground === 'tacky' ? 'tacky: hero dirt' : out.ground === 'dry' ? 'dry, hard-pack' : out.ground === 'wet' ? 'wet track' : 'mud: tracks may close');
      if (r.temp != null) {
        if (out.ground === 'dry' && r.temp > 26) { s -= 1; why.push('dusty'); }
        if (r.temp < 2) { s -= 3; why.push('freezing'); } else if (r.temp > 33) { s -= 2; why.push('very hot'); }
      }
      if (r.g != null && r.g > 40) { s -= 2; why.push('gusty for jumps'); }
    } else {
      return null;
    }
    // rain now
    if (r.mm != null && r.mm >= 1) { s = Math.min(s, sport === 'kite' || sport === 'wing' ? s - 2 : 2); why.push('rain'); }
    else if (r.mm != null && r.mm >= 0.2) { s -= sport === 'kite' || sport === 'wing' ? 0.5 : 2; why.push('showers'); }
    if (storm) { s = 0; why.push('thunderstorm: stay off'); }
    out.s = Math.round(clamp(s, 0, 10) * 10) / 10;
    out.label = FX.label(out.s);
    out.why = why;
    return out;
  };

  // the hours of one day at one spot, with their ratings (from `from` to `to`, local hours)
  FX.dayRows = function (sp, date, sport, spot, opts, from, to) {
    if (!sp) return [];
    from = from == null ? 6 : from; to = to == null ? 21 : to;
    var day = sp.days[date];
    return sp.hours.filter(function (r) { return r.d === date && r.h >= from && r.h <= to; }).map(function (r) {
      return Object.assign({}, r, { rate: FX.rate(sport, spot, r, day, opts) });
    });
  };

  // the good stretches of one day: runs of hours rated GOOD or better (OK if there's nothing better)
  FX.windows = function (sp, date, sport, spot, opts) {
    var rows = FX.dayRows(sp, date, sport, spot, opts, 6, 21), nowT = FX.localNow(sp ? sp.offset : 0);
    rows = rows.filter(function (r) { return r.t >= nowT; }); // what's left of today
    var pick = function (min) {
      var runs = [], cur = null;
      rows.forEach(function (r) {
        var s = r.rate ? r.rate.s : 0;
        if (s >= min) { if (!cur) cur = { rows: [] }; cur.rows.push(r); } else if (cur) { runs.push(cur); cur = null; }
      });
      if (cur) runs.push(cur);
      return runs.filter(function (x) { return x.rows.length >= (sport === 'kite' || sport === 'wing' ? 2 : 2); });
    };
    var runs = pick(6);
    if (!runs.length) runs = pick(4);
    // a session is a few hours: the best stretch of up to 4 (kite) or 5 hours inside each good run
    var maxLen = sport === 'kite' || sport === 'wing' ? 4 : 5;
    return runs.map(function (x) {
      var all = x.rows, R = all, best = -1;
      if (all.length > maxLen) for (var i = 0; i + maxLen <= all.length; i++) {
        var a = avg(all.slice(i, i + maxLen).map(function (r) { return r.rate.s; }));
        if (a > best + 0.05) { best = a; R = all.slice(i, i + maxLen); }
      }
      var sc = avg(R.map(function (r) { return r.rate.s; }));
      var ws = R.map(function (r) { return r.w; });
      return { date: date, from: R[0].h, to: R[R.length - 1].h + 1, runFrom: all[0].h, runTo: all[all.length - 1].h + 1, hours: R.length, score: Math.round(sc * 10) / 10, label: FX.label(sc),
        w: Math.round(avg(ws)), g: Math.round(Math.max.apply(null, R.map(function (r) { return r.g || 0; }))), dir: vecDir(R.map(function (r) { return r.dir; }), ws),
        kite: R[0].rate.kite != null ? FX.kiteSize(avg(ws), opts && opts.kg) : null,
        shore: R[Math.floor(R.length / 2)].rate.shore || null, ground: R[0].rate.ground || null,
        temp: Math.round(avg(R.map(function (r) { return r.temp; })) || 0), why: R[Math.floor(R.length / 2)].rate.why, models: FX.agreement(R, sport) };
    }).sort(function (a, b) { return b.score * Math.sqrt(b.hours) - a.score * Math.sqrt(a.hours); });
  };

  // a crew's own window at its spot: the average rating, the wind, the models
  FX.span = function (sp, date, from, to, sport, spot, opts) {
    var rows = FX.dayRows(sp, date, sport, spot, opts, from, Math.max(from, to - 1));
    if (!rows.length || rows.some(function (r) { return r.w == null; })) return null;
    var ws = rows.map(function (r) { return r.w; }), sc = avg(rows.map(function (r) { return r.rate ? r.rate.s : 0; }));
    var models = {};
    OTHER.forEach(function (m) {
      var mw = rows.map(function (r) { return r.m && r.m[m] ? r.m[m].w : null; });
      if (mw.every(function (x) { return x != null; })) models[m] = Math.round(avg(mw));
    });
    var vals = Object.keys(models).map(function (k) { return models[k]; }).concat([Math.round(avg(ws))]);
    var spread = vals.length > 1 ? Math.max.apply(null, vals) - Math.min.apply(null, vals) : null;
    return { rows: rows, score: Math.round(sc * 10) / 10, label: FX.label(sc), w: Math.round(avg(ws)), g: Math.round(Math.max.apply(null, rows.map(function (r) { return r.g || 0; }))),
      dir: vecDir(rows.map(function (r) { return r.dir; }), ws), kite: rows[0].rate && rows[0].rate.kite != null ? FX.kiteSize(avg(ws), opts && opts.kg) : null,
      shore: rows[0].rate ? rows[0].rate.shore : null, ground: rows[0].rate ? rows[0].rate.ground : null, models: models, spread: spread,
      agree: spread == null ? null : spread <= 4 ? 'agree' : spread <= 8 ? 'roughly' : 'disagree', check: FX.agreement(rows, sport),
      temp: Math.round(avg(rows.map(function (r) { return r.temp; })) || 0), why: rows[Math.floor(rows.length / 2)].rate ? rows[Math.floor(rows.length / 2)].rate.why : [] };
  };

  // for a sport in a city: the best window per day across its spots (for "WHEN" and the landing)
  FX.bestDays = function (city, spots, sport, opts, n) {
    var D = FX.data[city]; if (!D) return [];
    var any = spots.map(function (s) { return D.spots[s.slug]; }).filter(Boolean)[0];
    if (!any) return [];
    var today = FX.localNow(any.offset).slice(0, 10), out = [];
    for (var k = 0; k < (n || 3); k++) {
      var date = FX.addDays(today, k), best = null;
      spots.forEach(function (s) {
        var ws = FX.windows(D.spots[s.slug], date, sport, s, opts);
        if (ws[0] && (!best || ws[0].score * Math.sqrt(ws[0].hours) > best.score * Math.sqrt(best.hours))) best = Object.assign({ spot: s }, ws[0]);
      });
      if (!best && !spots.some(function (s) { var sp = D.spots[s.slug]; return sp && sp.days[date]; })) out.push({ date: date, none: true, nodata: true });
      else out.push(best || { date: date, none: true });
    }
    return out;
  };

  // do the other three models (ECMWF, ICON, GFS) see the same thing over these hours?
  // kite: average wind within 4 kt of the main model; MTB/MX: rain (1 mm or more over the hours) or not
  FX.agreement = function (rows, sport) {
    if (!rows || !rows.length) return null;
    var windy = sport === 'kite' || sport === 'wing', main, n = 0, of = 0, names = [];
    main = windy ? avg(rows.map(function (r) { return r.w; })) : rows.reduce(function (t, r) { return t + (r.mm || 0); }, 0);
    OTHER.forEach(function (m) {
      var vals = rows.map(function (r) { return r.m && r.m[m] ? (windy ? r.m[m].w : r.m[m].mm) : null; });
      if (vals.some(function (x) { return x == null; })) return;
      of++;
      var v = windy ? avg(vals) : vals.reduce(function (t, x) { return t + x; }, 0);
      var same = windy ? Math.abs(v - main) <= 4 : (v >= 1) === (main >= 1);
      if (same) { n++; names.push(MODEL_NAME[m]); }
    });
    if (!of) return null;
    return { n: n, of: of, names: names, label: n === of ? 'SURE' : n >= of - 1 && of >= 2 ? 'LIKELY' : 'UNSURE' };
  };

  // one day at one spot, daylight hours: the numbers behind the rating
  FX.dayInfo = function (sp, date) {
    if (!sp) return null;
    var day = sp.days[date] || {}, rows = sp.hours.filter(function (r) { return r.d === date && !dark(r, day) && r.w != null; });
    if (!rows.length) return null;
    var mx = function (k) { var v = rows.map(function (r) { return r[k]; }).filter(function (x) { return x != null; }); return v.length ? Math.max.apply(null, v) : null; };
    var mn = function (k) { var v = rows.map(function (r) { return r[k]; }).filter(function (x) { return x != null; }); return v.length ? Math.min.apply(null, v) : null; };
    var rnd = function (x, d) { return x == null ? null : Math.round(x * (d || 1)) / (d || 1); };
    return { date: date, sunrise: day.sunrise || null, sunset: day.sunset || null, light: rows.length,
      w: rnd(avg(rows.map(function (r) { return r.w; }))), g: rnd(mx('g')), dir: vecDir(rows.map(function (r) { return r.dir; }), rows.map(function (r) { return r.w; })),
      tmin: rnd(mn('temp')), tmax: rnd(mx('temp')), pop: rnd(mx('pop')), mm: rnd(rows.reduce(function (t, r) { return t + (r.mm || 0); }, 0), 10),
      cloud: rnd(avg(rows.map(function (r) { return r.cc; }))), wave: rnd(mx('wv'), 10), period: rnd(mx('per')), sst: rnd(avg(rows.map(function (r) { return r.sst; })), 10) };
  };
  // where a day's numbers come from: the sharp regional model for two days, then the global models
  FX.sourceFor = function (city, date, today) {
    var m = CITY_MODEL[city];
    return m && date < FX.addDays(today, 2) ? MODEL_NAME[m] : 'ECMWF · ICON · GFS';
  };

  // spots for a sport ranked for a window (date, from, to)
  FX.rankSpots = function (city, spots, sport, date, from, to, opts) {
    var D = FX.data[city];
    return spots.map(function (s) {
      var sp = D && D.spots[s.slug], x = sp ? FX.span(sp, date, from, to, sport, s, opts) : null;
      return { spot: s, fx: x };
    }).sort(function (a, b) { return (b.fx ? b.fx.score : -1) - (a.fx ? a.fx.score : -1); });
  };

  root.FX = FX;
  if (typeof module !== 'undefined' && module.exports) module.exports = FX;
})(typeof window !== 'undefined' ? window : globalThis);
