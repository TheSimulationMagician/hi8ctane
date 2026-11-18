# TEST ONLY. 0020 (2.24): rider cards, and who sees what. Local stack (Postgres 5440, PostgREST behind serve.mjs on 8801).
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
def rpc(fn, body, ip='10.4.4.4'):
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST', headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': ip})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.crew_alerts, public.spot_watch, public.spot_reports cascade")
K = {n: rpc('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})[1]['key'] for n in ('ana', 'bo', 'cy', 'di', 'eve')}
st, _ = rpc('hi8_rider_profile', {'p_key': K['ana'], 'p_save': True, 'p_years': 6, 'p_home_spot': 'wijk-aan-zee', 'p_insta': '@ana.rides', 'p_tagline': 'Early mornings, big air.', 'p_card_public': True})
check(st == 200, 'a profile with a line about yourself')
st, r = rpc('hi8_rider_profile', {'p_key': K['bo'], 'p_save': True, 'p_tagline': 'DM me on instagram.com/bo'})
check(st != 200 and r.get('message') == 'bad_tagline', 'no links or handles in the line')
st, r = rpc('hi8_rider_profile', {'p_key': K['bo'], 'p_save': True, 'p_card_public': True})
check(st == 200 and r['card_public'] is True, 'a rider opens their card to riders deciding to join')
st, r = rpc('hi8_rider_profile', {'p_key': K['di'], 'p_save': True, 'p_years': 3, 'p_tagline': 'Quiet one.', 'p_card_public': False})
check(st == 200 and r['card_public'] is False, 'a rider can keep their card to their crews')
# history: ana + eve rode together 3 times; ana + bo once (bo a no-show once)
def crew(off, host, members, spot='wijk-aan-zee', noshow=()):
    cid = sql(f"insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email) values ('amsterdam','kite','{spot}', (now() at time zone 'Europe/Amsterdam')::date + {off}, '12:00','16:00','all',6,'cs','10:45','{host}@example.com') returning id").split('\n')[0]
    for m in members: sql(f"insert into public.crew_members (crew_id, email, level, getting, seats, no_show) values ('{cid}', '{m}@example.com', 'regular', '{'drive' if m == host else 'seat'}', {3 if m == host else 0}, {'true' if m in noshow else 'false'})")
    return sql(f"select code from public.crews where id = '{cid}'")
crew(-10, 'ana', ['ana', 'eve']); crew(-8, 'ana', ['ana', 'eve', 'bo'], 'ijmuiden', noshow=('bo',)); crew(-6, 'eve', ['eve', 'ana'], 'zandvoort'); crew(-4, 'ana', ['ana', 'bo'])
code = crew(1, 'ana', ['ana', 'bo', 'di'])

st, A = rpc('hi8_crew_cards', {'p_code': code, 'p_key': None})
plate = {n: int(sql(f"select plate from signups where email = '{n}@example.com'")) for n in ('ana', 'bo', 'di')}
key = lambda k: {v: n for n, v in plate.items()}.get(k.get('plate')) or ('di' if k.get('open') is False else '?')
by = {key(k): k for k in A}
check(st == 200 and len(A) == 3 and all('level' in k and 'initials' in k for k in A), 'anyone looking at the crew: everyone\'s card, initials and level')
check(by['ana'].get('name') == 'Rider #1' and 'name' not in by['bo'], 'outside the crew: no names (the captain\'s was already public)')
check(by['ana']['stats']['sessions'] == 4 and by['ana']['stats']['drives'] == 3 and by['ana']['stats']['started'] == 3 and by['ana']['stats']['spots'] == 3,
      'the numbers count sessions that happened: 4 rides, 3 drives, 3 crews started, 3 spots')
check(by['bo']['stats']['sessions'] == 1, 'a no-show isn\'t a ride')
check(by['ana']['years'] == 6 and by['ana']['home'] == 'Wijk aan Zee' and by['ana']['tagline'] == 'Early mornings, big air.', 'what makes it feel like someone: years riding, home spot, their line')
check(not any(x in k for k in A for x in ('insta', 'together')), 'signed out: no Instagram, no "together"')
check('stats' not in by['di'] and 'plate' not in by['di'] and 'tagline' not in by['di'] and by['di']['open'] is False, 'a closed card: just initials and level')
check('@example.com' not in json.dumps(A), 'no emails anywhere')

st, E = rpc('hi8_crew_cards', {'p_code': code, 'p_key': K['eve']})
by = {key(k): k for k in E}
check(by['ana']['together'] == 3 and by['bo']['together'] == 0, 'signed in: how often you rode together (a no-show doesn\'t count)')
check('insta' not in by['ana'] and 'name' not in by['bo'], 'not in the crew: no Instagram, no names')
check('tagline' not in by['di'] and 'years' not in by['di'], 'a closed card stays closed to riders outside the crew')

st, B = rpc('hi8_crew_cards', {'p_code': code, 'p_key': K['bo']})
by = {k['name']: k for k in B}
check(by['Rider #1']['insta'] == 'ana.rides' and all(k.get('name') for k in B), 'in the crew: names and Instagram')
check(by['Rider #4']['stats'] is not None and by['Rider #4']['tagline'] == 'Quiet one.', 'in the crew: the closed card opens')
check(by['Rider #2']['me'] is True and 'together' not in by['Rider #2'], 'your own card says it\'s you')

st, r = rpc('hi8_crew_cards', {'p_code': 'NOPE00', 'p_key': None})
check(st != 200 and r.get('message') == 'no_crew', 'an unknown crew: refused')
st, r = rpc('hi8_rider_stats', {'p_email': 'ana@example.com'})
check(st >= 400, 'the website can\'t ask anyone\'s numbers by email')
st, r = rpc('hi8_crew_cards', {'p_code': code, 'p_key': '00000000-0000-0000-0000-000000000000'})
check(st == 200 and not any('together' in k or 'insta' in k for k in r) and sum(1 for k in r if k.get('name')) == 1, 'a made-up key: the public cards, nothing more')
sql("insert into public.rider_avatars (email, path) values ('ana@example.com', 'test/ana.png'), ('di@example.com', 'test/di.png') on conflict (email) do update set path = excluded.path")
st, A = rpc('hi8_crew_cards', {'p_code': code, 'p_key': None}); by = {key(k): k for k in A}
check(by['ana'].get('avatar') == 'test/ana.png' and 'avatar' not in by['di'], 'the cartoon is on an open card (a closed one keeps it for the crew)')
st, B = rpc('hi8_crew_cards', {'p_code': code, 'p_key': K['bo']}); by = {k['name']: k for k in B}
check(by['Rider #4'].get('avatar') == 'test/di.png', 'in the crew: every cartoon')
print(f'\nALL {ok} RIDER CARD CHECKS PASSED')
