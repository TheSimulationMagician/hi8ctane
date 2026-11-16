# TEST ONLY. 0014 (2.20) through the real API: who's looking now and today, per region, and what stays closed.
import json, os, subprocess, urllib.request, uuid

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
def get(path):
    req = urllib.request.Request(f'{BASE}/rest/v1/{path}', headers={'apikey': 'sb_publishable_test'})
    try:
        with urllib.request.urlopen(req) as r: return r.status
    except urllib.error.HTTPError as e: return e.code

sql("truncate public.looks, public.looks_daily, public.rate_hits")
a, b, c = (str(uuid.uuid4()) for _ in range(3))
print("who's looking")
s, r = rpc('hi8_look', {'p_visitor': a, 'p_city': 'amsterdam'})
check(s == 200 and r == {'now': 1, 'today': 1}, 'the first visitor: 1 now, 1 today')
s, r = rpc('hi8_look', {'p_visitor': a, 'p_city': 'amsterdam'})
check(r == {'now': 1, 'today': 1}, 'the same visitor again a minute later is still one')
rpc('hi8_look', {'p_visitor': b, 'p_city': 'amsterdam'}, ip='10.7.7.8')
s, r = rpc('hi8_look', {'p_visitor': c, 'p_city': 'barcelona'}, ip='10.7.7.9')
check(r == {'now': 1, 'today': 1}, 'regions are counted apart')
sql(f"update public.looks set last_seen = now() - interval '20 minutes' where visitor = '{b}'")
s, r = rpc('hi8_look', {'p_visitor': a, 'p_city': 'amsterdam'})
check(r == {'now': 1, 'today': 2}, 'gone for 20 minutes: not looking now, still counted today')
check(sql("select visitors from public.looks_daily where city = 'amsterdam'") == '2' and sql("select visitors from public.hi8_looks_report where city = 'amsterdam'") == '2', 'the daily total and the report say 2')
s, r = rpc('hi8_look', {'p_visitor': a, 'p_city': 'atlantis'})
check(s >= 400, 'an unknown region is refused')
print('closed')
check(get('looks?select=visitor') in (401, 403, 404) and get('looks_daily?select=day') in (401, 403, 404) and get('hi8_looks_report?select=day') in (401, 403, 404), 'the tables and the report are closed to the public')
print('\nALL %d LOOK CHECKS PASSED' % ok)
