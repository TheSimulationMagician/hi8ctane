# TEST ONLY. 0024 (2.30): the session plan. Stages and rechecks, a move asks "still in?", the captain's exact pin,
# drop-outs tell the car, the captain stepping down (handover, pass it on, take it, nobody in time), no-shows on the card.
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
def told(email, like): return int(sql(f"select count(*) from public.outbox where kind = 'plan' and to_email = '{email}@example.com' and subject like '{like.replace(chr(39), chr(39)*2)}%'"))

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.push_queue, public.push_subs, public.ride_asks cascade")
K = {n: rpc('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})[1]['key'] for n in ('ana', 'bo', 'cy', 'di', 'eve', 'fay')}
sql("update signups set first_name = initcap(split_part(email, '@', 1)) where email like '%@example.com'")
def crew(off, host, start='14:00', seats=3):
    cid = sql(f"insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email) values ('amsterdam','kite','wijk-aan-zee', hi8_today('amsterdam') + {off}, '{start}','17:00','all',6,'cs','11:45','{host}@example.com') returning id").split('\n')[0]
    sql(f"insert into public.crew_members (crew_id, email, level, getting, seats) values ('{cid}', '{host}@example.com', 'regular', 'drive', {seats})")
    return sql(f"select code from public.crews where id = '{cid}'")
def join(n, code, getting='seat', seats=0, level='regular'):
    st, r = rpc('hi8_join_crew', {'p_key': K[n], 'p_code': code, 'p_level': level, 'p_getting': getting, 'p_seats': seats})
    if st != 200: raise SystemExit(f'join {n}: {st} {r}')
code = crew(2, 'ana')
join('bo', code); join('cy', code, 'drive', 2, 'ripper'); join('di', code, 'own', 0, 'rookie')

print('stages and rechecks')
st, c = rpc('hi8_crew', {'p_code': code})
check(st == 200 and c['checked_ok'] is None and c['unsure'] == 0 and 'meet_lat' not in c, 'a new crew: not rechecked yet, nobody unsure; outsiders get no pin field')
sql(f"select public.hi8_recheck('{code}', true, 20, '20 kt SW at 14:00, GOOD')")
st, c = rpc('hi8_crew', {'p_code': code})
check(c['checked_ok'] is True and c['checked_kt'] == 20 and c['checked_at'], 'rechecked: stamped with the time and 20 kt')
sql(f"select public.hi8_recheck('{code}', false, 8, '8 kt at 14:00, NO GO')")
check(told('bo', 'Back on') == 0, 'going doubtful sends nothing here ("forecast dropped" tells them, with the next window)')
n = sql(f"select public.hi8_recheck('{code}', true, 18, '18 kt SW at 14:00, GOOD')")
check(n == '4' and told('bo', 'Back on') == 1, 'it comes back: all 4 told "back on"')
st, r = rpc('hi8_recheck', {'p_code': code, 'p_ok': False})
check(st != 200, 'the website cannot recheck')

print('moved: still in?')
st, r = rpc('hi8_move_crew', {'p_key': K['ana'], 'p_code': code, 'p_day': sql("select (hi8_today('amsterdam') + 3)::text"), 'p_start': '13:00', 'p_end': '16:00'})
check(st == 200, f'the captain moves it ({st})')
st, c = rpc('hi8_crew', {'p_code': code, 'p_key': K['bo']})
check(c['me']['unsure'] is True and c['unsure'] == 3 and len(c['unsure_ids']) == 3 and c['checked_ok'] is None, 'moved: the 3 riders are unsure until they say, the captain is not; the recheck starts over')
st, c = rpc('hi8_still_in', {'p_key': K['bo'], 'p_code': code})
check(st == 200 and c['me']['unsure'] is False and c['unsure'] == 2, 'Bo: STILL IN')
st, r = rpc('hi8_still_in', {'p_key': K['eve'], 'p_code': code})
check(st != 200, 'someone not in the crew: refused')

print('the exact pin')
st, r = rpc('hi8_set_pin', {'p_key': K['bo'], 'p_code': code, 'p_lat': 52.49, 'p_lon': 4.59})
check(st != 200, 'only the captain drops the pin')
st, r = rpc('hi8_set_pin', {'p_key': K['ana'], 'p_code': code, 'p_lat': 52.37, 'p_lon': 4.89})
check(st != 200 and 'km away' in (r.get('hint') or ''), 'a pin in Amsterdam, not at the spot: refused: ' + str(r.get('hint')))
lat, lon = sql("select lat || ',' || lon from spots where slug = 'wijk-aan-zee'").split(',')
st, c = rpc('hi8_set_pin', {'p_key': K['ana'], 'p_code': code, 'p_lat': float(lat) + 0.004, 'p_lon': float(lon) + 0.002})
check(st == 200 and abs(c['meet_lat'] - float(lat) - 0.004) < 1e-9, 'the beach entrance, 500 m from the spot: pinned')
st, c = rpc('hi8_crew', {'p_code': code, 'p_key': K['di']})
check(c['meet_lat'] is not None, 'the crew sees it')
st, c = rpc('hi8_crew', {'p_code': code, 'p_key': K['eve']})
check('meet_lat' not in c, 'someone outside the crew does not')

print('drop-outs')
rpc('hi8_leave_crew', {'p_key': K['bo'], 'p_code': code, 'p_reason': None})
check(told('ana', 'A seat is free') == 1 and told('cy', 'A seat is free') == 0 and told('di', 'A seat is free') == 0, "Bo (a seat in Ana's car) drops out: Ana hears a seat is free, nobody else")
cym = sql(f"select m.member_id from crew_members m join crews c on c.id = m.crew_id where c.code = '{code}' and m.email = 'cy@example.com'")
for n in ('eve', 'fay'):
    st, r = rpc('hi8_join_crew', {'p_key': K[n], 'p_code': code, 'p_level': 'regular', 'p_getting': 'seat', 'p_seats': 0, 'p_car_with': cym})
    if st != 200: raise SystemExit(f'join {n}: {st} {r}')
rpc('hi8_leave_crew', {'p_key': K['cy'], 'p_code': code, 'p_reason': None})
check(told('eve', 'Your lift dropped out') == 1 and told('fay', 'Your lift dropped out') == 1 and told('di', 'Your lift') == 0, 'Cy (a driver) drops out: the two riders in his car hear it, Di (own way) does not')
check(sql(f"select count(*) from crew_members m join crews c on c.id = m.crew_id where c.code = '{code}' and m.car_with is not null and m.email in ('eve@example.com', 'fay@example.com')") == '0', '...and they are out of his car, free to pick another')

print('the captain steps down')
join('cy', code, 'drive', 2, 'ripper')
st, r = rpc('hi8_step_down', {'p_key': K['bo'], 'p_code': code})
check(st != 200, 'only the captain can step down')
st, c = rpc('hi8_step_down', {'p_key': K['ana'], 'p_code': code})
row = sql(f"select host_email || '|' || (captain_until is not null) || '|' || captain_left || '|' || status from crews where code = '{code}'")
check(st == 200 and row == 'cy@example.com|true|Ana|on', 'Ana steps down: it goes to Cy (the driver), who has to say yes; the crew stays on · ' + row)
check(sql(f"select count(*) from crew_members m join crews c on c.id = m.crew_id where c.code = '{code}' and m.email = 'ana@example.com'") == '0', 'Ana is out of the crew')
check(told('cy', 'Captain needed') == 1 and told('di', 'New captain needed') == 1, 'Cy is asked; the others hear it')
st, c = rpc('hi8_crew', {'p_code': code, 'p_key': K['cy']})
check(c['captain_ask'] is True and c['captain_until'], 'Cy sees KEEP IT ON / PASS IT ON')
st, c = rpc('hi8_captain', {'p_key': K['cy'], 'p_code': code, 'p_yes': False})
nxt = sql(f"select host_email from crews where code = '{code}'")
check(st == 200 and nxt != 'cy@example.com' and nxt != 'ana@example.com', 'Cy passes: the next in line is asked · ' + nxt)
st, r = rpc('hi8_captain', {'p_key': K['eve'], 'p_code': code, 'p_yes': False}) if nxt != 'eve@example.com' else rpc('hi8_captain', {'p_key': K['fay'], 'p_code': code, 'p_yes': False})
check(st != 200, "only the one asked can pass it on")
st, c = rpc('hi8_captain', {'p_key': K['di'], 'p_code': code, 'p_yes': True})
check(st == 200 and sql(f"select host_email || '|' || (captain_until is null) from crews where code = '{code}'") == 'di@example.com|true' and c['host_is_me'], 'Di (anyone in the crew) takes it: she is the captain, it is on')
check(told('eve', "It's still on") == 1, 'the crew hears it is still on')

print('nobody in time')
code2 = crew(1, 'eve', '15:00'); join('fay', code2)
rpc('hi8_step_down', {'p_key': K['eve'], 'p_code': code2})
sql(f"update crews set captain_until = now() - interval '1 minute' where code = '{code2}'")
check(sql('select public.hi8_captain_expire()') == '1' and sql(f"select status || '|' || off_reason from crews where code = '{code2}'") == 'off|Nobody took over as captain in time', 'nobody said yes by the deadline: called off')
code3 = crew(1, 'fay', '15:00')
st, c = rpc('hi8_step_down', {'p_key': K['fay'], 'p_code': code3})
check(sql(f"select status from crews where code = '{code3}'") == 'off', 'stepping down with nobody else in: called off')

print('no-shows on the card')
past = crew(-3, 'ana', '10:00')
sql(f"insert into crew_members (crew_id, email, level, getting, seats) select id, 'bo@example.com', 'regular', 'seat', 0 from crews where code = '{past}'")
sql(f"update crew_members set no_show = true where email = 'bo@example.com' and crew_id = (select id from crews where code = '{past}')")
st, p = rpc('hi8_rider_profile', {'p_key': K['bo']})
check(p['stats']['no_shows'] == 1 and p['stats']['sessions'] == 0, "a no-show counts on Bo's card, not as a session")
print(f'\nALL {ok} SESSION PLAN CHECKS PASSED')
