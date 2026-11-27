// The alert worker, run by hand (or by the Actions fallback): node scripts/alerts.mjs. In production it runs every
// 10 minutes as the Supabase Edge Function "alerts", started by pg_cron (0021): the same code, supabase/functions/_shared/alerts.js.
//
// Env: SUPABASE_URL, SUPABASE_SECRET_KEY (or REST_URL + a service-role JWT in SUPABASE_SECRET_KEY, for tests),
//      SITE_URL, FORECAST_API, MARINE_API, METEO_KEY, STORAGE_URL (where fx/ goes; default SUPABASE_URL/storage/v1),
//      VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY to override the keys in the database, TEST_HOUR, DRY_RUN=1, NO_SHARED=1,
//      APNS_KEY_P8 + APNS_KEY_ID + APPLE_TEAM_ID (+ APNS_TOPIC) for the iPhone app; APNS_TEST_HOST (tests: a local HTTP/2 Apple).
import { runAlerts } from '../supabase/functions/_shared/alerts.js';
import { apnsConfig } from '../supabase/functions/_shared/apns.js';
import http2 from 'node:http2';

// Apple needs HTTP/2, which Node's fetch doesn't speak: one session per host, reused for the run
const h2 = {};
function apnsPost(url, headers, body) {
  const u = new URL(url);
  if (!h2[u.origin] || h2[u.origin].closed || h2[u.origin].destroyed) { h2[u.origin] = http2.connect(u.origin); h2[u.origin].on('error', () => {}); }
  return new Promise((ok, no) => {
    const r = h2[u.origin].request({ ':method': 'POST', ':path': u.pathname, ...headers });
    let st = 0, data = '';
    r.on('response', (h) => { st = h[':status']; }); r.setEncoding('utf8'); r.on('data', (c) => { data += c; });
    r.on('end', () => ok({ status: st, body: data })); r.on('error', no); r.end(body);
  });
}

const env = process.env;
const REST = env.REST_URL || (env.SUPABASE_URL ? env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1' : null);
const STORAGE = env.STORAGE_URL || (env.SUPABASE_URL ? env.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1' : null);
const KEY = env.SUPABASE_SECRET_KEY || '';
if (!REST || !KEY) { console.log('No SUPABASE_URL / SUPABASE_SECRET_KEY: nothing to do.'); process.exit(0); }

globalThis.HI8_CONFIG = { forecastApi: env.FORECAST_API || null, marineApi: env.MARINE_API || null, meteoKey: env.METEO_KEY || '', fxShared: false };
await import('../site/fx.js');

const auth = () => { const h = { apikey: KEY }; if (KEY.split('.').length === 3) h.Authorization = 'Bearer ' + KEY; return h; };
async function rpc(name, args = {}) {
  const r = await fetch(REST + '/rpc/' + name, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(name + ' ' + r.status + ' ' + t.slice(0, 300));
  return t ? JSON.parse(t) : null;
}
async function upload(name, json) {
  const r = await fetch(STORAGE + '/object/fx/' + name, { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'max-age=300' }, body: JSON.stringify(json) });
  if (!r.ok) throw new Error('upload ' + name + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

runAlerts({
  rpc, FX: globalThis.FX, site: env.SITE_URL, upload: env.NO_SHARED === '1' || !STORAGE ? null : upload,
  vapid: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } : null,
  apns: apnsConfig(env), apnsPost: env.APNS_TEST_HOST ? (url, h, b) => apnsPost(url.replace(/^https:\/\/api(\.sandbox)?\.push\.apple\.com/, env.APNS_TEST_HOST), h, b) : apnsPost,
  testHour: env.TEST_HOUR, dry: env.DRY_RUN === '1', log: (...a) => console.log(...a), debug: env.PUSH_DEBUG ? (m) => console.error(m) : null
}).then(() => { for (const k in h2) h2[k].close(); }, (e) => { console.error(e); process.exit(1); });   // close Apple's connections so the run ends
