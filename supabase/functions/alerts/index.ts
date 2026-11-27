// Supabase Edge Function: the alert worker (2.27), started every 10 minutes by pg_cron (migration 0021).
// It publishes the shared forecast, sends wind alerts, "forecast dropped" and "how was it?", and delivers push.
// Deploy: supabase functions deploy alerts --no-verify-jwt   (the deploy workflow copies site/fx.js next to it first)
// Who may start it: only a caller with the secret pg_cron sends (x-hi8-cron), checked against the database.
// Env (given by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Optional secrets: METEO_KEY, SITE_URL, and for the
// iPhone app (0031): APNS_KEY_P8, APNS_KEY_ID, APPLE_TEAM_ID, APNS_TOPIC.
import { runAlerts } from '../_shared/alerts.js';
import { apnsConfig } from '../_shared/apns.js';

const env = Deno.env.toObject();
const URL0 = (env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || '';
(globalThis as any).HI8_CONFIG = { meteoKey: env.METEO_KEY || '', forecastApi: env.FORECAST_API || null, marineApi: env.MARINE_API || null, fxShared: false };
await import('../_shared/fx.js');

const H = { apikey: KEY, Authorization: 'Bearer ' + KEY };
async function rpc(name: string, args: Record<string, unknown> = {}) {
  const r = await fetch(URL0 + '/rest/v1/rpc/' + name, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const t = await r.text();
  if (!r.ok) throw new Error(name + ' ' + r.status + ' ' + t.slice(0, 300));
  return t ? JSON.parse(t) : null;
}
async function upload(name: string, json: unknown) {
  const r = await fetch(URL0 + '/storage/v1/object/fx/' + name, { method: 'POST', headers: { ...H, 'Content-Type': 'application/json', 'x-upsert': 'true', 'cache-control': 'max-age=300' }, body: JSON.stringify(json) });
  if (!r.ok) throw new Error('upload ' + name + ' ' + r.status + ' ' + (await r.text()).slice(0, 200));
}

let running = false;
Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('{"message":"bad_request"}', { status: 405 });
  const given = req.headers.get('x-hi8-cron') || '';
  const want = given ? await rpc('hi8_worker_secret').catch(() => null) : null;
  if (!given || !want || given !== want) return new Response('{"message":"not_allowed"}', { status: 403 });
  if (running) return new Response('{"message":"busy"}', { status: 409 });
  running = true;
  const lines: string[] = [];
  try {
    const out = await runAlerts({ rpc, FX: (globalThis as any).FX, site: env.SITE_URL || 'https://hi8ctane.com', upload, vapid: null, apns: apnsConfig(env), log: (...a: unknown[]) => lines.push(a.join(' ')) });
    return new Response(JSON.stringify({ ok: true, ...out, log: lines }), { headers: { 'content-type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, message: String((e as Error).message || e), log: lines }), { status: 500, headers: { 'content-type': 'application/json' } });
  } finally { running = false; }
});
