// TEST ONLY. The cartoon function (supabase/functions/_shared/cartoon.js) against the real database (through
// serve.mjs on 8801, as the service role), a fake OpenAI and a fake Storage that record what they were sent.
import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const { cartoon, readImage, PROMPT } = await import('../../supabase/functions/_shared/cartoon.js');

let ok = 0;
const check = (c, what) => { if (!c) { console.error('FAIL: ' + what); process.exit(1); } ok++; console.log('  ok ·', what); };
const sql = (q) => execFileSync('psql', ['-h', '127.0.0.1', '-p', '5440', '-U', 'postgres', '-d', 'hi8', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', q]).toString().trim();
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const head = b64({ alg: 'HS256', typ: 'JWT' }), body = b64({ role: 'service_role', exp: Math.floor(Date.now() / 1000) + 3600 });
const SERVICE = `${head}.${body}.` + createHmac('sha256', 'test-secret-test-secret-test-secret-0123').update(`${head}.${body}`).digest('base64url');
const env = { OPENAI_API_KEY: 'sk-test', SUPABASE_URL: 'http://localhost:8801', SUPABASE_SERVICE_ROLE_KEY: SERVICE, SITE_URL: 'https://hi8ctane.com' };

// fakes: OpenAI draws a tiny "webp", Storage keeps files in a Map; the database is real
const files = new Map(), ai = []; let aiAnswer = 'ok';
const PIXEL = Buffer.from('RIFF....WEBPVP8 fake cartoon').toString('base64');
let n = 0; const uuid = () => '00000000-0000-4000-8000-' + String(++n).padStart(12, '0');
const ans = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
const fake = async (url, init) => {
  if (url === 'https://api.openai.com/v1/images/edits') {
    const fd = init.body; ai.push({ auth: init.headers.authorization, model: fd.get('model'), prompt: fd.get('prompt'), image: fd.get('image'), fmt: fd.get('output_format'), bg: fd.get('background'), fid: fd.get('input_fidelity'), q: fd.get('quality') });
    if (aiAnswer === 'blocked') return ans({ error: { code: 'moderation_blocked', message: 'Your request was rejected by the safety system.' } }, 400);
    if (aiAnswer === 'down') return ans({ error: { message: 'server error' } }, 500);
    return ans({ data: [{ b64_json: PIXEL }] });
  }
  if (url.startsWith('http://localhost:8801/storage/v1/object')) {
    if (init.method === 'POST') { files.set(url.split('/avatars/')[1], { type: init.headers['content-type'], bytes: init.body.length, auth: init.headers.authorization }); return ans({ Key: 'avatars/x' }); }
    if (init.method === 'DELETE') { for (const p of JSON.parse(init.body).prefixes) files.delete(p); return ans([]); }
  }
  return fetch(url, { ...init, headers: { ...init.headers, apikey: 'sb_publishable_test', 'x-test-ip': '10.9.9.8' } });
};
const deps = { fetch: fake, uuid };
const fails = async (p, code) => { try { await p; return false; } catch (e) { return e.message === code ? true : (console.error('   got', e.message), false); } };
const rpc = async (fn, args) => { const r = await fetch('http://localhost:8801/rest/v1/rpc/' + fn, { method: 'POST', headers: { apikey: 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': '10.9.0.7' }, body: JSON.stringify(args) }); return { status: r.status, body: await r.json().catch(() => null) }; };

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.rider_avatars, public.avatar_trash, public.cartoon_log, public.pass_interest cascade");
sql("update public.app_settings set value = 'true' where key = 'cartoons_on'");
const key = (await rpc('hi8_join', { p_email: 'lu@example.com', p_city: 'amsterdam' })).body.key;
const SELFIE = 'data:image/jpeg;base64,' + Buffer.from('\xff\xd8\xff fake jpeg selfie').toString('base64');

console.log('the photo');
check(readImage(SELFIE).type === 'image/jpeg', 'a JPEG data URL is read');
check(await fails(cartoon({ key, image: 'data:text/html;base64,PGI+', consent: true }, env, deps), 'bad_image'), 'not an image: refused');
check(await fails(cartoon({ key, image: 'data:image/jpeg;base64,' + 'A'.repeat(4.2 * 1024 * 1024), consent: true }, env, deps), 'too_big'), 'over 3 MB: refused');
check(await fails(cartoon({ key, image: SELFIE }, env, deps), 'no_consent'), 'without ticking the box: nothing is sent');
check(await fails(cartoon({ key: 'nope', image: SELFIE, consent: true }, env, deps), 'no_key'), 'no plate key: refused');
check(await fails(cartoon({ key, image: SELFIE, consent: true }, { ...env, OPENAI_API_KEY: '' }, deps), 'cartoons_off'), 'no OpenAI key set: switched off, nothing sent');
check(ai.length === 0, 'and OpenAI was never called for any of those');

console.log('drawing it');
let out = await cartoon({ key, image: SELFIE, consent: true }, env, deps);
const a = ai.at(-1);
check(out.path === '00000000-0000-4000-8000-000000000001.webp' && files.has(out.path) && files.get(out.path).type === 'image/webp', 'the cartoon is stored as a webp with a random name');
check(a.auth === 'Bearer sk-test' && a.model === 'gpt-image-1' && a.fmt === 'webp' && a.bg === 'transparent' && a.fid === 'high' && a.q === 'medium' && a.prompt === PROMPT, 'OpenAI: gpt-image-1, high face fidelity, transparent webp, the surf-mag prompt');
check(a.image && a.image.type === 'image/jpeg' && a.image.size > 0, 'the selfie went only to OpenAI');
check([...files.values()].every((f) => f.type === 'image/webp'), 'the selfie itself was never stored');
check(sql("select path from rider_avatars where email = 'lu@example.com'") === out.path, 'it is now her cartoon');
const mine = await rpc('hi8_my_avatar', { p_key: key });
check(mine.body.path === out.path && mine.body.on === true, 'the website reads it with her key');
check((await rpc('hi8_avatar', { p_email: 'lu@example.com' })).status === 404 || (await rpc('hi8_avatar', { p_email: 'lu@example.com' })).status === 401, "nobody can look up someone's cartoon by email");
check((await rpc('hi8_cartoon_start', { p_key: key })).status !== 200, 'the website cannot start a drawing itself (only the function can)');

console.log('again, and the limits');
const first = out.path;
out = await cartoon({ key, image: SELFIE, consent: true }, env, deps);
check(out.path !== first && files.has(out.path) && !files.has(first), 'a new cartoon replaces the old one; the old file is deleted');
aiAnswer = 'blocked';
check(await fails(cartoon({ key, image: SELFIE, consent: true }, env, deps), 'not_drawn'), "a photo OpenAI won't draw: a clear message");
aiAnswer = 'ok';
check(await fails(cartoon({ key, image: SELFIE, consent: true }, env, deps), 'slow_down'), '3 drawings a day per rider, then no more (the refused one counts)');
check(sql("select path from rider_avatars where email = 'lu@example.com'") === out.path, 'and her cartoon is still the last good one');
const key2 = (await rpc('hi8_join', { p_email: 'kai@example.com', p_city: 'amsterdam' })).body.key;
sql("update app_settings set value = '3' where key = 'cartoon_daily_max'");
check(await fails(cartoon({ key: key2, image: SELFIE, consent: true }, env, deps), 'busy'), 'the daily cap for everyone (cost control)');
sql("update app_settings set value = '100' where key = 'cartoon_daily_max'");
aiAnswer = 'down';
check(await fails(cartoon({ key: key2, image: SELFIE, consent: true }, env, deps), 'draw_failed'), 'OpenAI down: says so');
aiAnswer = 'ok';
sql("update app_settings set value = 'false' where key = 'cartoons_on'");
check(await fails(cartoon({ key: key2, image: SELFIE, consent: true }, env, deps), 'cartoons_off'), 'the switch in app_settings turns it off');
sql("update app_settings set value = 'true' where key = 'cartoons_on'");
let unk = null; const before = ai.length; try { await cartoon({ key: '00000000-0000-4000-8000-00000000abcd', image: SELFIE, consent: true }, env, deps); } catch (e) { unk = e; }
check(unk && unk.status === 400 && ai.length === before, 'an unknown key: refused before anything goes to OpenAI (' + (unk && unk.message) + ')');

console.log('in a crew');
out = await cartoon({ key: key2, image: SELFIE, consent: true }, env, deps);
const kai = out.path;
sql(`insert into crews (city, sport, spot, day, start_time, levels, host_email, code) values ('amsterdam','kite','zandvoort', hi8_today('amsterdam')+1, '10:00', 'regular', 'kai@example.com', 'CART01')`);
sql(`insert into crew_members (crew_id, email, level, getting) select id, 'kai@example.com', 'regular', 'own' from crews where code = 'CART01'`);
sql(`insert into crew_members (crew_id, email, level, getting) select id, 'lu@example.com', 'regular', 'seat' from crews where code = 'CART01'`);
const inside = (await rpc('hi8_crew', { p_code: 'CART01', p_key: key })).body;
check(inside.members && inside.members.some((m) => m.avatar === kai), 'riders in the crew see each other\'s cartoons');
const outside = (await rpc('hi8_crew', { p_code: 'CART01' })).body;
check(!outside.members && !JSON.stringify(outside).includes(kai) && !JSON.stringify((await rpc('hi8_crews', { p_city: 'amsterdam' })).body).includes(kai), 'anyone else sees initials only: no cartoons on public crew cards');

console.log('taking it off, and erasing');
out = await cartoon({ key, kind: 'remove' }, env, deps);
check(out.removed === true && sql("select count(*) from rider_avatars where email = 'lu@example.com'") === '0' && files.size === 1, 'REMOVE: her cartoon and its file are gone');
sql("insert into pass_interest (email, source) values ('kai@example.com', 'me')");
sql("select erase_email('kai@example.com')");
check(sql("select count(*) from rider_avatars where email = 'kai@example.com'") === '0' && sql("select count(*) from avatar_trash") === '1' && sql("select count(*) from pass_interest") === '0', 'erasing a rider queues the cartoon for deletion and drops the Pass list entry');
await cartoon({ key, kind: 'remove' }, env, deps); // any later call empties the trash
check(!files.has(kai) && sql("select count(*) from avatar_trash") === '0', 'and the next call deletes the file from Storage');

console.log(`\nALL ${ok} CARTOON CHECKS PASSED`);
