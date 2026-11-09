# TEST ONLY. The first Barcelona pilot, start to finish: an MTB trail crew at Collserola from Sants,
# a rider joins with a seat, they chat, check in on the day and report the trails.
import json, os, subprocess, urllib.request, datetime
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
def rpc(fn, body, ip='10.20.0.1'):
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST',
                                 headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': ip})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

sql("truncate public.rate_hits")
tmrw = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
check(sql("select value from app_settings where key = 'open_posting'") == 'true', 'open posting is on: anyone with a plate can start a crew')

s, a = rpc('hi8_join', {'p_email': 'pilot-host@example.com', 'p_city': 'barcelona'}, ip='10.20.0.2'); host = a['key']
rpc('hi8_profile', {'p_key': host, 'p_name': 'Francisco'})
s, b = rpc('hi8_join', {'p_email': 'pilot-rider@example.com', 'p_city': 'barcelona'}, ip='10.20.0.3'); rider = b['key']
rpc('hi8_profile', {'p_key': rider, 'p_name': 'Pau'})
check(bool(host and rider), 'two riders sign up in Barcelona')

s, c = rpc('hi8_start_crew', {'p_key': host, 'p_sport': 'mtb', 'p_spot': 'collserola', 'p_day': tmrw, 'p_start': '09:00', 'p_end': '12:00',
                               'p_meet_hub': 'sants', 'p_meet_time': '08:30', 'p_getting': 'drive', 'p_seats': 3})
check(s == 200 and c.get('code'), 'an MTB trail crew at Collserola tomorrow, leaving Sants 08:30, 3 seats: ' + json.dumps(c.get('message', ''))[:80])
code = c['code']; hmid = c['members'][0]['member_id']
s, L = rpc('hi8_crews', {'p_city': 'barcelona'})
check(any(x['code'] == code and x['sport'] == 'mtb' for x in L), 'it shows on the Barcelona list for everyone')
s, j = rpc('hi8_join_crew', {'p_key': rider, 'p_code': code, 'p_level': 'regular', 'p_getting': 'seat', 'p_car_with': hmid}, ip='10.20.0.3')
check(s == 200 and j['going'] == 2, 'Pau joins with a seat in the car: 2 going')
s, m = rpc('hi8_send', {'p_key': rider, 'p_code': code, 'p_body': 'Bringing a spare tube'}, ip='10.20.0.3')
s, msgs = rpc('hi8_messages', {'p_key': host, 'p_code': code})
check(s == 200 and 'spare tube' in json.dumps(msgs), 'the crew chat works')
sql(f"update crews set day = hi8_today(city), start_time = (hi8_city_now(city) - interval '20 minutes')::time, end_time = null where code = '{code}'")
s, h = rpc('hi8_checkin', {'p_key': host, 'p_code': code})
s, h = rpc('hi8_checkin', {'p_key': rider, 'p_code': code}, ip='10.20.0.3')
check(s == 200 and h['here'] == 2, 'on the day, both check in at the trailhead: a verified outing')
s, r = rpc('hi8_report', {'p_key': rider, 'p_code': code, 'p_verdict': 'on', 'p_ground': 'dry'}, ip='10.20.0.3')
check(s == 200, 'Pau reports the trails: on, dry')
sql(f"delete from crews where code = '{code}'"); sql("delete from signups where email like 'pilot-%@example.com'"); sql("delete from rider_keys where email like 'pilot-%@example.com'")
print(f'\nALL {ok} BARCELONA PILOT CHECKS PASSED')
