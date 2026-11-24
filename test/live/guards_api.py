# TEST ONLY. 0027 (UX review P0): a finished session can't be called off or left; STILL IN counts only for the
# version of the plan the rider saw, and never on a called-off or finished crew. Every check reads the table after.
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

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.push_queue, public.push_subs, public.ride_asks cascade")
K = {n: rpc('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})[1]['key'] for n in ('ana', 'bo', 'cy')}
def crew(off, host, start='14:00', end='17:00'):
    cid = sql(f"insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email) values ('amsterdam','kite','wijk-aan-zee', hi8_today('amsterdam') + {off}, '{start}','{end}','all',6,'cs','11:45','{host}@example.com') returning id").split('\n')[0]
    sql(f"insert into public.crew_members (crew_id, email, level, getting, seats) values ('{cid}', '{host}@example.com', 'regular', 'drive', 3)")
    return sql(f"select code from public.crews where id = '{cid}'")
def join(n, code):
    st, r = rpc('hi8_join_crew', {'p_key': K[n], 'p_code': code, 'p_level': 'regular', 'p_getting': 'seat', 'p_seats': 0})
    if st != 200: raise SystemExit(f'join {n}: {st} {r}')

print('a finished session')
past = crew(-1, 'ana'); join('bo', past)
st, r = rpc('hi8_leave_crew', {'p_key': K['ana'], 'p_code': past, 'p_reason': None})
check(st == 400 and r['message'] == 'crew_done', "the captain can't call off yesterday's session")
check(sql(f"select status from crews where code = '{past}'") == 'on', '...and it stays on (it still counts as a completed session)')
st, r = rpc('hi8_leave_crew', {'p_key': K['bo'], 'p_code': past, 'p_reason': None})
check(st == 400 and sql(f"select count(*) from crew_members m join crews c on c.id = m.crew_id where c.code = '{past}'") == '2', "a rider can't leave it afterwards either")
st, c = rpc('hi8_crew', {'p_code': past})
check(c.get('ended') is True and c.get('plan_v') == 1, 'the crew card says it ended, and carries the plan version')

print('still in? for the version you saw')
code = crew(3, 'ana'); join('bo', code); join('cy', code)
rpc('hi8_move_crew', {'p_key': K['ana'], 'p_code': code, 'p_day': sql("select (hi8_today('amsterdam') + 4)::text"), 'p_start': '15:00', 'p_end': '18:00'})
check(sql(f"select plan_v from crews where code = '{code}'") == '2', 'a move bumps the plan version')
check(sql(f"select count(*) from crew_members m join crews c on c.id = m.crew_id where c.code = '{code}' and m.unsure") == '2', 'and makes the riders unsure (as in 0024)')
st, r = rpc('hi8_still_in', {'p_key': K['bo'], 'p_code': code, 'p_v': 1})
check(st == 409 and r['message'] == 'plan_changed', 'STILL IN for an older version is refused')
check(sql(f"select unsure from crew_members m join crews c on c.id = m.crew_id where c.code = '{code}' and m.email = 'bo@example.com'") == 't', '...and Bo stays unsure')
st, r = rpc('hi8_still_in', {'p_key': K['bo'], 'p_code': code, 'p_v': 2})
check(st == 200 and sql(f"select unsure from crew_members m join crews c on c.id = m.crew_id where c.code = '{code}' and m.email = 'bo@example.com'") == 'f', 'STILL IN for the version shown counts')
st, r = rpc('hi8_still_in', {'p_key': K['cy'], 'p_code': code})
check(st == 200, 'an older app without the version still works (no p_v)')
sql(f"update crews set meet_time = '12:15' where code = '{code}'")
check(sql(f"select plan_v from crews where code = '{code}'") == '3', 'a new meeting time is a material change too')
sql(f"update crews set note = 'bring a 12' where code = '{code}'")
check(sql(f"select plan_v from crews where code = '{code}'") == '3', 'a captain note is not')

print('called off')
rpc('hi8_leave_crew', {'p_key': K['ana'], 'p_code': code, 'p_reason': 'No wind'})
check(sql(f"select status from crews where code = '{code}'") == 'off', 'the captain calls off an upcoming session (still allowed)')
st, r = rpc('hi8_still_in', {'p_key': K['bo'], 'p_code': code})
check(st == 400 and r['message'] == 'crew_off', 'STILL IN on a called-off crew is refused, not a silent yes')
st, r = rpc('hi8_still_in', {'p_key': K['bo'], 'p_code': 'NOPE00'})
check(st == 404, 'an unknown crew is a 404')
print(f'\n{ok} checks passed')
