# TEST ONLY. 0009 (2.11) through the real API: where riders start, the best car for a rider who needs a seat, the
# best pick-up for each rider, stops in order with times, the Google Maps route, and what stays private.
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
def rpc(fn, body, ip='10.11.0.1'):
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST',
                                 headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': ip})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

sql("truncate public.signups, public.rider_keys, public.crews, public.crew_members, public.crew_messages, public.rate_hits, public.outbox, public.wallet_ledger, public.seat_payments cascade")
sql("delete from public.hubs where kind = 'town'")
sql("update public.app_settings set value = 'true' where key = 'open_posting'")
day = (datetime.date.today() + datetime.timedelta(days=2)).isoformat()
n = [0]
def person(name):
    n[0] += 1; ip = f'10.11.1.{n[0]}'
    s, j = rpc('hi8_join', {'p_email': name.lower() + '@example.com', 'p_city': 'barcelona'}, ip=ip); rpc('hi8_profile', {'p_key': j['key'], 'p_name': name}, ip=ip); return j['key'], ip
# Sant Pere Pescador is north: a driver from La Sagrera (north) and one from Sants (south-west)
(nord, ipn), (sud, ips), (rita, ipr), (pol, ipp), (eva, ipe), (out, ipo) = person('Nord'), person('Sud'), person('Rita'), person('Pol'), person('Eva'), person('Out')
s, c = rpc('hi8_start_crew', {'p_key': sud, 'p_sport': 'kite', 'p_spot': 'sant-pere-pescador', 'p_day': day, 'p_start': '12:00', 'p_end': '16:00',
                              'p_meet_hub': 'sants', 'p_meet_time': '09:30', 'p_getting': 'drive', 'p_seats': 3}, ip=ips)
code = c['code']
rpc('hi8_join_crew', {'p_key': nord, 'p_code': code, 'p_level': 'regular', 'p_getting': 'drive', 'p_seats': 3, 'p_car_with': None}, ip=ipn)
for k, ip in ((rita, ipr), (pol, ipp), (eva, ipe)):
    rpc('hi8_join_crew', {'p_key': k, 'p_code': code, 'p_level': 'regular', 'p_getting': 'seat', 'p_seats': 0, 'p_car_with': None}, ip=ip)

print('where everyone starts')
s, b = rpc('hi8_set_from', {'p_key': out, 'p_code': code, 'p_lat': 41.40, 'p_lon': 2.18}, ip=ipo)
check(s == 400 and b['message'] == 'not_in_crew', 'only people in the crew')
s, b = rpc('hi8_set_from', {'p_key': rita, 'p_code': code, 'p_lat': 48.85, 'p_lon': 2.35}, ip=ipr)
check(s == 400 and b['message'] == 'too_far', 'Paris for a Catalan spot: no')
rpc('hi8_set_from', {'p_key': sud, 'p_code': code, 'p_lat': 41.379, 'p_lon': 2.140}, ip=ips)    # Sants
rpc('hi8_set_from', {'p_key': nord, 'p_code': code, 'p_lat': 41.423, 'p_lon': 2.190}, ip=ipn)   # La Sagrera
check(sql("select from_lat || ',' || from_lon from crew_members m where lower(email) = 'nord@example.com'") == '41.42,2.19', 'kept to about 1 km')

print('the best car for each rider')
s, p = rpc('hi8_set_from', {'p_key': rita, 'p_code': code, 'p_lat': 41.428, 'p_lon': 2.186}, ip=ipr)  # Rita lives by La Sagrera
nord_id = sql("select member_id from crew_members where lower(email) = 'nord@example.com'")
check(s == 200 and sql("select car_with from crew_members where lower(email) = 'rita@example.com'") == nord_id, 'Rita, north of town, rides with Nord (on the way north)')
s, p = rpc('hi8_set_from', {'p_key': pol, 'p_code': code, 'p_lat': 41.376, 'p_lon': 2.135}, ip=ipp)  # Pol by Sants
sud_id = sql("select member_id from crew_members where lower(email) = 'sud@example.com'")
check(sql("select car_with from crew_members where lower(email) = 'pol@example.com'") == sud_id, 'Pol, by Sants, rides with Sud')

print('the route')
cars = {x['driver']: x for x in p['cars']}
nr = cars['Nord']
check([st['name'] for st in nr['stops']] == ['LA SAGRERA'] and nr['stops'][0]['riders'] == ['Rita'], "Nord's car stops at La Sagrera for Rita")
check(cars['Sud']['stops'][0]['name'] == 'SANTS' and 'Pol' in cars['Sud']['stops'][0]['riders'], "Sud's car picks up Pol at Sants")
rpc('hi8_set_from', {'p_key': eva, 'p_code': code, 'p_lat': 41.392, 'p_lon': 2.164}, ip=ipe)  # Eva in Gràcia
s, p = rpc('hi8_car_plan', {'p_key': eva, 'p_code': code}, ip=ipe)
eva_car = [x for x in p['cars'] if any('Eva' in st['riders'] for st in x['stops'])][0]
names = [st['name'] for st in eva_car['stops']]
check('GRÀCIA' in names or 'LA SAGRERA' in names or 'SANTS' in names, f'Eva gets a pick-up near Gràcia ({names})')
times = [st['at'] for st in eva_car['stops']]
check(times == sorted(times) and all(t < '12:00' for t in times), f'stops in order, with times before the 12:00 start ({times})')
check(eva_car['maps'].startswith('https://www.google.com/maps/dir/?api=1') and 'waypoints=' in eva_car['maps'] and 'destination=42.19' in eva_car['maps'], 'a Google Maps route through the pick-ups to the spot')
check(p['saved_km'] > 100, f'{p["saved_km"]} km not driven, against everyone driving')
raw = json.dumps(p)
check('41.428' not in raw and '41.43' not in raw and '41.376' not in raw and '41.39,' not in raw, 'nobody\'s start in what the app gets: pick-up names and times only')
s, b = rpc('hi8_car_plan', {'p_key': out, 'p_code': code}, ip=ipo)
check(s == 400 and b['message'] == 'not_in_crew', 'and only the crew sees the route')

print('paid seats stay put')
pol_car = sql("select car_with from crew_members where lower(email) = 'pol@example.com'")
sql("update crew_members set paid_at = now() where lower(email) = 'pol@example.com'")
rpc('hi8_set_from', {'p_key': pol, 'p_code': code, 'p_lat': 41.428, 'p_lon': 2.186}, ip=ipp)
check(sql("select car_with from crew_members where lower(email) = 'pol@example.com'") == pol_car, 'Pol has paid his seat: he isn\'t moved to another car')

print(f'\nALL {ok} ROUTE CHECKS PASSED')
