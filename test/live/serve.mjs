// TEST ONLY. Serves a site folder like GitHub Pages and stands in for Supabase on the same origin:
//   /rest/v1/*  -> the local PostgREST (adds X-Forwarded-For from the X-Test-Ip header, like Supabase's gateway)
//   /auth/v1/*  -> recorded, so tests can check what the site asked Supabase Auth to do
// Usage: node serve.mjs <siteDir> <port> <live|off> [postgrestPort]
import { createServer, request } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';

const [dir, port, mode, pgrst = '3300'] = process.argv.slice(2);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const authLog = [], meteoLog = [];

// A stand-in for Open-Meteo: the same JSON shapes, a made-up but plausible autumn week, the same for
// every run (keyed on the day), local time per location like timezone=auto.
function fakeMeteo(url) {
  const lats = url.searchParams.get('latitude').split(',').map(Number), lons = url.searchParams.get('longitude').split(',').map(Number);
  const marine = url.pathname === '/v1/marine', models = url.searchParams.get('models');
  const one = (lat, lon) => {
    const off = lat < 45 ? 3600 : 3600, tzName = lat < 45 ? 'Europe/Madrid' : 'Europe/Amsterdam';
    const local = new Date(Date.now() + off * 1000);
    const start = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - (marine || !models ? 1 : 0)));
    const days = models ? 4 : 5, time = [], H = {};
    const plan = [{ w: 14, gd: 6, dir: 240, p: 80, r: 1.2, t: 12, c: 90 }, { w: 19, gd: 5, dir: 235, p: 10, r: 0, t: 13, c: 20 }, { w: 7, gd: 3, dir: 270, p: 75, r: 0.8, t: 11, c: 85 },
      { w: 24, gd: 9, dir: 280, p: 20, r: 0, t: 12, c: 40 }, { w: 4, gd: 2, dir: 90, p: 5, r: 0, t: 10, c: 10 }];
    const shift = models ? 1 : 0, coast = lat < 45 ? -4 : 0, inland = lon > 5 || (lat > 52.3 && lat < 52.37 && lon > 4.7) ? -5 : 0;
    for (let d = 0; d < days; d++) for (let h = 0; h < 24; h++) {
      const t = new Date(start.getTime() + (d * 24 + h) * 3600e3).toISOString().slice(0, 13) + ':00';
      time.push(t);
      const P = plan[Math.min(4, d + shift)], aft = h >= 12 && h <= 16 ? 2 : 0;
      const push = (k, v) => (H[k] ||= []).push(v);
      if (marine) {
        const waves = [[1.8, 7], [1.2, 9], [1.4, 10], [2.4, 7], [0.5, 6]][Math.min(4, d + shift)];
        push('wave_height', waves[0]); push('wave_period', waves[1]); push('wave_direction', 280); push('sea_surface_temperature', lat < 45 ? 18.4 : 12.6);
        push('sea_level_height_msl', lat < 45 ? 0.05 * Math.cos(h / 2) : Math.round(0.9 * Math.cos(2 * Math.PI * (h - 15.5 - d * 0.8) / 12.42) * 100) / 100);
      } else if (models) {
        const base = Math.max(0, P.w + aft + coast + inland);
        push('wind_speed_10m_ecmwf_ifs025', base); push('wind_speed_10m_icon_seamless', base + 1); push('wind_speed_10m_gfs_seamless', d === 2 ? base + 9 : base - 2);
      } else {
        push('wind_speed_10m', Math.max(0, P.w + aft + coast + inland)); push('wind_gusts_10m', Math.max(0, P.w + aft + coast + inland + P.gd));
        push('wind_direction_10m', P.dir); push('precipitation_probability', P.p); push('precipitation', P.r); push('temperature_2m', P.t + (lat < 45 ? 7 : 0)); push('cloud_cover', P.c);
      }
    }
    const out = { latitude: lat, longitude: lon, utc_offset_seconds: off, timezone: tzName, hourly: Object.assign({ time }, H) };
    if (!marine && !models) {
      const dt = [...new Set(time.map((t) => t.slice(0, 10)))];
      out.daily = { time: dt, sunset: dt.map((x) => x + (lat < 45 ? 'T17:32' : 'T17:05')) };
    }
    return out;
  };
  const all = lats.map((la, i) => one(la, lons[i]));
  return all.length === 1 ? all[0] : all;
}

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
  if (url.pathname === '/__meteo') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(meteoLog)); }
  if (url.pathname.startsWith('/rest/v1/')) {
    if (req.headers.apikey !== 'sb_publishable_test') { res.writeHead(401); return res.end('{"message":"no apikey"}'); }
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
