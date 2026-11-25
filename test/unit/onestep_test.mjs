// TEST ONLY. 0029 "one step ahead" and the worker parts of it, against the local stack (Postgres 5440, PostgREST
// 3300 behind test/live/serve.mjs on 8801, which also stands in for Open-Meteo).
// The proposal for a crew you kept, lifts that sort themselves, the captain's call when the forecast drops, and the
// next one asked after a session. Nothing commits anyone: every message ends in a tap.
// Run: node test/unit/onestep_test.mjs
import crypto from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

const BASE = process.env.HI8_BASE || 'http://localhost:8801';
let ok = 0;
const check = (c, what) => { if (!c) { console.error('FAIL: ' + what); process.exit(1); } ok++; console.log('  ok ·', what); };
const sql = (q) => execFileSync('psql', ['-h', '127.0.0.1', '-p', '5440', '-U', 'postgres', '-d', 'hi8', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', q], { encoding: 'utf8' }).trim();
let ipn = 0;
async function rpc(fn, body) {
  ipn++;
  const r = await fetch(BASE + '/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': '10.29.' + (ipn >> 8) + '.' + (ipn & 255) }, body: JSON.stringify(body) });
  const t = await r.text(); return [r.status, t ? JSON.parse(t) : null];
}
const must = async (fn, body) => { const [s, r] = await rpc(fn, body); if (s !== 200) { console.error('FAIL: ' + fn + ' -> ' + s + ' ' + JSON.stringify(r)); process.exit(1); } return r; };
const JWT = (() => { const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url'); const h = b({ alg: 'HS256', typ: 'JWT' }), p2 = b({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 });
  return h + '.' + p2 + '.' + crypto.createHmac('sha256', 'test-secret-test-secret-test-secret-0123').update(h + '.' + p2).digest('base64url'); })();
const run = (hour) => new Promise((res) => {
  const ch = spawn('node', ['scripts/alerts.mjs'], { env: { ...process.env, REST_URL: 'http://localhost:3300', SUPABASE_SECRET_KEY: JWT, FORECAST_API: BASE, MARINE_API: BASE,
    STORAGE_URL: BASE + '/storage/v1', NO_SHARED: '1', TEST_HOUR: String(hour), SITE_URL: 'https://hi8ctane.com' } });
  let o = '', e = ''; ch.stdout.on('data', (d) => (o += d)); ch.stderr.on('data', (d) => (e += d));
  ch.on('close', (code) => { if (code !== 0) { console.error(o, e); process.exit(1); } res(o); });
});
const mails = (who, like) => sql(`select count(*) from public.outbox where to_email = '${who}@example.com' and subject like '${like}'`);

sql('truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.crew_alerts, public.wind_alerts, public.push_subs, public.push_queue, public.alert_sent, public.ride_asks, public.squads, public.squad_members, public.spot_notes cascade');
sql("update app_settings set value = 'true' where key in ('open_posting', 'strict_keys')");
const K = {};
for (const n of ['jo', 'bo', 'cy', 'di', 'eve', 'fay']) K[n] = (await must('hi8_join', { p_email: n + '@example.com', p_city: 'amsterdam' })).key;
sql("update public.signups set first_name = initcap(split_part(email, '@', 1)) where email like '%@example.com'");
const crew = (off, host, opts = {}) => {
  const id = sql(`insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email, min_riders${opts.squad ? ', squad' : ''})
    values ('amsterdam', 'kite', '${opts.spot || 'wijk-aan-zee'}', hi8_today('amsterdam') + ${off}, '${opts.start || '13:00'}', '${opts.end || '16:00'}', 'all', 6, 'cs', '11:45', '${host}@example.com', 2${opts.squad ? ", '" + opts.squad + "'" : ''}) returning id`).split('\n')[0];
  sql(`insert into public.crew_members (crew_id, email, level, getting, seats) values ('${id}', '${host}@example.com', 'regular', '${opts.getting || 'drive'}', ${opts.seats ?? 1})`);
  return sql(`select code from public.crews where id = '${id}'`);
};
const member = (code, who, getting, seats = 0) => sql(`insert into public.crew_members (crew_id, email, level, getting, seats, joined_at) select id, '${who}@example.com', 'regular', '${getting}', ${seats}, now() + interval '${ipn++} seconds' from public.crews where code = '${code}'`);

console.log('1. the proposal comes to the person who made the crew you kept');
const sq = sql("insert into public.squads (code, name, city, sport, created_by) values ('WKREG', 'Wijk regulars', 'amsterdam', 'kite', 'jo@example.com') returning id").split('\n')[0];
for (const n of ['jo', 'bo', 'cy', 'di']) sql(`insert into public.squad_members (squad_id, email) values ('${sq}', '${n}@example.com')`);
crew(-6, 'jo', { squad: sq });
for (const n of ['bo', 'cy']) for (let d = 1; d <= 5; d++) sql(`insert into public.ride_asks (email, city, sport, day) values ('${n}@example.com', 'amsterdam', 'kite', hi8_today('amsterdam') + ${d})`);
let out = await run(14);
check(mails('jo', '% looks good · Wijk regulars') === '0', 'at 14:00: nothing yet (proposals go out 17:00–21:00)');
out = await run(18);
const nud = sql("select subject || '|' || body from public.outbox where to_email = 'jo@example.com' and subject like '% looks good · Wijk regulars'");
check(/proposals sent: 1/.test(out) && nud !== '', 'at 18:00: Jo gets "' + nud.split('|')[0] + '"');
check(/2 of Wijk regulars are up for it/.test(nud) && !/\bBo\b|\bCy\b/.test(nud), 'the message has a count, no names');
check(/https:\/\/hi8ctane\.com\/\?propose=WKREG&d=\d{4}-\d\d-\d\d&sp=wijk-aan-zee&f=\d+&t=\d+/.test(nud), 'one link opens the filled-in proposal');
check(sql("select count(*) from public.crews") === '1', 'nothing is posted: no new crew');
await run(19);
check(mails('jo', '% looks good · Wijk regulars') === '1', 'one an evening at most');
const day = nud.match(/&d=(\d{4}-\d\d-\d\d)/)[1];
sql("update public.squads set nudged_at = null");
crew(Number(sql(`select '${day}'::date - hi8_today('amsterdam')`)), 'bo', { squad: sq });
check(sql(`select public.hi8_squad_nudge('WKREG', '${day}', 'wijk-aan-zee', 13, 16, 'x')`) === '0', 'a day the crew already has a session: not proposed again');
sql("update public.ride_asks set day = day + 30 where email = 'cy@example.com'");
check(sql(`select public.hi8_squad_nudge('WKREG', hi8_today('amsterdam') + 2, 'wijk-aan-zee', 13, 16, 'x')`) === '0', 'only one person up that day: no proposal');

console.log('2. lifts sort themselves');
const L = crew(1, 'eve', { seats: 1, spot: 'ijmuiden' });
await must('hi8_join_crew', { p_key: K.fay, p_code: L, p_level: 'regular', p_getting: 'seat', p_seats: 0 });
await must('hi8_join_crew', { p_key: K.cy, p_code: L, p_level: 'regular', p_getting: 'seat', p_seats: 0 });
const carOf = (who) => sql(`select coalesce((select split_part(d.email, '@', 1) from public.crew_members d where d.member_id = m.car_with), '-') from public.crew_members m join public.crews c on c.id = m.crew_id where c.code = '${L}' and m.email = '${who}@example.com'`);
check(carOf('fay') === 'eve' && carOf('cy') === '-', 'Eve has 1 seat: Fay gets it, Cy waits');
await must('hi8_join_crew', { p_key: K.di, p_code: L, p_level: 'regular', p_getting: 'own', p_seats: 0 });
out = await run(12);
check(/asked to drive 1/.test(out) && mails('di', 'Driving anyway?%') === '1', 'the day before: Di (going her own way) is asked once if she\'s driving anyway');
check(mails('cy', 'Still finding you a seat%') === '1', '...and Cy hears that we asked');
await run(12);
check(mails('di', 'Driving anyway?%') === '1', 'asked once, not every run');
await must('hi8_join_crew', { p_key: K.di, p_code: L, p_level: 'regular', p_getting: 'drive', p_seats: 3 });
check(carOf('cy') === 'di', 'Di switches to I\'LL DRIVE: Cy is in her car straight away');
check(mails('cy', 'You have a seat%') === '1' && mails('di', 'Cy is in your car%') === '1', 'both are told');
const L2 = crew(2, 'bo', { seats: 0, getting: 'own', spot: 'zandvoort' });
member(L2, 'cy', 'seat'); member(L2, 'jo', 'drive', 2);
check(sql(`select public.hi8_fill_seats(id) from public.crews where code = '${L2}'`) === '1' && sql(`select count(*) from public.crew_members m join public.crews c on c.id = m.crew_id where c.code = '${L2}' and m.car_with is not null`) === '1', 'a driver with room and a rider without a seat (any order): filled on the next run');

console.log('3. the forecast makes the call, the captain confirms');
const F = crew(1, 'bo', { seats: 2, spot: 'zandvoort', start: '10:00', end: '12:00' });
member(F, 'jo', 'seat');
check(Number(sql(`select public.hi8_fx_drop('${F}', '8 kt SW at 10:00, no go', 'Sat 14–17, 19 kt')`)) === 2, 'both riders are told');
const capm = sql(`select subject || '|' || body from public.outbox where to_email = 'bo@example.com' and kind = 'fx'`);
check(capm.startsWith('Your call: the forecast dropped') && capm.includes('&call=1') && capm.includes('Next good window: Sat 14–17'), 'the captain gets the question, with a link that opens CALL IT OFF / KEEP IT ON');
check(sql(`select subject from public.outbox where to_email = 'jo@example.com' and kind = 'fx'`).startsWith('Forecast dropped'), 'the others get the news as before');
check(sql(`select status from public.crews where code = '${F}'`) === 'on', 'nothing is called off by the app');

console.log('4. the next one gets asked for you');
const P = crew(-1, 'jo', { seats: 2 });
member(P, 'bo', 'seat'); member(P, 'cy', 'seat');
const P1 = crew(-1, 'fay', { seats: 0, getting: 'own', spot: 'ijmuiden' });
out = await run(10);
const ag = sql(`select subject || '|' || body from public.outbox where to_email = 'jo@example.com' and subject like 'Same crew again?%'`);
check(ag !== '' && /Next good window at Wijk aan Zee: \w+ \d+ \d\d–\d\d/.test(ag) && /\?c=[A-Z0-9]+&again=\d{4}-\d\d-\d\d&f=\d+&t=\d+/.test(ag), 'the morning after: Jo (the captain) gets the next good window and RUN IT AGAIN, filled in');
check(sql(`select count(*) from public.outbox where to_email = 'fay@example.com' and subject like 'Same crew again?%'`) === '0', 'a session of one: not asked');
await run(11);
check(sql(`select count(*) from public.outbox where to_email = 'jo@example.com' and subject like 'Same crew again?%'`) === '1', 'once per crew');
const P2 = crew(-1, 'eve', { seats: 2, spot: 'ijmuiden' }); member(P2, 'jo', 'seat');
sql(`update public.crews set day = hi8_today('amsterdam') + 3 where code = '${L}'`);   // Eve already has the next one at IJmuiden
await run(12);
check(sql(`select count(*) from public.outbox where to_email = 'eve@example.com' and subject like 'Same crew again?%'`) === '0', 'the captain already has the next one at that spot: not asked');

console.log('the website can\'t call any of it');
for (const fn of ['hi8_worker_squads', 'hi8_lifts']) { const [s] = await rpc(fn, {}); check(s === 401 || s === 403 || s === 404, fn + ' refused (' + s + ')'); }
const [s2] = await rpc('hi8_squad_nudge', { p_code: 'WKREG', p_day: day, p_spot: 'wijk-aan-zee', p_from: 13, p_to: 16, p_line: 'x' });
check(s2 === 401 || s2 === 403 || s2 === 404, 'hi8_squad_nudge refused (' + s2 + ')');
console.log('\n' + ok + ' checks passed');
