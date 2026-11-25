// TEST ONLY. Serves a site folder like GitHub Pages and stands in for Supabase on the same origin:
//   /rest/v1/*  -> the local PostgREST (adds X-Forwarded-For from the X-Test-Ip header, like Supabase's gateway)
//   /auth/v1/*  -> recorded, so tests can check what the site asked Supabase Auth to do
// Usage: node serve.mjs <siteDir> <port> <live|off> [postgrestPort]
import { createServer, request } from 'node:http';
import { createHmac } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const [dir, port, mode, pgrst = '3300'] = process.argv.slice(2);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8' };
const authLog = [], meteoLog = [];

// A stand-in for Open-Meteo: the same JSON shapes, a made-up but plausible autumn week, the same for
// every run (keyed on the day), local time per location like timezone=auto.
function fakeMeteo(url) {
  const lats = url.searchParams.get('latitude').split(',').map(Number), lons = url.searchParams.get('longitude').split(',').map(Number);
  const marine = url.pathname === '/v1/marine', asked = url.searchParams.get('models') || '';
  const vars = (url.searchParams.get('hourly') || '').split(',');
  // models=<sharp>,best_match is a weather call answered per model (suffixed), like Open-Meteo; other models= calls compare models
  const multi = asked.includes('best_match') ? asked.split(',') : null, models = multi ? null : asked || null;
  const past = Number(url.searchParams.get('past_days') || 0), fdays = Number(url.searchParams.get('forecast_days') || 7);
  const one = (lat, lon) => {
    const off = 3600, tzName = lat < 45 ? 'Europe/Madrid' : 'Europe/Amsterdam';
    const local = new Date(Date.now() + off * 1000);
    const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - past));
    const days = fdays + past, time = [], H = {};
    // yesterday (dry), today (rain before dawn, then a SW breeze), tomorrow (light, rainy), then strong W, then calm
    const plan = [{ w: 14, gd: 6, dir: 240, p: 30, r: 0, t: 12, c: 60 }, { w: 19, gd: 5, dir: 235, p: 10, r: 1.0, night: true, t: 13, c: 20 }, { w: 7, gd: 3, dir: 270, p: 75, r: 0.8, t: 11, c: 85 },
      { w: 24, gd: 9, dir: 280, p: 20, r: 0, t: 12, c: 40 }, { w: 4, gd: 2, dir: 90, p: 5, r: 0, t: 10, c: 10 },
      // the rest of the week: a sea breeze, a wet day, then a building SW
      { w: 16, gd: 4, dir: 200, p: 10, r: 0, t: 14, c: 30 }, { w: 9, gd: 5, dir: 250, p: 80, r: 2.5, t: 10, c: 90 }, { w: 21, gd: 6, dir: 225, p: 15, r: 0, t: 13, c: 35 }];
    const coast = lat < 45 ? -4 : 0, inland = lon > 5 || (lat > 52.3 && lat < 52.37 && lon > 4.7) ? -5 : 0;
    for (let d = 0; d < days; d++) for (let h = 0; h < 24; h++) {
      const t = new Date(start.getTime() + (d * 24 + h) * 3600e3).toISOString().slice(0, 13) + ':00';
      time.push(t);
      const P = plan[Math.max(0, Math.min(plan.length - 1, d - past + 1))], aft = h >= 12 && h <= 16 ? 2 : 0;
      const push = (k, v) => (H[k] ||= []).push(v);
      // the map's grid (many points at once) gets some shape: more wind out at sea and in the north-east
      const shape = lats.length >= 20 ? Math.round(6 * Math.sin(lat * 2.1 + lon * 1.3) + 5 * Math.cos(lon * 2.7 - lat) + (lon - 1.8) * 3) : 0;
      const w = Math.max(0, P.w + aft + coast + inland + shape), rain = P.night ? (h >= 2 && h <= 6 ? P.r : 0) : P.r;
      if (marine) {
        const waves = [[1.8, 7], [1.2, 9], [1.4, 10], [2.4, 7], [0.5, 6], [0.8, 6], [1.6, 8], [1.1, 7]][Math.max(0, Math.min(7, d - past + 1))];
        push('wave_height', waves[0]); push('wave_period', waves[1]); push('wave_direction', 280); push('sea_surface_temperature', lat < 45 ? 18.4 : 12.6);
        push('sea_level_height_msl', lat < 45 ? 0.05 * Math.cos(h / 2) : Math.round(0.9 * Math.cos(2 * Math.PI * (h - 15.5 - d * 0.8) / 12.42) * 100) / 100);
      } else if (models) {
        const di = d - past;
        for (const m of models.split(',')) {
          const mw = m === 'icon_seamless' ? w + 1 : m === 'gfs_seamless' ? (di === 1 ? w + 9 : Math.max(0, w - 2)) : w;
          if (vars.includes('wind_speed_10m')) push('wind_speed_10m_' + m, mw);
          if (vars.includes('wind_gusts_10m')) push('wind_gusts_10m_' + m, mw + P.gd);
          if (vars.includes('wind_direction_10m')) push('wind_direction_10m_' + m, P.dir + (m === 'gfs_seamless' ? 10 : 0));
          if (vars.includes('precipitation')) push('precipitation_' + m, m === 'gfs_seamless' && di === 5 ? 0 : rain);
        }
      } else {
        push('wind_speed_10m', w); push('wind_gusts_10m', w + P.gd); push('wind_direction_10m', (P.dir + (lats.length >= 20 ? Math.round(25 * Math.sin(lat * 3 - lon * 2)) : 0) + 360) % 360);
        push('precipitation_probability', P.p); push('precipitation', rain); push('temperature_2m', P.t + (lat < 45 ? 7 : 0)); push('cloud_cover', P.c);
        if (vars.includes('weather_code')) push('weather_code', rain >= 0.5 ? 61 : P.c > 60 ? 3 : 1);
      }
    }
    const out = { latitude: lat, longitude: lon, utc_offset_seconds: off, timezone: tzName, hourly: Object.assign({ time }, H) };
    if (!marine && !models) {
      const dt = [...new Set(time.map((t) => t.slice(0, 10)))];
      out.daily = { time: dt, sunset: dt.map((x) => x + (lat < 45 ? 'T17:32' : 'T17:05')), sunrise: dt.map((x) => x + (lat < 45 ? 'T07:48' : 'T07:52')) };
    }
    if (multi) {
      // the sharp model: 1 kt more wind, no rain probability (best_match fills it in)
      const hh = { time }, dd = { time: out.daily.time };
      for (const m of multi) for (const [k, v] of Object.entries(H)) hh[k + '_' + m] = m === 'best_match' ? v : (k === 'precipitation_probability' ? v.map(() => null) : k.startsWith('wind_') && k !== 'wind_direction_10m' ? v.map((x) => x + 1) : v);
      for (const m of multi) { dd['sunset_' + m] = out.daily.sunset; dd['sunrise_' + m] = out.daily.sunrise; }
      out.hourly = hh; out.daily = dd;
    }
    return out;
  };
  const all = lats.map((la, i) => one(la, lons[i]));
  return all.length === 1 ? all[0] : all;
}

const avatars = new Map(), cartoonLog = [], fxFiles = new Map();
// a service-role JWT for the local PostgREST (its test secret), for the cartoon function
const SERVICE_JWT = (() => { const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = b({ alg: 'HS256', typ: 'JWT' }), p = b({ role: 'service_role', exp: 4102444800 });
  return `${h}.${p}.` + createHmac('sha256', 'test-secret-test-secret-test-secret-0123').update(`${h}.${p}`).digest('base64url'); })();
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__auth') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(authLog)); }
  if (url.pathname.startsWith('/auth/v1/')) {
    let body = ''; for await (const c of req) body += c;
    authLog.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), apikey: req.headers.apikey, body });
    res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}');
  }
  if (url.pathname === '/v1/forecast' || url.pathname === '/v1/marine') {
    meteoLog.push(url.pathname + url.search);
    if (process.env.METEO_DOWN === '1') { res.writeHead(503); return res.end('{}'); }
    const out = fakeMeteo(url);
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); return res.end(JSON.stringify(out));
  }
  // the cartoon Edge Function (2.18), run here with a fake OpenAI (it "draws" a test image) and Storage kept in memory
  if (url.pathname === '/functions/v1/cartoon' && mode === 'live') {
    let body = ''; for await (const c of req) body += c;
    const { cartoon } = await import('../../supabase/functions/_shared/cartoon.js');
    const fakeAi = async (u, init) => {
      if (u === 'https://api.openai.com/v1/images/edits') {
        cartoonLog.push({ prompt: init.body.get('prompt'), size: init.body.get('image').size });
        if (process.env.CARTOON_FAIL === '1') return new Response('{"error":{"code":"moderation_blocked","message":"rejected by the safety system"}}', { status: 400 });
        await new Promise((r) => setTimeout(r, Number(process.env.CARTOON_DELAY || 300)));
        return new Response(JSON.stringify({ data: [{ b64_json: (await readFile(join(dir, 'icon-512.png'))).toString('base64') }] }), { status: 200 });
      }
      if (u.includes('/storage/v1/object/avatars')) {
        if (init.method === 'POST') { avatars.set(u.split('/avatars/')[1], Buffer.from(init.body)); return new Response('{}'); }
        if (init.method === 'DELETE') { for (const x of JSON.parse(init.body).prefixes) avatars.delete(x); return new Response('[]'); }
      }
      return fetch(u, { ...init, headers: { ...init.headers, apikey: 'sb_publishable_test' } });
    };
    const env = { OPENAI_API_KEY: 'sk-test', SUPABASE_URL: `http://localhost:${port}`, SUPABASE_SERVICE_ROLE_KEY: SERVICE_JWT };
    try { const out = await cartoon(JSON.parse(body || '{}'), env, { fetch: fakeAi }); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(out)); }
    catch (e) { res.writeHead(e.status || 500, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ message: e.message, hint: e.hint || null })); }
  }
  if (url.pathname.startsWith('/storage/v1/object/public/avatars/')) {
    const b = avatars.get(decodeURIComponent(url.pathname.split('/avatars/')[1]));
    if (!b) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': 'image/png' }); return res.end(b);
  }
  // 2.27: the shared forecast in Storage (bucket fx), kept in memory: the worker writes it, pages read it
  if (url.pathname.startsWith('/storage/v1/object/fx/') && req.method === 'POST') {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ') || auth.split('.').length !== 3) { res.writeHead(403); return res.end('{"message":"not_allowed"}'); }
    let body = ''; for await (const c of req) body += c;
    fxFiles.set(decodeURIComponent(url.pathname.split('/fx/')[1]), body); res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{}');
  }
  if (url.pathname.startsWith('/storage/v1/object/public/fx/')) {
    const b = fxFiles.get(decodeURIComponent(url.pathname.split('/fx/')[1]));
    if (!b) { res.writeHead(400, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); return res.end('{"statusCode":"404","error":"not_found"}'); }
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'max-age=300' }); return res.end(b);
  }
  if (url.pathname === '/__fx') { if (req.method === 'DELETE') fxFiles.clear(); res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify([...fxFiles.keys()])); }
  if (url.pathname === '/__cartoon') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ calls: cartoonLog, files: [...avatars.keys()] })); }
  if (url.pathname === '/__meteo') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(meteoLog)); }
  if (url.pathname.startsWith('/rest/v1/')) {
    if (req.headers.apikey !== 'sb_publishable_test' && req.headers.apikey !== SERVICE_JWT) { res.writeHead(401); return res.end('{"message":"no apikey"}'); } // the service key: Edge Functions
    const headers = { 'content-type': req.headers['content-type'] || 'application/json', accept: 'application/json', 'x-forwarded-for': req.headers['x-test-ip'] || '10.0.0.1' };
    if (req.headers.authorization) headers.authorization = req.headers.authorization;
    const up = request({ host: '127.0.0.1', port: Number(pgrst), method: req.method, path: url.pathname.replace('/rest/v1', '') + url.search, headers }, (r) => {
      res.writeHead(r.statusCode, { 'content-type': r.headers['content-type'] || 'application/json' }); r.pipe(res);
    });
    up.on('error', (e) => { res.writeHead(502); res.end(String(e)); });
    req.pipe(up);
    return;
  }
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (p.endsWith('/')) p += 'index.html';
  if (mode === 'live' && p === '/config.js') {
    res.writeHead(200, { 'content-type': 'text/javascript' });
    return res.end(`window.HI8_CONFIG = { supabaseUrl: "http://localhost:${port}", publishableKey: "sb_publishable_test", forecastApi: "http://localhost:${port}", marineApi: "http://localhost:${port}", emailLink: ${process.env.EMAIL_LINK === '1'}, google: ${process.env.GOOGLE === '1'} };`);
  }
  try {
    let f = join(dir, p);
    if ((await stat(f)).isDirectory()) f = join(f, 'index.html');
    const b = await readFile(f);
    res.writeHead(200, { 'content-type': TYPES[extname(f)] || 'application/octet-stream' }); res.end(b);
  } catch {
    try { const b = await readFile(join(dir, '404.html')); res.writeHead(404, { 'content-type': 'text/html' }); res.end(b); }
    catch { res.writeHead(404); res.end('not found'); }
  }
}).listen(Number(port), () => console.log(`serving ${dir} on ${port} (${mode})`));
