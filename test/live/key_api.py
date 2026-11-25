# TEST ONLY. 0025 (P0-1, 2.31): nobody gets another rider's key by typing their email. A new email still gets a key
# at once; a known one gets no key (the site emails a sign-in link) in every one-step form; signing in for real
# removes the keys made by typing; the switch turns it off at once.
import base64, hashlib, hmac, json, os, subprocess, time, uuid, urllib.request, urllib.error

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
def rpc(fn, body, jwt=None):
    n_ip[0] += 1
    h = {'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': f'10.55.{n_ip[0] // 200}.{n_ip[0] % 200}'}
    if jwt: h['authorization'] = 'Bearer ' + jwt
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), headers=h, method='POST')
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
def jwt(claims, secret=b'test-secret-test-secret-test-secret-0123'):
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
    head, body = b({'alg': 'HS256', 'typ': 'JWT'}), b(claims)
    return (head + b'.' + body + b'.' + base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')).decode()

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.wind_alerts cascade; delete from auth.users;")
sql("insert into public.app_settings (key, value, public) values ('strict_keys', 'true', false) on conflict (key) do update set value = 'true'")

print('a new email')
st, r = rpc('hi8_join', {'p_email': 'ana@example.com', 'p_city': 'amsterdam'})
check(st == 200 and r.get('key') and not r.get('needs_link'), 'Ana joins for the first time: a key straight away (one step, as before)')
ana = r['key']
cid = sql("insert into crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email) values ('amsterdam','kite','wijk-aan-zee', hi8_today('amsterdam') + 2, '13:00','16:00','all',6,'cs','11:45','ana@example.com') returning id").split('\n')[0]
sql(f"insert into crew_members (crew_id, email, level, getting, seats) values ('{cid}', 'ana@example.com', 'regular', 'drive', 3)")
code = sql(f"select code from crews where id = '{cid}'")
rpc('hi8_set_pin', {'p_key': ana, 'p_code': code, 'p_lat': 52.499, 'p_lon': 4.584})

print('someone types her email')
st, r = rpc('hi8_join', {'p_email': 'ANA@example.com ', 'p_city': 'amsterdam'})
check(st == 200 and r.get('needs_link') is True and 'key' not in r, 'the join form: no key, needs_link (the site emails her a sign-in link)')
check(sql("select count(*) from rider_keys where email = 'ana@example.com'") == '1', '...and no new key was made')
st, r = rpc('hi8_quick_join', {'p_email': 'ana@example.com', 'p_name': 'Not Ana', 'p_code': code, 'p_level': 'regular'})
check(st == 400 and r.get('message') == 'needs_link' and 'sign-in link' in (r.get('hint') or ''), 'joining a crew from its link with her email: needs_link')
st, r = rpc('hi8_quick_start', {'p_email': 'ana@example.com', 'p_name': 'Not Ana', 'p_level': 'regular', 'p_sport': 'kite', 'p_spot': 'ijmuiden', 'p_day': sql("select (hi8_today('amsterdam') + 3)::text"), 'p_start': '12:00', 'p_end': '15:00', 'p_getting': 'own'})
check(st == 400 and r.get('message') == 'needs_link', f'starting a crew with her email: needs_link ({st} {r.get("message")})')
st, r = rpc('hi8_alert_signup', {'p_email': 'ana@example.com', 'p_city': 'amsterdam', 'p_sport': 'kite'})
check(st == 400 and r.get('message') == 'needs_link', f'turning on alerts with her email: needs_link ({st} {r.get("message")})')
check(sql("select count(*) from crew_members m join crews c on c.id = m.crew_id where c.code = '" + code + "'") == '1' and sql("select count(*) from rider_keys") == '1', 'nothing was joined, started or keyed on her behalf')
st, c = rpc('hi8_crew', {'p_code': code})
check('meet_lat' not in c and not c.get('me'), 'without her key, the crew page shows no pin and no "me"')

print('she signs in with the link')
uid = str(uuid.uuid4())
sql(f"insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ('{uid}', 'ana@example.com', now(), '{{\"provider\":\"email\"}}')")
st, r = rpc('hi8_claim', {'p_city': 'amsterdam'}, jwt=jwt({'sub': uid, 'role': 'authenticated', 'exp': int(time.time()) + 3600}))
check(st == 200 and r.get('key') and r['key'] != ana, 'the link: a new key for this phone')
check(sql("select string_agg(how, ',') from rider_keys where email = 'ana@example.com'") == 'email-link', 'the key made by just typing her email is gone; only the signed-in one is left')
st, c = rpc('hi8_crew', {'p_code': code, 'p_key': r['key']})
check(c.get('me') and c.get('meet_lat') == 52.499, 'with it she sees her crew and the pin')
st, c = rpc('hi8_crew', {'p_code': code, 'p_key': ana})
check(not c.get('me'), 'the old typed-email key no longer works for her crews')

print('the switch')
sql("update app_settings set value = 'false' where key = 'strict_keys'")
st, r = rpc('hi8_join', {'p_email': 'ana@example.com', 'p_city': 'amsterdam'})
check(st == 200 and r.get('key'), "strict_keys off: back to the old behaviour at once (the way back if sign-in emails fail)")
sql("update app_settings set value = 'true' where key = 'strict_keys'")
st, r = rpc('hi8_join', {'p_email': 'bo@example.com', 'p_city': 'amsterdam'})
check(st == 200 and r.get('key'), 'a second new rider: still one step')
st, r = rpc('hi8_join_v1', {'p_email': 'ana@example.com'})
check(st != 200, 'the old function kept for the way back cannot be called from the website')
print(f'\nALL {ok} KEY CHECKS PASSED')
