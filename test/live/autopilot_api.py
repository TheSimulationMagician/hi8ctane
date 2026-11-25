# TEST ONLY. 0028: captain powers only after a yes (H19); spot closures on every way in; I'm running late; the weekend
# proposal. Every check reads the tables after the call, so it shows real writes and real refusals.
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
n_ip = [0]
def rpc(fn, body):
    n_ip[0] += 1
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST', headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': f'10.6.{n_ip[0] // 200}.{n_ip[0] % 200}'})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.push_queue, public.push_subs, public.ride_asks, public.spot_notes, public.squads, public.squad_members cascade")
sql("update app_settings set value = 'true' where key = 'open_posting'")
K = {n: rpc('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})[1]['key'] for n in ('ana', 'bo', 'cy', 'di', 'eve')}
sql("update signups set first_name = initcap(split_part(email, '@', 1)) where email like '%@example.com'")
def crew(off, host, spot='wijk-aan-zee', start='14:00', end='17:00', seats=3):
    cid = sql(f"insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email) values ('amsterdam','kite','{spot}', hi8_today('amsterdam') + {off}, '{start}','{end}','all',6,'cs','11:45','{host}@example.com') returning id").split('\n')[0]
    sql(f"insert into public.crew_members (crew_id, email, level, getting, seats) values ('{cid}', '{host}@example.com', 'regular', '{'drive' if seats else 'own'}', {seats})")
    return sql(f"select code from public.crews where id = '{cid}'")
def join(n, code, getting='seat'):
    st, r = rpc('hi8_join_crew', {'p_key': K[n], 'p_code': code, 'p_level': 'regular', 'p_getting': getting, 'p_seats': 0})
    return st, r
day = lambda off: sql(f"select (hi8_today('amsterdam') + {off})::text")

print('H19: captain powers only after a yes')
A = crew(3, 'bo'); join('ana', A); join('cy', A)
st, r = rpc('hi8_step_down', {'p_key': K['bo'], 'p_code': A})
check(st == 200, 'Bo steps down')
asked = sql(f"select split_part(host_email, '@', 1) from crews where code = '{A}'")
check(asked in ('ana', 'cy') and sql(f"select captain_until is not null from crews where code = '{A}'") == 't', f'{asked} is asked; the handover is open')
for fn, body, what in (('hi8_move_crew', {'p_day': day(4), 'p_start': '14:00', 'p_end': '17:00'}, 'move the session'),
                       ('hi8_set_pin', {'p_lat': 52.49, 'p_lon': 4.59}, 'drop the pin'),
                       ('hi8_step_down', {}, 'step down again'),
                       ('hi8_leave_crew', {'p_reason': 'nope'}, 'call it off')):
    st, r = rpc(fn, {'p_key': K[asked], 'p_code': A, **body})
    check(st in (400, 401, 403) and r.get('message') == 'captain_pending', f'before saying yes, {asked} cannot {what} ({st} {r.get("message")})')
check(sql(f"select status || ' ' || day::text || ' ' || coalesce(meet_lat::text, '-') from crews where code = '{A}'") == 'on ' + day(3) + ' -', '...and nothing changed: still on, same day, no pin')
st, r = rpc('hi8_captain', {'p_key': K[asked], 'p_code': A, 'p_yes': True})
check(st == 200 and sql(f"select captain_until is null from crews where code = '{A}'") == 't', f'{asked} says KEEP IT ON: now captain')
st, r = rpc('hi8_move_crew', {'p_key': K[asked], 'p_code': A, 'p_day': day(4), 'p_start': '14:00', 'p_end': '17:00'})
check(st == 200 and sql(f"select day::text from crews where code = '{A}'") == day(4), '...and can move it')

print('spot closures, on every way in')
B = crew(5, 'eve', spot='ijmuiden')
sql(f"insert into spot_notes (city, spot, kind, body, from_day, to_day, source, checked_on) values ('amsterdam', 'ijmuiden', 'closed', 'Beach event, no kiting', hi8_today('amsterdam') + 5, hi8_today('amsterdam') + 5, 'test data', current_date)")
st, r = join('di', B)
check(st == 400 and r['message'] == 'spot_closed' and 'Beach event' in (r.get('hint') or ''), 'joining a crew on a closed day is refused, with the reason')
check(sql(f"select count(*) from crew_members m join crews c on c.id = m.crew_id where c.code = '{B}'") == '1', '...and nobody was added')
st, r = rpc('hi8_quick_join', {'p_email': 'new@example.com', 'p_name': 'New', 'p_code': B, 'p_level': 'regular', 'p_getting': 'own', 'p_seats': 0, 'p_car_with': None, 'p_source': 'link', 'p_ref': None})
check(st == 400 and r['message'] == 'spot_closed', 'the one-step join from a shared link is refused too')
st, r = rpc('hi8_start_crew', {'p_key': K['di'], 'p_sport': 'kite', 'p_spot': 'ijmuiden', 'p_day': day(5), 'p_start': '13:00', 'p_end': '16:00', 'p_levels': 'regular', 'p_max': 6, 'p_meet_hub': None, 'p_meet_time': None, 'p_meet_note': None, 'p_note': None, 'p_level': 'regular', 'p_getting': 'own', 'p_seats': 0, 'p_force': True})
check(st == 400 and r['message'] == 'spot_closed', 'starting a crew there that day is refused')
st, r = rpc('hi8_start_crew', {'p_key': K['di'], 'p_sport': 'kite', 'p_spot': 'ijmuiden', 'p_day': day(6), 'p_start': '13:00', 'p_end': '16:00', 'p_levels': 'regular', 'p_max': 6, 'p_meet_hub': None, 'p_meet_time': None, 'p_meet_note': None, 'p_note': None, 'p_level': 'regular', 'p_getting': 'own', 'p_seats': 0, 'p_force': True})
check(st == 200, 'the next day is fine')
D = crew(4, 'cy', spot='ijmuiden')
st, r = rpc('hi8_move_crew', {'p_key': K['cy'], 'p_code': D, 'p_day': day(5), 'p_start': '14:00', 'p_end': '17:00'})
check(st == 400 and r['message'] == 'spot_closed' and sql(f"select day::text from crews where code = '{D}'") == day(4), 'moving a crew onto the closed day is refused, and it stays put')
st, r = join('eve', B, 'drive')
check(st == 200, "the captain already in can still change how they're in")
st, c = rpc('hi8_crew', {'p_code': B})
check(c.get('closed') == 'Beach event, no kiting', 'the crew card carries the closure')
st, notes = rpc('hi8_spot_notes', {'p_city': 'amsterdam'})
check(any(n['kind'] == 'closed' and n['source'] == 'test data' for n in notes), 'the notes come with their source and the date they were checked')
st, r = rpc('hi8_spot_closed', {'p_city': 'amsterdam', 'p_spot': 'ijmuiden', 'p_day': day(5)})
check(st in (401, 403, 404), f'the internal checks are not callable from outside ({st})')

print("I'm running late")
T = crew(0, 'bo', start='23:00', end='23:59', seats=2)
sql(f"update crews set start_time = least(now() at time zone 'Europe/Amsterdam', (now() at time zone 'Europe/Amsterdam')::date + time '23:00')::time + interval '1 hour' where code = '{T}' and (now() at time zone 'Europe/Amsterdam')::time < time '22:30'")
join('ana', T); join('di', T, 'own')
st, r = rpc('hi8_late', {'p_key': K['ana'], 'p_code': T, 'p_min': 10})
ended = sql(f"select hi8_crew_ended(c) from crews c where code = '{T}'") == 't'
if ended:
    check(st == 400 and r['message'] == 'not_today', 'late at night the session counts as over: refused (skipped the rest)')
else:
    check(st == 200 and r.get('told') == 1, f'({st} {str(r)[:120]}) Ana is 10 min late: her driver Bo (also the captain) is told once')
    check(sql(f"select count(*) from crew_messages m join crews c on c.id = m.crew_id where c.code = '{T}' and m.kind = 'late' and m.body like '%10 min late'") == '1', 'the crew chat says it')
    st, r = rpc('hi8_late', {'p_key': K['ana'], 'p_code': T, 'p_min': 15})
    n_out = sql("select count(*) from outbox where subject like '%min late'") + '/' + sql("select count(*) from push_queue where title like '%min late'")
    check(st == 200 and n_out in ('1/0', '0/1'), f'saying it again within the quarter hour sends no second notice ({n_out})')
    st, r = rpc('hi8_late', {'p_key': K['di'], 'p_code': T, 'p_min': 7})
    check(st == 400 and r['message'] == 'bad_minutes', 'only 5, 10, 15, 20 or 30 minutes')
st, r = rpc('hi8_late', {'p_key': K['ana'], 'p_code': A, 'p_min': 10})
check(st in (400, 401, 403) and r['message'] in ('not_today', 'not_in_crew'), f'not on another day ({r["message"]})')
st, r = rpc('hi8_late', {'p_key': K['eve'], 'p_code': T, 'p_min': 10})
check(st in (400, 401, 403) and r['message'] in ('not_in_crew', 'not_today'), 'not for someone outside the crew')

print('the weekend proposal')
sq = sql("insert into squads (code, name, city, sport, created_by) values ('SQTEST', 'Bo’s crew', 'amsterdam', 'kite', 'bo@example.com') returning id").split('\n')[0]
for n in ('bo', 'ana', 'cy', 'di'): sql(f"insert into squad_members (squad_id, email) values ('{sq}', '{n}@example.com')")
sql(f"update crews set squad = '{sq}' where code = '{A}'")
PA = crew(-7, 'bo', seats=3)   # last week: Bo drove the kept crew
sql(f"update crews set squad = '{sq}' where code = '{PA}'")
for n, off in (('ana', 3), ('cy', 3), ('di', 4), ('eve', 3)): sql(f"insert into ride_asks (email, city, sport, day) values ('{n}@example.com', 'amsterdam', 'kite', hi8_today('amsterdam') + {off})")
before_members = sql('select count(*) from crew_members')
st, w = rpc('hi8_weekend', {'p_key': K['bo']})
s0 = w[0] if w else {}
up = {x['name']: x['up'] for x in s0.get('riders', [])}
check(st == 200 and len(w) == 1 and s0['code'] == 'SQTEST', 'Bo sees his kept crew')
check(sorted(k for k, v in up.items() if day(3) in v) == ['Ana', 'Cy'], 'who is up for which day (only crew members: Eve is not in it)')
check(s0['drivers'] >= 1 and s0['last']['hub'] == 'cs' and s0['last']['meet'] == '11:45', 'how many have driven, and the last set-up (pick-up, time)')
st, w2 = rpc('hi8_weekend', {'p_key': K['eve']})
check(st == 200 and w2 == [], 'someone outside the crew sees nothing')
check(sql(f"select count(*) from crews where squad = '{sq}'") == '2' and sql('select count(*) from crew_members') == before_members, 'reading the proposal commits nobody: no crew created, nobody added')
print(f'\n{ok} checks passed')
