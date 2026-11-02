// Runs the API handlers with a fake fetch: Supabase, Resend and Open-Meteo never get a real call.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { forecastFor, marineFor } from './fixtures/openmeteo.mjs';

const calls = [];
let rpcReply = () => ({ status: 200, body: { city: 'amsterdam', city_name: 'Amsterdam', status: 'open', plate: 39, existing: false, riders: 39, captains: 3, riders_goal: 25, captains_goal: 3 } });
globalThis.fetch = async (url, init = {}) => {
  url = String(url); calls.push({ url, init });
  if (url.includes('/rest/v1/rpc/')) { const r = rpcReply(url, init); return new Response(JSON.stringify(r.body), { status: r.status }); }
  if (url.includes('api.resend.com')) return new Response('{"id":"x"}', { status: 200 });
  if (url.includes('/v1/forecast') || url.includes('/v1/marine')) {
    const u = new URL(url), lats = u.searchParams.get('latitude').split(',').map(Number), start = '2026-10-28';
    const one = url.includes('/v1/marine') ? lats.map((l) => marineFor(l, start)) : lats.map((l) => forecastFor(l, start));
    return new Response(JSON.stringify(one.length === 1 ? one[0] : one), { status: 200 });
  }
  return new Response('not found', { status: 404 });
};
const setEnv = (o) => { for (const k of ['SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'RESEND_API_KEY', 'OPEN_METEO_API_KEY', 'FORECAST_OFF']) delete process.env[k]; Object.assign(process.env, o); };
const req = (path, body, headers = {}) => new Request('https://hi8ctane.com' + path, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://hi8ctane.com', ...headers }, body: JSON.stringify(body) });
const { POST: signup } = await import('../api/signup.js');
const { POST: rsvp } = await import('../api/rsvp.js');
const { GET: counts } = await import('../api/counts.js');
const { GET: health } = await import('../api/health.js');
const { getWeek } = await import('../api/_lib/forecast.js');
const good = { city: 'amsterdam', first_name: 'Frankie', email: 'frankie@example.com', hub: 'west', sports: ['kite'], levels: { kite: 'regular' }, consent: true };
beforeEach(() => { calls.length = 0; setEnv({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test' }); });

test('signup: calls join_waitlist with the secret key in apikey only', async () => {
  const res = await signup(req('/api/signup', good)); const data = await res.json();
  assert.equal(res.status, 200); assert.equal(data.plate, 39);
  const c = calls.find((x) => x.url.endsWith('/rest/v1/rpc/join_waitlist'));
  assert.ok(c); assert.equal(c.init.headers.apikey, 'sb_secret_test'); assert.equal(c.init.headers.authorization, undefined);
  const sent = JSON.parse(c.init.body); assert.equal(sent.p_email, 'frankie@example.com'); assert.deepEqual(sent.p_sports, ['kite']);
  assert.equal(calls.some((x) => x.url.includes('resend')), false, 'no email without a key');
});
test('signup: a legacy service_role key also sends Authorization', async () => {
  setEnv({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOi.legacy' });
  await signup(req('/api/signup', good));
  const c = calls.find((x) => x.url.includes('/rpc/join_waitlist')); assert.equal(c.init.headers.authorization, 'Bearer eyJhbGciOi.legacy');
});
test('signup: sends the welcome email when Resend is set, not for someone already in', async () => {
  setEnv({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_SECRET_KEY: 'sb_secret_test', RESEND_API_KEY: 're_test' });
  await signup(req('/api/signup', good));
  const m = calls.find((x) => x.url.includes('resend')); assert.ok(m); assert.match(JSON.parse(m.init.body).subject, /#039/);
  calls.length = 0; const was = rpcReply; rpcReply = () => ({ status: 200, body: { ...was().body, existing: true } });
  await signup(req('/api/signup', good)); assert.equal(calls.some((x) => x.url.includes('resend')), false); rpcReply = was;
});
test('signup: field errors, bots, other sites, bad JSON, no database', async () => {
  let r = await signup(req('/api/signup', { ...good, email: 'x' })); assert.equal(r.status, 422); assert.ok((await r.json()).fields.email);
  r = await signup(req('/api/signup', { ...good, website: 'spam' })); assert.equal(r.status, 200); assert.equal(calls.length, 0, 'bots never reach the database');
  r = await signup(req('/api/signup', good, { origin: 'https://evil.example' })); assert.equal(r.status, 403);
  r = await signup(new Request('https://hi8ctane.com/api/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' })); assert.equal(r.status, 400);
  setEnv({}); r = await signup(req('/api/signup', good)); assert.equal(r.status, 503); assert.equal((await r.json()).error, 'not_configured');
});
test('signup: database errors become friendly messages', async () => {
  const was = rpcReply;
  rpcReply = () => ({ status: 404, body: { code: 'P0002', message: 'unknown_city' } });
  let r = await signup(req('/api/signup', { ...good, city: 'atlantis' })); assert.equal(r.status, 422); assert.ok((await r.json()).fields.city);
  rpcReply = () => ({ status: 500, body: { message: 'boom' } });
  r = await signup(req('/api/signup', good)); assert.equal(r.status, 502);
  rpcReply = was;
});
test('rsvp: waiver enforced before the database', async () => {
  let r = await rsvp(req('/api/rsvp', { first_name: 'Sam', email: 's@x.io', session: 'mtb', hub: 'sants', waiver: false })); assert.equal(r.status, 422);
  assert.equal(calls.length, 0);
  const was = rpcReply; rpcReply = () => ({ status: 200, body: { existing: false, going: 113 } });
  r = await rsvp(req('/api/rsvp', { first_name: 'Sam', email: 's@x.io', session: 'mtb', hub: 'sants', waiver: true })); assert.equal((await r.json()).going, 113);
  rpcReply = was;
});
test('counts + health', async () => {
  const was = rpcReply; rpcReply = () => ({ status: 200, body: { cities: [{ slug: 'amsterdam', riders: 3 }], night: { going: 2 } } });
  const r = await counts(); const d = await r.json(); assert.equal(d.ok, true); assert.equal(d.night.going, 2); assert.match(r.headers.get('cache-control'), /s-maxage=30/);
  rpcReply = was;
  const h = await (await health()).json(); assert.equal(h.database, true); assert.equal(h.forecast, 'free'); assert.equal(JSON.stringify(h).includes('sb_secret'), false);
});
test('week: four days, five sports in Amsterdam, commercial endpoint when a key is set', async () => {
  const now = new Date('2026-10-29T08:30:00Z');
  const w = await getWeek({ meteoKey: '' }, 'ams', { now });
  assert.deepEqual(w.days.map((d) => d.label), ['TODAY', 'TMRW', 'SAT', 'SUN']);
  assert.deepEqual(w.rows.map((r) => r.sport), ['kite', 'wing', 'surf', 'sup', 'mtb']);
  const kiteToday = w.rows[0].cells[0];
  assert.equal(kiteToday.label, 'EPIC', JSON.stringify(kiteToday)); assert.match(kiteToday.key, /KT SW/);
  assert.equal(w.rows.find((r) => r.sport === 'sup').cells[3].label, 'EPIC', 'glassy Sunday');
  assert.ok(w.rows.find((r) => r.sport === 'mtb').cells[1].score <= 4, 'rainy tomorrow');
  calls.length = 0; await getWeek({ meteoKey: 'k123' }, 'ams', { now });
  assert.ok(calls.every((c) => c.url.startsWith('https://customer-') && c.url.includes('apikey=k123')), calls.map((c) => c.url).join('\n'));
  const b = await getWeek({ meteoKey: '' }, 'bcn', { now }); assert.equal(b.cityName, 'Barcelona'); assert.ok(b.rows.length >= 4);
});
test('week: after dark, today says so', async () => {
  const w = await getWeek({ meteoKey: '' }, 'ams', { now: new Date('2026-10-29T18:30:00Z') });
  assert.equal(w.rows[0].cells[0].label, 'DONE');
});
