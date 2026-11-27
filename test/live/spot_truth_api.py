# TEST ONLY. 0030: riders confirm the conditions at the spot (only from the spot: checked in with a crew, or a
# location within 2 km that is compared and never kept), the last 3 hours per spot as numbers, and "open to new
# riders" (a rider opts in to be counted by crews they didn't keep; a captain can close a crew to new riders).
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
def rpc(fn, body, ip='10.6.6.6'):
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST', headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': ip})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.push_queue, public.push_subs, public.alert_sent, public.ride_asks, public.spot_reports, public.squads cascade")
K = {n: rpc('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})[1]['key'] for n in ('ana', 'bo', 'cy', 'di', 'eve')}
lat, lon = [float(x) for x in sql("select lat || ',' || lon from public.spots where slug = 'wijk-aan-zee'").split(',')]
rep = lambda who, **kw: rpc('hi8_spot_report', dict({'p_key': K[who], 'p_spot': 'wijk-aan-zee', 'p_verdict': 'on'}, **{'p_' + k: v for k, v in kw.items()}))

print('only from the spot')
st, r = rep('ana')
check(st != 200 and 'not_at_spot' in json.dumps(r), 'Ana at home, no location, no crew: refused (not at the spot)')
st, r = rep('ana', lat=lat + 0.12, lon=lon)
check(st != 200 and 'not_at_spot' in json.dumps(r), '...her location 13 km away: refused')
st, r = rep('ana', lat=lat + 0.008, lon=lon, wind='stronger', gusts='gusty', water='chop', crowd='busy', kite=9, level='regular')
check(st == 200 and len(r) == 1 and r[0]['n'] == 1 and r[0]['located'] == 1 and r[0]['wind'] == 'stronger' and r[0]['kites'] == [9], 'at the beach (900 m): ON, wind stronger than forecast, gusty, chop, busy, 9 m ' + str(r)[:200])
check(sql("select count(*) from information_schema.columns where table_name = 'spot_reports' and column_name in ('lat', 'lon')") == '0', '...her position is compared, never kept')
st, r = rep('ana', verdict='meh', lat=lat, lon=lon, wind='as_forecast')
check(st == 200 and r[0]['n'] == 1 and r[0]['meh'] == 1 and r[0]['on'] == 0 and sql("select count(*) from public.spot_reports") == '1', 'saying it again within 20 minutes replaces the last one (no stuffing)')

print('checked in with a crew')
cid = sql("insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, host_email) values ('amsterdam','kite','wijk-aan-zee', hi8_today('amsterdam'), '13:00','17:00','all',6,'bo@example.com') returning id").splitlines()[0]
sql(f"insert into public.crew_members (crew_id, email, level, getting, seats) values ('{cid}', 'bo@example.com', 'ripper', 'own', 0)")
st, r = rep('bo')
check(st != 200, 'Bo is in a crew there today but not checked in: refused')
sql(f"update public.crew_members set here_at = now() where crew_id = '{cid}'")
st, r = rep('bo', wind='stronger', gusts='gusty', water='waves')
check(st == 200 and r[0]['n'] == 2 and r[0]['checkin'] == 1 and r[0]['located'] == 1 and r[0]['levels']['ripper'] == 1, 'checked in: no location needed, his level comes from the crew')
check(r[0]['latest']['verdict'] == 'on' and r[0]['latest']['how'] == 'checkin' and r[0]['on'] == 1 and r[0]['meh'] == 1, '...the freshest report on top, the split ON 1 · MEH 1')
check('example.com' not in json.dumps(r) and 'email' not in json.dumps(r), '...numbers only: no names, no emails')
st, C = rpc('hi8_conditions', {'p_city': 'amsterdam'})
check(st == 200 and C[0]['spot'] == 'wijk-aan-zee' and C[0]['n'] == 2, 'anyone can read the last 3 hours for the region')

print('what fits the sport')
st, r = rep('bo', ground='muddy')
check(st != 200, 'ground on a kite beach: refused')
st, r = rep('bo', kite=40)
check(st != 200, 'a 40 m kite: refused')
st, r = rpc('hi8_spot_report', {'p_key': K['cy'], 'p_spot': 'schoorl', 'p_verdict': 'on', 'p_wind': 'stronger', 'p_lat': float(sql("select lat from spots where slug='schoorl'")), 'p_lon': float(sql("select lon from spots where slug='schoorl'"))})
check(st != 200, 'wind against the forecast on an MTB trail: refused')
st, r = rpc('hi8_spot_report', {'p_key': K['cy'], 'p_spot': 'schoorl', 'p_verdict': 'meh', 'p_ground': 'muddy', 'p_lat': float(sql("select lat from spots where slug='schoorl'")), 'p_lon': float(sql("select lon from spots where slug='schoorl'"))})
check(st == 200 and r[0]['sport'] == 'mtb' and r[0]['ground'] == 'muddy', 'MTB at Schoorl: MEH, muddy')
st, r = rep('bo', verdict='epic')
check(st != 200, 'a made-up verdict: refused')
st, r = rpc('hi8_spot_report', {'p_key': '00000000-0000-0000-0000-000000000000', 'p_spot': 'wijk-aan-zee', 'p_verdict': 'on', 'p_lat': lat, 'p_lon': lon})
check(st != 200, 'a made-up key: refused')
sql("update public.spot_reports set at = now() - interval '4 hours' where lower(email) = 'ana@example.com'")
st, C = rpc('hi8_conditions', {'p_city': 'amsterdam', 'p_spot': 'wijk-aan-zee'})
check(C[0]['n'] == 1 and C[0]['located'] == 0, 'a report older than 3 hours drops out')

print('open to new riders')
d1, d2 = sql("select (hi8_today('amsterdam') + 1)::text"), sql("select (hi8_today('amsterdam') + 2)::text")
st, A = rpc('hi8_ask', {'p_key': K['di'], 'p_city': 'amsterdam', 'p_sport': 'kite', 'p_days': [d2], 'p_level': 'regular', 'p_open': True})
check(st == 200 and A[0]['open'] is True, 'Di: free the day after tomorrow, open to new crews')
st, A = rpc('hi8_ask', {'p_key': K['di'], 'p_city': 'amsterdam', 'p_sport': 'kite', 'p_days': [d1, d2], 'p_level': 'regular'})
check(st == 200 and all(a['open'] is True for a in A), '...changing her days without saying it again keeps her open (the call without p_open still works)')
st, A = rpc('hi8_ask', {'p_key': K['eve'], 'p_city': 'amsterdam', 'p_sport': 'kite', 'p_days': [d1], 'p_level': 'regular'})
check(st == 200 and A[0]['open'] is False, 'Eve says nothing about it: not open (off unless you say so)')
st, N = rpc('hi8_asks', {'p_city': 'amsterdam', 'p_sport': 'kite'})
r1 = [x for x in N if x['day'] == d1][0]
check(r1['n'] == 2 and r1['open'] == 1 and r1['open_levels']['regular'] == 1 and 'example.com' not in json.dumps(N), 'anyone: 2 free tomorrow, 1 open to new crews, at regular (numbers only)')

print('a crew closed to new riders')
sq = sql("insert into public.squads (name, city, sport, created_by) values ('Bo crew', 'amsterdam', 'kite', 'bo@example.com') returning id").splitlines()[0]
sql(f"insert into public.squad_members (squad_id, email) values ('{sq}', 'bo@example.com'), ('{sq}', 'di@example.com')")
c1 = sql(f"insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, host_email, squad) values ('amsterdam','kite','wijk-aan-zee', hi8_today('amsterdam') + 1, '13:00','17:00','all',6,'bo@example.com','{sq}') returning code").splitlines()[0]
sql(f"insert into public.crew_members (crew_id, email, level, getting, seats) select id, 'bo@example.com', 'regular', 'own', 0 from public.crews where code = '{c1}'")
st, r = rpc('hi8_crew_open', {'p_key': K['eve'], 'p_code': c1, 'p_open': False})
check(st != 200, 'Eve is not the captain: she cannot close it')
st, r = rpc('hi8_crew_open', {'p_key': K['bo'], 'p_code': c1, 'p_open': False})
check(st == 200 and r['open'] is False, 'Bo, the captain, closes it to new riders')
sql("select public.hi8_ask_match()")
told = dict(x.split('|') for x in sql(f"select email, coalesce((select code from crews where id = crew_id), '') from public.ride_asks where day = hi8_today('amsterdam') + 1").splitlines())
check(told.get('eve@example.com') == '' and told.get('di@example.com') == c1, 'the matcher tells Di (from the crew he kept), not Eve (new)')
check(sql(f"select count(*) from public.crews where code = '{c1}'") == '1' and sql(f"select open_new from public.crews where code = '{c1}'") == 'f', '...the crew is still on the site, just not pushed to new riders')

print('the proposal counts new riders')
sql(f"insert into public.squad_members (squad_id, email) values ('{sq}', 'cy@example.com')")
sql(f"delete from public.crews where code = '{c1}'")
rpc('hi8_ask', {'p_key': K['bo'], 'p_city': 'amsterdam', 'p_sport': 'kite', 'p_days': [d2], 'p_level': 'regular'})
rpc('hi8_ask', {'p_key': K['cy'], 'p_city': 'amsterdam', 'p_sport': 'kite', 'p_days': [d2], 'p_level': 'regular'})
rpc('hi8_ask', {'p_key': K['ana'], 'p_city': 'amsterdam', 'p_sport': 'kite', 'p_days': [d2], 'p_level': 'regular', 'p_open': True})
sql("delete from public.squad_members where email = 'di@example.com'")
code = sql(f"select code from public.squads where id = '{sq}'")
n = sql(f"select public.hi8_squad_nudge('{code}', hi8_today('amsterdam') + 2, 'wijk-aan-zee', 13, 17, '20 kt SW')")
msg = sql("select coalesce((select body from public.push_queue order by id desc limit 1), (select body from public.outbox order by id desc limit 1))")
check(n == '1' and 'plus 2 new riders open to a crew' in msg, 'Bo hears: 2 of his crew are up for it, plus 2 new riders (Ana and Di said open): ' + msg)
st, r = rpc('hi8_squad_nudge', {'p_code': code, 'p_day': d2, 'p_spot': 'wijk-aan-zee', 'p_from': 13, 'p_to': 17, 'p_line': 'x'})
check(st != 200, 'the website cannot send proposals itself')

print(f'ALL {ok} SPOT TRUTH CHECKS PASSED')
