// TEST ONLY. Stands in for Supabase's REST API (backed by a real local Postgres through psql) and for
// Open-Meteo (synthetic data), so the whole site can be clicked through offline.
// Usage: PGHOST=/tmp PGPORT=5433 PGUSER=postgres DB=hi8_e2e node test/e2e/fake-services.mjs
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { forecastFor, marineFor } from '../fixtures/openmeteo.mjs';

const DB = process.env.DB || 'hi8_e2e', KEY = process.env.EXPECT_KEY || 'sb_secret_local', PORT = Number(process.env.FAKE_PORT || 54321);
const ARGS = {
  join_waitlist: { p_city: 't', p_first_name: 't', p_email: 't', p_hub: 't', p_sports: 'a', p_levels: 'j', p_captain: 'b', p_captain_sport: 't', p_captain_days: 'a', p_consent: 'b', p_source: 't', p_ref: 't' },
  rsvp_night: { p_first_name: 't', p_email: 't', p_session: 't', p_hub: 't', p_waiver: 'b', p_photo: 'b' },
  public_counts: {},
};
const expr = (k, t) => ({ t: `j->>'${k}'`, b: `(j->>'${k}')::boolean`, j: `coalesce(j->'${k}', '{}'::jsonb)`, a: `array(select jsonb_array_elements_text(coalesce(j->'${k}', '[]'::jsonb)))` })[t];
function call(fn, body) {
  const args = Object.entries(ARGS[fn]).filter(([k]) => body[k] !== undefined && body[k] !== null).map(([k, t]) => `${k} => ${expr(k, t)}`).join(', ');
  const sql = `\\set VERBOSITY verbose\nselect public.${fn}(${args}) from (select $j$${JSON.stringify(body)}$j$::jsonb j) x;\n`;
  const r = spawnSync('psql', ['-At', '-v', 'ON_ERROR_STOP=1', '-d', DB], { input: sql, encoding: 'utf8' });
  if (r.status !== 0) { const m = (r.stderr || '').match(/ERROR:\s+([0-9A-Z]{5}):\s+(.*)/); return { status: 400, body: { code: m ? m[1] : 'XX000', message: m ? m[2] : r.stderr } }; }
  return { status: 200, body: JSON.parse(r.stdout.trim()) };
}
createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const send = (s, b) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(JSON.stringify(b)); };
  if (url.pathname.startsWith('/rest/v1/rpc/')) {
    if (req.headers.apikey !== KEY) return send(401, { message: 'bad apikey' });
    let raw = ''; for await (const c of req) raw += c;
    const fn = url.pathname.split('/').pop(); if (!ARGS[fn]) return send(404, { message: 'no fn' });
    const out = call(fn, raw ? JSON.parse(raw) : {}); return send(out.status, out.body);
  }
  const start = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  if (url.pathname === '/v1/forecast' || url.pathname === '/v1/marine') {
    const lats = url.searchParams.get('latitude').split(',').map(Number);
    const out = lats.map((l) => (url.pathname === '/v1/marine' ? marineFor(l, start) : forecastFor(l, start)));
    return send(200, out.length === 1 ? out[0] : out);
  }
  send(404, { message: 'not found' });
}).listen(PORT, () => console.log('fake services on', PORT));
