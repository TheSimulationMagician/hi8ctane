// TEST ONLY. 0031 + apns.js: notifications for the iPhone app, end to end on the local stack.
//   the APNs token (ES256, signed with a .p8 key, checked with its public half), the message with its buttons,
//   the phone's token saved by the app, the worker sending to a local HTTP/2 "Apple", what Apple's answers do,
//   and the buttons answering (I'M IN · A SEAT, NOT NOW, STILL IN, I'M OUT, ON) as the rider.
import crypto from 'node:crypto';
import http2 from 'node:http2';
import { execFileSync, spawn } from 'node:child_process';
import { apnsJwt, apnsPayload, categoryFor, sendApns } from '../../supabase/functions/_shared/apns.js';

const BASE = process.env.HI8_BASE || 'http://localhost:8803';
let ok = 0;
const check = (c, what) => { if (!c) { console.error('FAIL: ' + what); process.exit(1); } ok++; console.log('  ok ·', what); };
const sql = (q) => execFileSync('psql', ['-h', '127.0.0.1', '-p', '5440', '-U', 'postgres', '-d', 'hi8', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
async function rpc(fn, body, ip = '10.8.8.8') {
  const r = await fetch(BASE + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': ip }, body: JSON.stringify(body) });
  const t = await r.text(); return [r.status, t ? JSON.parse(t) : null];
}
const must = async (fn, body) => { const [s, r] = await rpc(fn, body); if (s !== 200) { console.error('FAIL: ' + fn + ' -> ' + s + ' ' + JSON.stringify(r)); process.exit(1); } return r; };

console.log("Apple's token and the message");
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const P8 = privateKey.export({ type: 'pkcs8', format: 'pem' });
const CFG = { keyP8: P8, keyId: 'ABC123DEFG', teamId: 'TEAM123456', topic: 'com.hi8ctane.app' };
const jwt = await apnsJwt(CFG);
const [h, p, s] = jwt.split('.');
const H = JSON.parse(Buffer.from(h, 'base64url')), Pl = JSON.parse(Buffer.from(p, 'base64url'));
check(H.alg === 'ES256' && H.kid === 'ABC123DEFG' && Pl.iss === 'TEAM123456' && Math.abs(Pl.iat - Date.now() / 1000) < 5, 'the token: ES256, our key ID, our Team ID, issued now');
check(crypto.verify('sha256', Buffer.from(h + '.' + p), { key: publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url')), '...signed with the .p8 key (checked with its public half)');
check(await apnsJwt(CFG) === jwt, '...and reused for 50 minutes (Apple refuses a new one every request)');
check(categoryFor('ask:ABC') === 'crew' && categoryFor('fx:ABC') === 'recheck' && categoryFor('rate:ABC') === 'spot' && categoryFor('a:x') === null, 'the buttons by message: crew fits → crew, forecast dropped → recheck, how was it → ON/MEH/OFF, the rest none');
const pay = apnsPayload({ title: 'A crew for Sunday: Wijk aan Zee', body: '13–17 · 22 kt', url: 'https://hi8ctane.com/?c=ABC', tag: 'ask:ABC' });
check(pay.aps.category === 'crew' && pay.aps.alert.title.startsWith('A crew') && pay.url.endsWith('?c=ABC') && pay.ref === 'ask:ABC', 'the message carries the title, the buttons, the link and what the button answers to');
const fake = (status, reason) => async () => ({ status, body: reason ? JSON.stringify({ reason }) : '' });
check(await sendApns({ token: 'aa', env: 'production' }, { title: 't', tag: 'x' }, CFG, { post: fake(200) }) === 'ok', 'Apple says 200: delivered');
check(await sendApns({ token: 'aa' }, { title: 't' }, CFG, { post: fake(410, 'Unregistered') }) === 'gone', '410 Unregistered: the app was removed, forget the token');
check(await sendApns({ token: 'aa' }, { title: 't' }, CFG, { post: fake(400, 'BadDeviceToken') }) === 'gone', '400 BadDeviceToken: forget it too');
check(await sendApns({ token: 'aa' }, { title: 't' }, CFG, { post: fake(503, 'ServiceUnavailable') }) === 'failed', '503: try again next run');
let seen = null;
await sendApns({ token: 'bb', env: 'sandbox' }, { title: 't', tag: 'fx:ABC' }, CFG, { post: async (u, hd) => { seen = { u, hd }; return { status: 200, body: '' }; } });
check(seen.u === 'https://api.sandbox.push.apple.com/3/device/bb' && seen.hd['apns-topic'] === 'com.hi8ctane.app' && seen.hd['apns-push-type'] === 'alert' && seen.hd['apns-collapse-id'] === 'fx:ABC' && seen.hd.authorization === 'bearer ' + jwt, 'the request: the right host, our app, an alert, one per subject, our token');

console.log('the app saves its token');
sql('truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.push_queue, public.push_subs, public.push_native, public.alert_sent, public.ride_asks, public.spot_reports cascade');
const K = {};
for (const n of ['ana', 'bo']) K[n] = (await must('hi8_join', { p_email: n + '@example.com', p_city: 'amsterdam' })).key;
const TOK = 'a'.repeat(64), TOK2 = 'b'.repeat(64);
check((await rpc('hi8_push_native', { p_key: K.ana, p_token: 'not a token' }))[0] !== 200, 'a token that is not one: refused');
check((await rpc('hi8_push_native', { p_key: '00000000-0000-0000-0000-000000000000', p_token: TOK }))[0] !== 200, 'a made-up key: refused');
await must('hi8_push_native', { p_key: K.ana, p_token: TOK.toUpperCase() });
check(sql("select email || '|' || env from push_native") === 'ana@example.com|production', "Ana's iPhone is saved (lower case, production)");
check((await fetch(BASE + '/rest/v1/push_native', { headers: { apikey: 'sb_publishable_test' } })).status >= 400, 'the tokens are closed to the website');
check(sql("select public.hi8_has_push('ana@example.com')") === 't', 'the app counts as a phone that gets push: messages to Ana now queue');

console.log('the worker sends to Apple');
// a crew that fits for Ana, the way 0023 queues it
sql(`insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, host_email, code) values ('amsterdam','kite','wijk-aan-zee', hi8_today('amsterdam') + 2, '13:00','17:00','all',6,'bo@example.com','IPH001')`);
sql(`insert into public.crew_members (crew_id, email, level, getting, seats) select id, 'bo@example.com', 'regular', 'drive', 2 from public.crews where code = 'IPH001'`);
sql(`insert into public.ride_asks (email, city, sport, day, level, told_at) values ('ana@example.com', 'amsterdam', 'kite', hi8_today('amsterdam') + 2, 'rookie', now())`);   // already told: the matcher stays out of this test
sql(`select public.hi8_push('ana@example.com', 'A crew for Sunday: Wijk aan Zee', '13–17 · 22 kt · a seat in Bo''s car', 'https://hi8ctane.com/?c=IPH001', 'ask:test', 'ask:IPH001')`);
const pend = JSON.parse(sql('select public.hi8_push_pending(10)'));
check(pend.length === 1 && pend[0].native.length === 1 && pend[0].native[0].token === TOK && pend[0].subs.length === 0, 'the waiting message lists her iPhone');

const got = [];
const apple = http2.createServer();
apple.on('stream', (st, hd) => { let b = ''; st.on('data', (c) => (b += c)); st.on('end', () => {
  got.push({ path: hd[':path'], hd, body: JSON.parse(b) });
  if (hd[':path'].endsWith(TOK2)) { st.respond({ ':status': 410 }); st.end('{"reason":"Unregistered"}'); } else { st.respond({ ':status': 200 }); st.end(); }
}); });
await new Promise((r) => apple.listen(8444, r));
const JWT = (() => { const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); const h2 = b({ alg: 'HS256', typ: 'JWT' }), p2 = b({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 });
  return h2 + '.' + p2 + '.' + crypto.createHmac('sha256', 'test-secret-test-secret-test-secret-0123').update(h2 + '.' + p2).digest('base64url'); })();
const run = (extra = {}) => new Promise((res) => {
  const ch = spawn('node', ['scripts/alerts.mjs'], { env: { ...process.env, REST_URL: 'http://localhost:3300', SUPABASE_SECRET_KEY: JWT, FORECAST_API: BASE, MARINE_API: BASE, NO_SHARED: '1',
    SITE_URL: 'https://hi8ctane.com', TEST_HOUR: '3', APNS_TEST_HOST: 'http://localhost:8444', ...extra } });
  let o = '', e = ''; ch.stdout.on('data', (d) => (o += d)); ch.stderr.on('data', (d) => (e += d));
  ch.on('close', (code) => { if (code !== 0) { console.error(o, e); process.exit(1); } res(o); });
});
let out = await run();
check(got.length === 0 && sql('select count(*) from push_queue where sent_at is null') === '1', 'no APNs key in the secrets yet: the iPhone part waits, nothing is lost');
out = await run({ APNS_KEY_P8: P8, APNS_KEY_ID: 'ABC123DEFG', APPLE_TEAM_ID: 'TEAM123456' });
check(got.length === 1 && got[0].path === '/3/device/' + TOK && got[0].body.aps.category === 'crew' && got[0].body.ref === 'ask:IPH001', 'with the key: Apple gets it for her phone, with the crew buttons and what they answer to');
check(got[0].hd.authorization.startsWith('bearer ') && got[0].hd['apns-topic'] === 'com.hi8ctane.app', '...signed, for our app');
check(sql('select count(*) from push_queue where sent_at is null') === '0' && sql("select ok_at is not null from push_native where token = '" + TOK + "'") === 't', 'marked sent, her phone marked as reached');
await must('hi8_push_native', { p_key: K.ana, p_token: TOK2 });
sql(`select public.hi8_push('ana@example.com', 'Forecast dropped · Wijk aan Zee', 'Still on?', 'https://hi8ctane.com/?c=IPH001', 'fx:test', 'fx:IPH001')`);
out = await run({ APNS_KEY_P8: P8, APNS_KEY_ID: 'ABC123DEFG', APPLE_TEAM_ID: 'TEAM123456' });
check(got.length === 3 && got.slice(1).every((g) => g.body.aps.category === 'recheck'), 'two phones: both get it, with STILL IN / I\'M OUT');
check(sql('select count(*) from push_native') === '1' && sql('select token from push_native') === TOK, 'Apple said one app was removed: that token is forgotten');
apple.close();

console.log('the buttons answer');
let r = await must('hi8_push_answer', { p_key: K.ana, p_ref: 'ask:IPH001', p_answer: 'in_seat' });
check(r.ok && r.did === 'joined' && sql("select m.level || '|' || m.getting from crew_members m join crews c on c.id = m.crew_id where c.code = 'IPH001' and m.email = 'ana@example.com'") === 'rookie|seat',
  "I'M IN · A SEAT: Ana is in, at the level she asked with, taking a seat");
r = await must('hi8_push_answer', { p_key: K.ana, p_ref: 'fx:IPH001', p_answer: 'still_in' });
check(r.ok && r.did === 'still_in', 'STILL IN: done from the lock screen');
r = await must('hi8_push_answer', { p_key: K.ana, p_ref: 'fx:IPH001', p_answer: 'out' });
check(r.ok && sql("select count(*) from crew_members m join crews c on c.id = m.crew_id where c.code = 'IPH001' and m.email = 'ana@example.com'") === '0', "I'M OUT: she's out, the crew is told as usual");
r = await must('hi8_push_answer', { p_key: K.ana, p_ref: 'ask:IPH001', p_answer: 'not_now' });
check(r.ok && r.did === 'not_now' && !r.url, 'NOT NOW: nothing opens');
sql("update crews set max_riders = 2 where code = 'IPH001'");
sql("insert into crew_members (crew_id, email, level, getting, seats) select id, 'cy@example.com', 'regular', 'own', 0 from crews where code = 'IPH001'");
r = await must('hi8_push_answer', { p_key: K.ana, p_ref: 'ask:IPH001', p_answer: 'in_own' });
check(!r.ok && r.url === 'https://hi8ctane.com/?c=IPH001', "the crew is full: no join, the app opens the crew instead");
r = await must('hi8_push_answer', { p_key: K.ana, p_ref: 'ask:NOPE00', p_answer: 'in_seat' });
check(!r.ok && r.why === 'no_crew', 'a crew that is gone: says so');
check((await rpc('hi8_push_answer', { p_key: '00000000-0000-0000-0000-000000000000', p_ref: 'ask:IPH001', p_answer: 'in_seat' }))[0] !== 200, 'a made-up key: refused');
await must('hi8_push_native_off', { p_key: K.ana });
check(sql('select count(*) from push_native') === '0', 'notifications off in the app: her token is dropped');

console.log(`ALL ${ok} IPHONE PUSH CHECKS PASSED`);
process.exit(0);
