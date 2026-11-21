# TEST ONLY. 0023 (2.29): matching. Riders you've ridden with per coming crew, and "I'm looking": days, a seat from
# where, numbers only for everyone else, told once when a crew that fits goes up (level, room, a seat), erase.
import json, os, subprocess, urllib.request, urllib.error

BASE = os.environ.get('HI8_BASE', 'http://localhost:8801')
PSQL = ['psql', '-h', '127.0.0.1', '-p', '5440', '-U', 'postgres', '-d', 'hi8', '-qAt', '-v', 'ON_ERROR_STOP=1']
ok = 0
def sql(q):
    r = subprocess.run(PSQL + ['-c', q], capture_output=True, text=True)
    if r.returncode: raise SystemExit('SQL failed: ' + r.stderr)
    return r.stdout.strip()
def check(cond, what):
    global ok
    if not cond: raise SystemExit('FAIL: ' + what)
    ok += 1; print('  ok ·', what)
def rpc(fn, body, ip='10.5.5.5'):
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST', headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': ip})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.push_queue, public.push_subs, public.alert_sent, public.ride_asks cascade")
K = {n: rpc('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})[1]['key'] for n in ('ana', 'bo', 'cy', 'di', 'eve')}
day = lambda off: sql(f"select (hi8_today('amsterdam') + {off})::text")
def crew(off, host, members, levels='all', spot='wijk-aan-zee', hub='cs', seats=2, start='13:00'):
    cid = sql(f"insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email) values ('amsterdam','kite','{spot}', hi8_today('amsterdam') + {off}, '{start}','17:00','{levels}',6,'{hub}','11:45','{host}@example.com') returning id").split('\n')[0]
    for m in members:
        g = 'drive' if m == host and seats else 'seat' if m != host else 'own'
        sql(f"insert into public.crew_members (crew_id, email, level, getting, seats) values ('{cid}', '{m}@example.com', 'regular', '{g}', {seats if m == host else 0})")
    return sql(f"select code from public.crews where id = '{cid}'")

print('riders you have ridden with')
crew(-5, 'ana', ['ana', 'bo']); crew(-3, 'cy', ['cy', 'ana'])
sat = crew(3, 'bo', ['bo', 'cy', 'eve'])
st, M = rpc('hi8_mates', {'p_key': K['ana']})
check(st == 200 and M == [{'code': sat, 'mates': 2}], "Ana: Bo and Cy are in Saturday's crew and she's ridden with both: 2 (a number, no names) " + str((st, M)))
st, M = rpc('hi8_mates', {'p_key': K['di']})
check(st == 200 and M == [], 'Di has ridden with nobody: nothing')
st, M = rpc('hi8_mates', {'p_key': '00000000-0000-0000-0000-000000000000'})
check(st != 200, 'a made-up key: refused')

print("I'm looking")
d1, d2 = day(1), day(2)
st, A = rpc('hi8_ask', {'p_key': K['di'], 'p_city': 'amsterdam', 'p_sport': 'kite', 'p_days': [d1, d2], 'p_seat': True, 'p_hub': 'cs', 'p_level': 'regular'})
check(st == 200 and [a['day'] for a in A] == [d1, d2] and A[0]['seat'] is True and A[0]['hub'] == 'cs', 'Di: tomorrow and the day after, needs a seat from CS')
st, _ = rpc('hi8_ask', {'p_key': K['eve'], 'p_city': 'amsterdam', 'p_sport': 'kite', 'p_days': [d1], 'p_seat': False, 'p_level': 'rookie'})
check(st == 200, 'Eve (learning): tomorrow, her own way')
st, N = rpc('hi8_asks', {'p_city': 'amsterdam', 'p_sport': 'kite'})
r1 = [x for x in N if x['day'] == d1][0]
check(r1['n'] == 2 and r1['seat'] == 1 and r1['rookies'] == 1 and r1['hubs'] == {'cs': 1}, 'anyone: 2 looking tomorrow, 1 needs a seat from CS, 1 learning')
check('example.com' not in json.dumps(N), '...numbers only: no emails, no names')
st, A = rpc('hi8_ask', {'p_key': K['di'], 'p_city': 'amsterdam', 'p_sport': 'kite', 'p_days': [d1], 'p_seat': True, 'p_hub': 'cs', 'p_level': 'regular'})
check([a['day'] for a in A] == [d1], 'Di changes her mind: just tomorrow (the other day is gone)')
st, r = rpc('hi8_ask', {'p_key': K['di'], 'p_city': 'amsterdam', 'p_sport': 'surfing-on-lava', 'p_days': [d1]})
check(st != 200, 'a sport the region does not have: refused')
st, r = rpc('hi8_ask', {'p_key': K['di'], 'p_city': 'amsterdam', 'p_sport': 'kite', 'p_days': [d1], 'p_level': 'pro'})
check(st != 200, 'a made-up level: refused')
st, r = rpc('hi8_ask_match', {})
check(st != 200, 'the website cannot run the matching itself')

print('told when a crew fits')
match = lambda: int(sql('select public.hi8_ask_match()'))
check(match() == 0, 'no crew tomorrow yet: nobody is told')
crew(1, 'cy', ['cy'], levels='regular', seats=0, hub='cs', start='10:00')
check(match() == 0, "a crew tomorrow for independent riders, no car: not for Eve (learning), no seat for Di")
crew(1, 'bo', ['bo'], levels='all', seats=2, hub='cs', start='14:00')
check(match() == 2, 'Bo posts for all levels, 2 seats from CS: both are told')
msgs = sql("select to_email || '|' || subject from public.outbox where kind = 'ask' order by to_email")
check('di@example.com|A crew for' in msgs and 'eve@example.com|A crew for' in msgs, 'by email (no phone): ' + msgs.replace('\n', ' / ')[:160])
body = sql("select body from public.outbox where kind = 'ask' and to_email = 'di@example.com'")
check('2 seats from' in body and 'Tap to hop on' in body, "the email says whose crew, when, and the seats from her pick-up: " + body.split('\n')[0][:120])
check(match() == 0, 'run again: nobody is told twice')
st, A = rpc('hi8_my_asks', {'p_key': K['di']})
check(A[0]['crew'] is not None, 'Di sees which crew she was told about')
st, N = rpc('hi8_asks', {'p_city': 'amsterdam', 'p_sport': 'kite'})
check(not [x for x in N if x['day'] == d1], 'once told, they are not counted as still looking')

print('already in a crew')
st, _ = rpc('hi8_ask', {'p_key': K['cy'], 'p_city': 'amsterdam', 'p_sport': 'kite', 'p_days': [day(3)], 'p_level': 'regular'})
check(match() == 0 and sql("select told_at is not null from ride_asks where email = 'cy@example.com'") == 't', "Cy asks for Saturday but she's already in Saturday's crew: closed, no message")

print('erase')
sql("select public.erase_email('di@example.com')")
check(sql("select count(*) from ride_asks where email = 'di@example.com'") == '0', 'erasing Di removes what she was looking for')
print(f'\nALL {ok} MATCHING CHECKS PASSED')
