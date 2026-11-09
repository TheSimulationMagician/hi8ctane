# TEST ONLY. 0010 (2.12) through the real API: Tarifa open with its pick-ups, Tatajuba's list, and trips.
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
def rpc(fn, body, ip='10.12.0.1'):
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST',
                                 headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': ip})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

sql("delete from public.signups where city = 'tatajuba'"); sql("delete from public.plans where slug = 'test-trip'"); sql("truncate public.rate_hits")

print('Tarifa is open')
s, P = rpc('hi8_places', {})
cities = {c['slug']: c for c in P['cities']}
check(cities['tarifa']['status'] == 'open' and cities['tarifa']['region'] == 'Tarifa', 'Tarifa: open, region Tarifa')
check({h['slug'] for h in P['hubs'] if h['city'] == 'tarifa'} >= {'town', 'alg', 'cadiz'}, 'pick-ups in Tarifa, Algeciras and Cádiz')
check(any(sp['slug'] == 'valdevaqueros' and 'Levante' in (sp.get('note') or '') for sp in P['spots']), 'Valdevaqueros with its Levante note')
s, j = rpc('hi8_join', {'p_email': 'tar@example.com', 'p_city': 'tarifa'}, ip='10.12.0.2')
s, c = rpc('hi8_add_start', {'p_city': 'tarifa', 'p_name': 'Vejer', 'p_lat': 36.2526, 'p_lon': -5.9676}, ip='10.12.0.2')
check(s == 200, 'a rider can start from a town near Tarifa (Vejer)')

print('Tatajuba: the list')
check(cities['tatajuba']['status'] == 'soon', 'Tatajuba: coming soon')
s, w = rpc('hi8_waitlist', {'p_city': 'tatajuba', 'p_email': 'Lagoon@Example.com'})
check(s == 200 and w['already'] is False and w['plate'] == 1, 'an email joins the Tatajuba list, plate 1')
s, w = rpc('hi8_waitlist', {'p_city': 'tatajuba', 'p_email': 'lagoon@example.com'})
check(s == 200 and w['already'] is True, 'twice is once')
s, w = rpc('hi8_waitlist', {'p_city': 'tatajuba', 'p_key': j['key']})
check(s == 200 and sql("select count(*) from signups where city = 'tatajuba' and lower(email) = 'tar@example.com'") == '1', 'a signed-in rider joins with their key')
s, w = rpc('hi8_waitlist', {'p_city': 'tarifa', 'p_email': 'x@example.com'})
check(s == 400 and w['message'] == 'not_soon', 'an open region takes no list')
s, w = rpc('hi8_waitlist', {'p_city': 'tatajuba', 'p_email': 'nope'})
check(s == 400 and w['message'] == 'bad_email', 'a bad email is refused')

print('trips')
sql("insert into public.plans (slug, city, kind, title, place, blurb, price_from, trip) values ('test-trip', 'tarifa', 'kite', 'Kite week', 'Tarifa', 'A week of kite.', 690, true)")
s, all_ = rpc('hi8_plans', {})
t = [p for p in all_ if p['slug'] == 'test-trip']
check(len(t) == 1 and t[0]['trip'] is True, 'a trip comes back with trip = true, from every region')
check(all(p['trip'] is False for p in all_ if p['slug'] == 'mx-day-martorelles'), 'other plans are not trips')
s, r = rpc('hi8_plan_interest', {'p_plan': 'test-trip', 'p_email': 'trip@example.com', 'p_people': 2})
check(s == 200, "I'm in on a trip works like any plan")
sql("delete from public.plans where slug = 'test-trip'"); sql("delete from public.plan_leads where plan = 'test-trip'")

print(f'\nALL {ok} WHERE-NEXT CHECKS PASSED')
