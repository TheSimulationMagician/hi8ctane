// TEST ONLY. The "alerts" Edge Function itself (supabase/functions/alerts/index.ts), run under Node with a stand-in for
// Deno (node --experimental-strip-types), against the local stack: who may start it, and one real run.
// Run: node --experimental-strip-types test/unit/alerts_fn_test.mjs
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const BASE = process.env.HI8_BASE || 'http://localhost:8801';
let ok = 0;
const check = (c, what) => { if (!c) { console.error('FAIL: ' + what); process.exit(1); } ok++; console.log('  ok ·', what); };
const sql = (q) => execFileSync('psql', ['-h', '127.0.0.1', '-p', '5440', '-U', 'postgres', '-d', 'hi8', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
import crypto from 'node:crypto';
const SERVICE_JWT = (() => { const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = b({ alg: 'HS256', typ: 'JWT' }), p = b({ role: 'service_role', exp: 4102444800 });
  return h + '.' + p + '.' + crypto.createHmac('sha256', 'test-secret-test-secret-test-secret-0123').update(h + '.' + p).digest('base64url'); })();

// the deploy workflow copies site/fx.js next to the function; do the same
fs.copyFileSync(new URL('../../site/fx.js', import.meta.url), new URL('../../supabase/functions/_shared/fx.js', import.meta.url));
let handler = null;
globalThis.Deno = { env: { toObject: () => ({ SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: SERVICE_JWT, SITE_URL: 'https://hi8ctane.com', FORECAST_API: BASE, MARINE_API: BASE }) }, serve: (h) => { handler = h; } };
await import('../../supabase/functions/alerts/index.ts');
check(typeof handler === 'function', 'the function starts and serves');

let r = await handler(new Request('http://x/alerts', { method: 'POST' }));
check(r.status === 403, 'without the secret: refused');
r = await handler(new Request('http://x/alerts', { method: 'POST', headers: { 'x-hi8-cron': 'guess' } }));
check(r.status === 403, 'with a wrong secret: refused');
sql('truncate public.fx_cache'); await fetch(BASE + '/__fx', { method: 'DELETE' });
const secret = sql("select public.hi8_worker_secret()");
r = await handler(new Request('http://x/alerts', { method: 'POST', headers: { 'x-hi8-cron': secret } }));
const j = await r.json();
check(r.status === 200 && j.ok === true, 'with the secret pg_cron sends: one run (' + (j.log || []).join(' / ').slice(0, 160) + ')');
check(j.cached.includes('amsterdam') && (await (await fetch(BASE + '/__fx')).json()).includes('amsterdam.json'), 'it published the shared forecast');
check(sql("select count(*) from public.app_settings where key = 'vapid_public'") === '1', 'and has its web push keys');
fs.unlinkSync(new URL('../../supabase/functions/_shared/fx.js', import.meta.url));
console.log('\n' + ok + ' checks passed');
