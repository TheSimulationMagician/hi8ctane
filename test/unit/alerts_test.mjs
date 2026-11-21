// TEST ONLY. 0019 (2.23) and the alert worker, against the local stack (Postgres 5440, PostgREST 3300 behind
// test/live/serve.mjs on 8801, which also stands in for Open-Meteo). A fake push service checks what phones get.
// Run: node test/unit/alerts_test.mjs
import crypto from 'node:crypto';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { vapidKeys, decrypt, verifyVapid, b64u, encrypt, phoneKeys } from '../../supabase/functions/_shared/webpush.js';

const BASE = process.env.HI8_BASE || 'http://localhost:8801';
let ok = 0;
const check = (c, what) => { if (!c) { console.error('FAIL: ' + what); process.exit(1); } ok++; console.log('  ok ·', what); };
const sql = (q) => execFileSync('psql', ['-h', '127.0.0.1', '-p', '5440', '-U', 'postgres', '-d', 'hi8', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
async function rpc(fn, body, ip = '10.9.9.9') {
  const r = await fetch(BASE + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': ip }, body: JSON.stringify(body) });
  const t = await r.text(); return [r.status, t ? JSON.parse(t) : null];
}
const must = async (fn, body) => { const [s, r] = await rpc(fn, body); if (s !== 200) { console.error('FAIL: ' + fn + ' -> ' + s + ' ' + JSON.stringify(r)); process.exit(1); } return r; };
const err = async (fn, body) => { const [s, r] = await rpc(fn, body); return s === 200 ? null : (r || {}).message; };

console.log('the push crypto');
const V = await vapidKeys(), ua = await phoneKeys();
const subKeys = { p256dh: b64u(ua.publicRaw), auth: b64u(crypto.randomBytes(16)) };
check(await decrypt(await encrypt('{"title":"hi"}', subKeys.p256dh, subKeys.auth), ua, subKeys.auth) === '{"title":"hi"}', 'aes128gcm (WebCrypto, as in the Edge Function): what we encrypt, the phone decrypts');

// the fake push service (https, a throwaway certificate)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hi8push-'));
spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', dir + '/k.pem', '-out', dir + '/c.pem', '-days', '1', '-subj', '/CN=localhost']);
const got = [];
const srv = https.createServer({ key: fs.readFileSync(dir + '/k.pem'), cert: fs.readFileSync(dir + '/c.pem') }, (req, res) => {
  const ch = []; req.on('data', (c) => ch.push(c)); req.on('end', () => {
    if (req.url.startsWith('/gone')) { res.writeHead(410); return res.end(); }
    got.push({ url: req.url, h: req.headers, body: Buffer.concat(ch) }); res.writeHead(201); res.end();
  });
});
await new Promise((r) => srv.listen(8443, r));
const EP = 'https://localhost:8443/push/';

sql("delete from public.app_secrets where name = 'vapid_private'; delete from public.app_settings where key = 'vapid_public'");
sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.crew_alerts, public.spot_watch, public.wind_alerts, public.push_subs, public.push_queue, public.alert_sent, public.spot_reports, public.ride_asks cascade");
const K = {};
for (const n of ['ana', 'bo', 'cy', 'di']) K[n] = (await must('hi8_join', { p_email: n + '@example.com', p_city: 'amsterdam' })).key;

console.log('alerts');
const rule = { spots: ['wijk-aan-zee', 'zandvoort'], min_kt: 15, max_kt: 30, gust_max: 35, days: 'any', from_h: 9, to_h: 19, min_hours: 2, by_push: true, by_email: true };
let a = await must('hi8_wind_alert', { p_key: K.ana, p_city: 'amsterdam', p_sport: 'kite', p_rule: rule });
check(a.alerts.length === 1 && a.alerts[0].min_kt === 15 && a.alerts[0].spots.length === 2 && a.push === false, 'an alert with your own conditions, kept');
check(await err('hi8_wind_alert', { p_key: K.ana, p_city: 'amsterdam', p_sport: 'kite', p_rule: { ...rule, spots: ['collserola'] } }) === 'no_spot', 'a spot from another region: refused');
check(await err('hi8_wind_alert', { p_key: K.ana, p_city: 'amsterdam', p_sport: 'kite', p_rule: { ...rule, min_kt: 25, max_kt: 20 } }) === 'bad_rule', 'max below min: refused');
check(await err('hi8_wind_alert', { p_key: K.ana, p_city: 'amsterdam', p_sport: 'kite', p_rule: { ...rule, by_push: false, by_email: false } }) === 'no_channel', 'neither push nor email: refused');
check(await err('hi8_push_sub', { p_key: K.ana, p_endpoint: 'http://x/', p_p256dh: subKeys.p256dh, p_auth: subKeys.auth }) === 'bad_sub', 'a push address that isn\'t https: refused');
const p = await must('hi8_push_sub', { p_key: K.ana, p_endpoint: EP + 'ana', p_p256dh: subKeys.p256dh, p_auth: subKeys.auth, p_ua: 'test' });
check(p.push === true && (await must('hi8_wind_alerts', { p_key: K.ana })).push === true, 'a phone, kept');
await must('hi8_wind_alert', { p_key: K.bo, p_city: 'amsterdam', p_sport: 'kite', p_rule: { ...rule, spots: ['wijk-aan-zee'], min_kt: 28, by_push: false } });
await must('hi8_watch', { p_key: K.cy, p_spot: 'wijk-aan-zee', p_on: true });
const W = await must('hi8_watchers', { p_city: 'amsterdam' });
check(W['wijk-aan-zee'] === 3 && W.zandvoort === 1, 'watchers per spot: alerts and stars, counted once per rider');
check((await fetch(BASE + '/rest/v1/wind_alerts', { headers: { apikey: 'sb_publishable_test' } })).status >= 400, 'the alerts table is closed to the website');
check(await err('hi8_worker_jobs', {}) !== null, 'the website can\'t call the worker\'s functions');

console.log('crews: a minimum, the forecast, moving');
const crew = (spot, off, host, members, start = '13:00', end = '17:00') => {
  const id = sql(`insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email) values ('amsterdam','kite','${spot}', (now() at time zone 'Europe/Amsterdam')::date + ${off}, '${start}', '${end}', 'all', 6, 'cs', '11:45', '${host}@example.com') returning id`).split('\n')[0];
  for (const m of members) sql(`insert into public.crew_members (crew_id, email, level, getting, seats) values ('${id}', '${m}@example.com', 'regular', '${m === host ? 'drive' : 'seat'}', ${m === host ? 3 : 0})`);
  return sql(`select code from public.crews where id = '${id}'`);
};
const tmr = crew('wijk-aan-zee', 1, 'ana', ['ana']);
check(await err('hi8_crew_min', { p_key: K.bo, p_code: tmr, p_min: 3 }) === 'not_host', 'only the captain sets a minimum');
let c = await must('hi8_crew_min', { p_key: K.ana, p_code: tmr, p_min: 3 });
check(c.min === 3 && c.min_met === false, '"only if 3 of us": not on yet');
await must('hi8_join_crew', { p_key: K.bo, p_code: tmr, p_level: 'regular', p_getting: 'seat', p_seats: 0, p_car_with: null });
check(sql(`select count(*) from public.outbox where kind = 'crew_on'`) === '0', 'two in: nothing yet');
c = await must('hi8_join_crew', { p_key: K.cy, p_code: tmr, p_level: 'regular', p_getting: 'seat', p_seats: 0, p_car_with: null });
check(c.min_met === true && sql(`select count(*) from public.outbox where kind = 'crew_on'`) === '3', 'the third rider: everyone hears it\'s on');
check(sql(`select count(*) from public.push_queue where email = 'ana@example.com' and title like 'It''s on%'`) === '1', '...and the rider with a phone gets it there too');
check(await err('hi8_move_crew', { p_key: K.bo, p_code: tmr, p_day: sql("select ((now() at time zone 'Europe/Amsterdam')::date + 2)::text"), p_start: '12:00' }) === 'not_host', 'only the captain moves a crew');

console.log('trust');
check(await err('hi8_rider_profile', { p_key: K.bo, p_save: true, p_years: 99 }) === 'bad_years', 'years riding: checked');
let pr = await must('hi8_rider_profile', { p_key: K.bo, p_save: true, p_years: 6, p_home_spot: 'wijk-aan-zee', p_insta: '@bo.rides' });
check(pr.years === 6 && pr.insta === 'bo.rides' && pr.home_spot === 'wijk-aan-zee', 'a profile: years, home spot, Instagram (the @ dropped)');
let ppl = await must('hi8_set_phone', { p_key: K.ana, p_code: tmr, p_phone: '06 1234 5678' });
check(ppl.find((x) => x.phone === '+31612345678'), 'a Dutch mobile, shared with the crew, with +31');
check(await err('hi8_crew_people', { p_key: K.di, p_code: tmr }) === 'not_in_crew', 'phones and profiles: crew members only');
ppl = await must('hi8_crew_people', { p_key: K.cy, p_code: tmr });
check(ppl.every((x) => x.no_show == null) && ppl.find((x) => x.years === 6), 'a rider sees profiles, not no-shows');
const past = crew('zandvoort', -1, 'ana', ['ana', 'bo', 'cy'], '10:00', '14:00');
const bo = sql(`select member_id from public.crew_members m join public.crews c on c.id = m.crew_id where c.code = '${past}' and m.email = 'bo@example.com'`);
ppl = await must('hi8_no_show', { p_key: K.ana, p_code: past, p_member: bo, p_on: true });
check(ppl.find((x) => x.member_id === bo).no_show === true && ppl.find((x) => x.member_id === bo).no_shows === 1, 'the captain marks a no-show, and sees it');
check((await must('hi8_rider_profile', { p_key: K.bo })).rode === 0 && (await must('hi8_rider_profile', { p_key: K.cy })).rode === 1, 'a no-show doesn\'t count as a session ridden');

console.log('how was it (the day after)');
const r = await must('hi8_report', { p_key: K.cy, p_code: past, p_verdict: 'on', p_kite: 9 });
check(r.reports.length === 1 && r.reports[0].verdict === 'on', 'the day after: a report still goes in');
await must('hi8_report', { p_key: K.cy, p_code: past, p_verdict: 'meh' });
check(sql(`select count(*) || verdict from public.spot_reports where email = 'cy@example.com' group by verdict`) === '1meh', '...and a second tap changes it, not adds one');

console.log('the worker');
const JWT = (() => { const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = b({ alg: 'HS256', typ: 'JWT' }), p2 = b({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 });
  return h + '.' + p2 + '.' + crypto.createHmac('sha256', 'test-secret-test-secret-test-secret-0123').update(h + '.' + p2).digest('base64url'); })();
const run = (hour, extra = {}) => new Promise((res) => { // async: the fake push service in this process has to answer meanwhile
  const ch = spawn('node', ['scripts/alerts.mjs'], { env: { ...process.env, REST_URL: 'http://localhost:3300', SUPABASE_SECRET_KEY: JWT, FORECAST_API: BASE, MARINE_API: BASE,
    STORAGE_URL: BASE + '/storage/v1', VAPID_PUBLIC_KEY: V.publicKey, VAPID_PRIVATE_KEY: V.privateKey, NODE_TLS_REJECT_UNAUTHORIZED: '0', TEST_HOUR: String(hour), SITE_URL: 'https://hi8ctane.com', ...extra } });
  let o = '', e = ''; ch.stdout.on('data', (d) => (o += d)); ch.stderr.on('data', (d) => (e += d));
  ch.on('close', (code) => { if (code !== 0) { console.error(o, e); process.exit(1); } res(o); });
});
// 2.29: someone looking for a crew in three days, and a crew that fits
sql(`insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email, code) values ('amsterdam','kite','ijmuiden', hi8_today('amsterdam') + 3, '13:00','17:00','all',6,'cs','11:45','bo@example.com','ASK001')`);
sql(`insert into public.crew_members (crew_id, email, level, getting, seats) select id, 'bo@example.com', 'regular', 'drive', 3 from public.crews where code = 'ASK001'`);
sql(`insert into public.ride_asks (email, city, sport, day, need_seat, hub, level) values ('zed@example.com', 'amsterdam', 'kite', hi8_today('amsterdam') + 3, true, 'cs', 'regular')`);
got.length = 0;
sql('truncate public.fx_cache'); await fetch(BASE + '/__fx', { method: 'DELETE' });
let out = await run(8);
const files = await (await fetch(BASE + '/__fx')).json();
const shared = await (await fetch(BASE + '/storage/v1/object/public/fx/amsterdam.json')).json();
check(files.includes('amsterdam.json') && files.includes('grid-amsterdam.json') && Object.keys(shared.spots).length === Number(sql("select count(*) from spots where city = 'amsterdam' and active")),
  'the shared forecast: every Amsterdam spot and the map grid, published once (' + files.length + ' files)');
check(sql("select spots || '|' || grid from public.fx_cache where city = 'amsterdam'") === Object.keys(shared.spots).length + '|true', '...and noted, so the next runs skip it for 25 minutes');
const today = sql("select (now() at time zone 'Europe/Amsterdam')::date::text");
check(/wind alerts: 2 matched, 1 new|wind alerts: \d+ matched/.test(out), 'it ran: ' + out.split('\n')[0]);
check(sql(`select count(*) from public.alert_sent where key = 'wind:ana@example.com:kite:${today}'`) === '1', 'today 19 kt SW at Wijk aan Zee (15-30 kt asked): ana gets an alert');
check(sql(`select count(*) from public.alert_sent where email = 'bo@example.com' and kind = 'wind'`) === '0', 'bo asked for 28 kt or more: nothing');
const mail = sql(`select subject || '|' || body || '|' || coalesce(unsub, '') from public.outbox where kind = 'wind' and to_email = 'ana@example.com'`);
check(/^Kite is on today \d\d–\d\d · /.test(mail) && mail.includes('kt SW') && mail.includes('Stop these alert emails: https://hi8ctane.com/?stop=') && /\|https:\/\/hi8ctane\.com\/\?stop=[0-9a-f-]{36}$/.test(mail), 'the email: what, when, the wind, a stop link and a List-Unsubscribe address');
const mine = got.filter((g) => g.url === '/push/ana');
const msgs = await Promise.all(mine.map(async (g) => JSON.parse(await decrypt(g.body, ua, subKeys.auth))));
const wind = msgs.find((m) => /^🪁 On · /.test(m.title));
check(wind && /kt SW, gusts \d+/.test(wind.body) && wind.url.startsWith('https://hi8ctane.com/#spot/'), 'the phone gets it: "' + (wind && wind.title) + '" · ' + (wind && wind.body));
check((await Promise.all(mine.map(async (g) => g.h['content-encoding'] === 'aes128gcm' && (await verifyVapid(g.h.authorization, V.publicKey)).aud === 'https://localhost:8443'))).every(Boolean), 'every push is encrypted and signed with our VAPID key');
check(msgs.some((m) => /^It's on/.test(m.title)), 'and "it\'s on" from before went out too');
check(sql(`select count(*) from public.push_queue where sent_at is null`) === '0', 'the queue is empty');
check(/riders told about a crew that fits: 1/.test(out) && sql(`select count(*) from public.outbox where kind = 'ask' and to_email = 'zed@example.com'`) === '1', '"I\'m looking": the worker tells a rider about the crew that fits');
check(sql(`select count(*) from public.crew_messages m join public.crews c on c.id = m.crew_id where c.code = '${tmr}' and m.body like 'Forecast dropped:%'`) === '1', 'tomorrow is 7 kt: the crew gets "forecast dropped" with the next window');
check(sql(`select body from public.crew_messages m join public.crews c on c.id = m.crew_id where c.code = '${tmr}' and m.body like 'Forecast dropped:%'`).includes('Next good window'), '...which names the next good window');
got.length = 0;
out = await run(8);
check(!/shared forecast published/.test(out), 'run again within 25 minutes: the shared forecast isn\'t fetched again');
check(got.length === 0 && sql(`select count(*) from public.outbox where kind = 'wind'`) === '1', 'run again: nothing twice');
await must('hi8_no_show', { p_key: K.ana, p_code: past, p_member: bo, p_on: false }); // bo came after all
crew('wijk-aan-zee', 0, 'bo', ['bo'], '15:00', '18:00');
check(sql(`select count(*) from public.push_queue where email = 'ana@example.com' and title like 'A crew is going%'`) === '1', 'a crew goes up where ana\'s alert said it\'s on today: her phone hears about it');
out = await run(10);
check(sql(`select count(*) from public.alert_sent where kind = 'rate'`) === '2' && (await Promise.all(got.map((g) => decrypt(g.body, ua, subKeys.auth)))).some((t) => /How was Zandvoort/.test(t)), 'the morning after: "how was it?" to the riders who haven\'t said (ana by phone, bo by email; cy already did)');
check(sql(`select count(*) from public.outbox where kind = 'rate' and to_email = 'bo@example.com'`) === '1' && sql(`select count(*) from public.outbox where kind = 'rate' and to_email = 'ana@example.com'`) === '0', 'phone if you have one, email if not');

console.log('moving a crew, stopping alerts, gone phones');
const d2 = sql("select ((now() at time zone 'Europe/Amsterdam')::date + 2)::text");
c = await must('hi8_move_crew', { p_key: K.ana, p_code: tmr, p_day: d2, p_start: '12:00', p_end: '16:00' });
check(c.day === d2 && c.start === '12:00' && c.fx_flag === false && sql(`select count(*) from public.outbox where kind = 'moved'`) === '2', 'the captain moves it to the next window: the others hear it, the warning resets');
const tok = sql(`select token from public.wind_alerts where email = 'ana@example.com'`);
let u = await must('hi8_unsubscribe', { p_token: tok });
check(u.stopped === true && u.kind === 'wind' && sql(`select by_email::text || by_push::text from public.wind_alerts where email = 'ana@example.com'`) === 'falsetrue', 'the stop link: no more alert emails, the phone keeps them');
await must('hi8_push_sub', { p_key: K.ana, p_endpoint: 'https://localhost:8443/gone/1', p_p256dh: subKeys.p256dh, p_auth: subKeys.auth });
sql(`insert into public.push_queue (email, title, body) values ('ana@example.com', 'test', 'test')`);
await run(3);
check(sql(`select count(*) from public.push_subs where endpoint like '%/gone/%'`) === '0' && sql(`select count(*) from public.push_subs where email = 'ana@example.com'`) === '1', 'a phone the push service says is gone (410): forgotten');
await run(3, { VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' });
const st = await must('hi8_settings', {});
check(/^[A-Za-z0-9_-]{87}$/.test(st.vapid_public || '') && sql(`select count(*) from public.app_secrets where name = 'vapid_private'`) === '1', 'no keys yet: the worker makes the web push key pair; the site reads the public half, the private one stays in the database');
await run(3, { VAPID_PUBLIC_KEY: '', VAPID_PRIVATE_KEY: '' });
check((await must('hi8_settings', {})).vapid_public === st.vapid_public, '...once: the next run keeps the same pair');
sql(`select public.erase_email('ana@example.com')`);
check(sql(`select count(*) from public.wind_alerts where email = 'ana@example.com'`) === '0' && sql(`select count(*) from public.push_subs where email = 'ana@example.com'`) === '0', 'erasing a rider removes their alerts and phones');

srv.close();
console.log('\n' + ok + ' checks passed');
