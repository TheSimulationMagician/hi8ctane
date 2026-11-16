# TEST ONLY. 0015 (2.22) through the real API: keep a crew, join it by link, call it for the next session,
# the session log and card, starred spots and their emails, and erasing a rider.
import json, os, subprocess, urllib.request

BASE = os.environ.get('HI8_BASE', 'http://localhost:8801')
PSQL = ['psql', '-h', os.environ.get('PGHOST', '127.0.0.1'), '-p', os.environ.get('PGPORT', '5440'), '-U', 'postgres',
        '-d', os.environ.get('PGDATABASE', 'hi8'), '-qAt', '-v', 'ON_ERROR_STOP=1']
ok = 0
def sql(q):
    r = subprocess.run(PSQL + ['-c', q], capture_output=True, text=True)
    if r.returncode: raise SystemExit('SQL failed: ' + r.stderr)
    return r.stdout.strip()
def check(cond, what):
    global ok
    if not cond: raise SystemExit('FAIL: ' + what)
    ok += 1; print('  ok ·', what)
def rpc(fn, body, ip='10.8.8.8'):
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST',
                                 headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': ip})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
def must(fn, body):
    s, r = rpc(fn, body)
    if s != 200: raise SystemExit(f'FAIL: {fn} -> {s} {r}')
    return r
def err(fn, body):
    s, r = rpc(fn, body)
    return (r or {}).get('message') if s != 200 else None
def get(path):
    req = urllib.request.Request(f'{BASE}/rest/v1/{path}', headers={'apikey': 'sb_publishable_test'})
    try:
        with urllib.request.urlopen(req) as r: return r.status
    except urllib.error.HTTPError as e: return e.code

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.squads, public.squad_members, public.spot_watch, public.crew_alerts cascade")
K = {n: must('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})['key'] for n in ('ana', 'bo', 'cy', 'di', 'ed')}
def crew(spot, day_offset, host, members, start='10:00'):
    cid = sql(f"insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email) values ('amsterdam','kite','{spot}', (now() at time zone 'Europe/Amsterdam')::date + {day_offset}, '{start}', '14:00', 'all', 8, 'cs', '08:45', '{host}@example.com') returning id").split('\n')[0]
    for m in members:
        sql(f"insert into public.crew_members (crew_id, email, level, getting, seats) values ('{cid}', '{m}@example.com', 'regular', '{'drive' if m == host else 'seat'}', {3 if m == host else 0})")
    return sql(f"select code from public.crews where id = '{cid}'")

print('keep a crew')
past = crew('wijk-aan-zee', -3, 'ana', ['ana', 'bo', 'cy'])
check(err('hi8_squad_keep', {'p_key': K['di'], 'p_crew': past}) == 'not_in_crew', "someone who wasn't in the crew can't keep it")
sq = must('hi8_squad_keep', {'p_key': K['bo'], 'p_crew': past})
check(sq['size'] == 3 and sq['mine'] and sq['name'] == 'Wijk aan Zee crew' and sq['sessions'] == 1 and len(sq['code']) == 6, 'kept: the three riders, named after the spot, one session together')
again = must('hi8_squad_keep', {'p_key': K['cy'], 'p_crew': past})
check(again['code'] == sq['code'] and again['size'] == 3, 'keeping it again is the same group')

print('the link')
pub = must('hi8_squad', {'p_code': sq['code']})
check(pub['size'] == 3 and not pub['mine'] and all('email' not in json.dumps(r) for r in pub['riders']) and pub['url'].endswith('/?s=' + sq['code']), 'anyone with the link sees the group, names only, no emails')
j = must('hi8_squad_join', {'p_key': K['di'], 'p_code': sq['code']})
check(j['size'] == 4 and j['mine'], 'Di joins with the link')
check(err('hi8_squad', {'p_code': 'ZZZZZZ'}) == 'no_squad', 'a wrong link says so')

print('going Tue?')
nxt = crew('muiderberg', 2, 'ana', ['ana', 'bo'])
told = must('hi8_squad_call', {'p_key': K['ana'], 'p_code': sq['code'], 'p_crew': nxt})
check(told['told'] == 2, 'Ana calls the group: the two not in the crew yet (Cy, Di) get an email')
check(sql(f"select count(*) from public.outbox where kind = 'squad_call'") == '2' and 'muiderberg' in sql("select lower(body) from public.outbox where kind = 'squad_call' limit 1"), 'two emails queued, with the crew link')
told2 = must('hi8_squad_call', {'p_key': K['ana'], 'p_code': sq['code'], 'p_crew': nxt})
check(sql("select count(*) from public.outbox where kind = 'squad_call'") == '2', 'calling twice sends nothing new')
check(err('hi8_squad_call', {'p_key': K['ed'], 'p_code': sq['code'], 'p_crew': nxt}) == 'not_member', "someone outside the group can't call it")
v = must('hi8_squad', {'p_code': sq['code'], 'p_key': K['ana']})
check(len(v['next']) == 1 and v['next'][0]['code'] == nxt and v['mine'], "the group's page shows the next crew")
mine = must('hi8_squads', {'p_key': K['bo']})
check(len(mine) == 1 and mine[0]['code'] == sq['code'], "Bo's groups")

print('the log and the card')
crew('ijmuiden', -10, 'bo', ['bo', 'ana'])
card = must('hi8_card', {'p_key': K['ana']})
check(card['sessions'] == 2 and card['spots'] == 2 and card['drives'] == 1 and card['started'] == 1 and card['squads'] == 1, "Ana: 2 sessions, 2 spots, drove once, started one, one group")
check(card['log'][0]['spot_name'] == 'Wijk aan Zee' and len(card['log'][0]['riders']) == 2 and card['log'][1]['spot_name'] == 'IJmuiden' and card['log'][0]['role'] == 'drive', 'the log, newest first, with who came')
empty = must('hi8_card', {'p_key': K['ed']})
check(empty['sessions'] == 0 and empty['log'] == [], 'no sessions yet: an empty card')

print('your spots')
w = must('hi8_watch', {'p_key': K['ed'], 'p_spot': 'zandvoort', 'p_on': True})
check(w['spots'] == ['zandvoort'], 'Ed stars Zandvoort')
crew('zandvoort', 1, 'bo', ['bo'])
check(sql("select count(*) from public.outbox where kind = 'spot_crew' and to_email = 'ed@example.com'") == '1', 'a crew at Zandvoort: Ed gets one email')
sql("insert into public.crew_alerts (email, city, sport) values ('ed@example.com', 'amsterdam', 'kite')")
crew('zandvoort', 2, 'bo', ['bo'])
check(sql("select count(*) from public.outbox where kind = 'spot_crew' and to_email = 'ed@example.com'") == '1', 'with crew alerts on too, the star sends nothing extra')
w = must('hi8_watch', {'p_key': K['ed'], 'p_spot': 'zandvoort', 'p_on': False})
check(w['spots'] == [], 'unstarred')

print('closed and erased')
check(all(get(t + '?select=*') in (401, 403, 404) for t in ('squads', 'squad_members', 'spot_watch')), 'the tables are closed to the public')
sql("select public.erase_email('di@example.com')")
check(must('hi8_squad', {'p_code': sq['code']})['size'] == 3, 'erasing Di takes her out of the group')
print('\nALL %d MY-CREW CHECKS PASSED' % ok)
