# TEST ONLY. 0007 (2.9.1) through the real API: regions, starting points riders add (hi8_add_start), when they
# show on the list, crews leaving from them, limits, and the MX day at €180 all in.
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
def rpc(fn, body, ip='10.7.7.7'):
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST',
                                 headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': ip})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

sql("truncate public.signups, public.rider_keys, public.crews, public.crew_members, public.crew_messages, public.rate_hits, public.outbox cascade")
sql("delete from public.hubs where kind = 'town'")
sql("update public.app_settings set value = 'true' where key = 'open_posting'")
tmrw = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()

print('regions')
s, pl = rpc('hi8_places', {})
reg = {c['slug']: c.get('region') for c in pl['cities']}
check(reg['amsterdam'] == 'Netherlands' and reg['barcelona'] == 'Catalonia', 'Amsterdam is the Netherlands, Barcelona is Catalonia')
check(all('kind' in h and 'crews' in h for h in pl['hubs']) and all(h['kind'] == 'hub' for h in pl['hubs']), 'every pick-up point says what it is and how many crews leave from it')

print('adding where you start')
s, b = rpc('hi8_add_start', {'p_city': 'lisbon', 'p_name': 'Lisboa', 'p_lat': 38.72, 'p_lon': -9.14})
check(s == 400 and b['message'] == 'unknown_city', 'a region that isn\'t open: no')
s, b = rpc('hi8_add_start', {'p_city': 'amsterdam', 'p_name': 'x', 'p_lat': 52.09, 'p_lon': 5.12})
check(s == 400 and b['message'] == 'bad_name', 'a one-letter name: no')
s, b = rpc('hi8_add_start', {'p_city': 'amsterdam', 'p_name': '<script>', 'p_lat': 52.09, 'p_lon': 5.12})
check(s == 400 and b['message'] == 'bad_name', 'markup in the name: no')
s, b = rpc('hi8_add_start', {'p_city': 'amsterdam', 'p_name': 'Paris', 'p_lat': 48.85, 'p_lon': 2.35})
check(s == 400 and b['message'] == 'too_far', 'Paris is too far from the Dutch spots')
s, b = rpc('hi8_add_start', {'p_city': 'amsterdam', 'p_name': 'Haarlem', 'p_lat': 52.3874, 'p_lon': 4.6462})
check(s == 200 and b['slug'] == 'hlm' and b['existing'] is True, 'Haarlem, 600 m from the Haarlem pick-up: that one is used')
s, u = rpc('hi8_add_start', {'p_city': 'amsterdam', 'p_name': '  utrecht   centraal ', 'p_lat': 52.089444, 'p_lon': 5.110278})
check(s == 200 and u['slug'] == 't-utrecht-centraal' and u['name'] == 'UTRECHT CENTRAAL' and u['kind'] == 'town' and u['existing'] is False, 'Utrecht Centraal is new: a town start, the name tidied')
check(u['lat'] == 52.089 and u['lon'] == 5.11, 'kept to about 100 m: a meeting point, never an address')
s, u2 = rpc('hi8_add_start', {'p_city': 'amsterdam', 'p_name': 'Utrecht Centraal', 'p_lat': 52.0905, 'p_lon': 5.1105})
check(s == 200 and u2['slug'] == u['slug'] and u2['existing'] is True, 'the same place again: no second one')
s, u3 = rpc('hi8_add_start', {'p_city': 'amsterdam', 'p_name': 'Utrecht Centraal', 'p_lat': 52.06, 'p_lon': 5.16})
check(s == 200 and u3['slug'] != u['slug'] and u3['slug'].startswith('t-utrecht-centra') and u3['slug'].endswith('-2'), 'the same name 5 km away: its own place')
s, bcn = rpc('hi8_add_start', {'p_city': 'barcelona', 'p_name': 'Badalona', 'p_lat': 41.4500, 'p_lon': 2.2474})
check(s == 200 and bcn['slug'] == 't-badalona', 'Badalona in Catalonia')

print('on the list once a crew leaves from it')
s, pl = rpc('hi8_places', {})
check(not any(h['kind'] == 'town' for h in pl['hubs']), 'no crew from them yet: not on the list')
s, j = rpc('hi8_join', {'p_email': 'ruud@example.com', 'p_city': 'amsterdam'}); ruud = j['key']
rpc('hi8_profile', {'p_key': ruud, 'p_name': 'Ruud'})
s, c = rpc('hi8_start_crew', {'p_key': ruud, 'p_sport': 'kite', 'p_spot': 'wijk-aan-zee', 'p_day': tmrw, 'p_start': '12:00', 'p_end': '16:00',
                               'p_meet_hub': u['slug'], 'p_meet_time': '10:30', 'p_getting': 'drive', 'p_seats': 3})
check(s == 200 and c['code'], 'Ruud starts a kite crew from Utrecht Centraal')
s, pl = rpc('hi8_places', {})
ut = [h for h in pl['hubs'] if h['slug'] == u['slug']]
check(ut and ut[0]['crews'] == 1 and ut[0]['name'] == 'UTRECHT CENTRAAL', 'now it\'s on the list for everyone, with 1 crew')
check(not any(h['slug'] in (u3['slug'], bcn['slug']) for h in pl['hubs']), 'the places nobody left from stay hidden')
s, cr = rpc('hi8_crew', {'p_code': c['code']})
check(s == 200 and cr['meet_hub'] == u['slug'], 'the crew page knows where it leaves from')

print('limits and the MX day')
for i in range(12):
    s, b = rpc('hi8_add_start', {'p_city': 'amsterdam', 'p_name': f'Spam {i}', 'p_lat': 52.0 + i * 0.05, 'p_lon': 4.5}, ip='10.7.7.99')
check(s == 429, 'too many new places from one phone in an hour: slow down')
s, P = rpc('hi8_plans', {'p_city': 'barcelona'})
mx = [p for p in P if p['slug'] == 'mx-day-martorelles'][0]
check(mx['price_from'] == 180 and 'all in' in mx['price_note'] and 'Fuel' in mx['includes'], 'the MX day: €180 all in (bike, gear, track, insurance, fuel)')
sql("delete from public.hubs where kind = 'town' and slug like 't-spam%'")

print(f'\nALL {ok} START CHECKS PASSED')
