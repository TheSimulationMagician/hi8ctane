# Security: what someone with only the website's public key can and can't do (through PostgREST, like an attacker would).
# Needs the stack from README.md (Postgres on 5440, PostgREST on 3300, serve.mjs on 8801 in live mode).
import json, os, subprocess, sys, urllib.request, urllib.error, uuid

BASE = 'http://localhost:8801'
ok = 0
def check(c, what):
    global ok
    if not c: print('FAIL: ' + what); sys.exit(1)
    ok += 1; print('  ok ·', what)
def sql(q): return subprocess.check_output(['psql', '-h', os.environ.get('PGHOST', '127.0.0.1'), '-p', '5440', '-U', 'postgres', '-d', 'hi8', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', q]).decode().strip()
IP = [0]
def call(method, path, body=None, key='sb_publishable_test', headers=None):
    IP[0] += 1
    h = {'apikey': key, 'content-type': 'application/json', 'x-test-ip': '10.66.%d.%d' % (IP[0] // 250, IP[0] % 250)}
    h.update(headers or {})
    r = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(), headers=h, method=method)
    try:
        res = urllib.request.urlopen(r); t = res.read().decode(); return res.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        t = e.read().decode(); return e.code, (json.loads(t) if t.startswith('{') or t.startswith('[') else t)
def rpc(fn, args, **k): return call('POST', '/rest/v1/rpc/' + fn, args, **k)
def denied(s): return s in (401, 403, 404)

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.wallet_ledger, public.passes, public.rider_avatars cascade")
_, A = rpc('hi8_join', {'p_email': 'alice@example.com', 'p_city': 'amsterdam'})
_, B = rpc('hi8_join', {'p_email': 'bob@example.com', 'p_city': 'amsterdam'})
_, M = rpc('hi8_join', {'p_email': 'mallory@example.com', 'p_city': 'amsterdam'})
rpc('hi8_profile', {'p_key': A['key'], 'p_name': 'Alice'}); rpc('hi8_profile', {'p_key': B['key'], 'p_name': 'Bob'})
sql("update app_settings set value = 'true' where key = 'open_posting'")
s, crew = rpc('hi8_start_crew', {'p_key': A['key'], 'p_sport': 'kite', 'p_spot': 'zandvoort', 'p_day': sql("select (hi8_today('amsterdam') + 1)::text"), 'p_start': '10:00', 'p_levels': 'regular', 'p_getting': 'drive', 'p_seats': 3})
code = crew['code']
rpc('hi8_join_crew', {'p_key': B['key'], 'p_code': code, 'p_level': 'regular', 'p_getting': 'seat'})
rpc('hi8_send', {'p_key': A['key'], 'p_code': code, 'p_body': 'meet at the north car park'})
check(s == 200 and code, 'set up: Alice runs a crew, Bob rides in it, Mallory is a stranger with her own plate')

print('1. the tables themselves')
tables = sql("select string_agg(relname, ' ') from pg_class c join pg_namespace n on n.oid = c.relnamespace where nspname = 'public' and relkind = 'r'").split()
for t in tables:
    res = [call('GET', '/rest/v1/' + t + '?select=*&limit=1'), call('POST', '/rest/v1/' + t, {}), call('PATCH', '/rest/v1/' + t, {}), call('DELETE', '/rest/v1/' + t)]
    if not all(denied(st) or (isinstance(b, dict) and b.get('code') == '42501') for st, b in res): check(False, 'table %s is reachable: %s' % (t, [(st, b) for st, b in res]))
check(True, 'all %d tables: reading, adding, changing and deleting rows directly is refused (permission denied)' % len(tables))
check(sql("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where nspname = 'public' and relkind in ('r','p') and not relrowsecurity") == '0', 'row level security is on for every table')
check(sql("select count(*) from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')") == '0', 'the public roles hold no table permissions at all (belt and braces)')
check(sql("select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where nspname = 'public' and relkind = 'S' and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('anon', c.oid, 'UPDATE'))") == '0', 'no ID sequence is usable by the website (0018)')
check(sql("select count(*) from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where nspname = 'public' and array_to_string(defaclacl, ',') ~ '(^|,)(anon|authenticated)='") == '0', 'new tables, sequences and functions start closed to the website (0018)')
check(sql("select count(*) from (%s) x" % open(os.path.join(os.path.dirname(__file__), '../../supabase/security_check.sql')).read().split('-- Hi8ctane security check')[1].split('\n', 1)[1].rstrip().rstrip(';')) == '0', 'supabase/security_check.sql finds no problems')
check(sql("select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where nspname = 'public' and prosecdef and not exists (select 1 from unnest(proconfig) c where c like 'search_path=%')") == '0', 'every SECURITY DEFINER function pins its search_path (no hijacking through a fake table)')

print('2. functions only the server may call')
for fn, args in [('erase_email', {'p_email': 'alice@example.com'}), ('hi8_cartoon_start', {'p_key': A['key']}), ('hi8_cartoon_done', {'p_email': 'alice@example.com', 'p_path': str(uuid.uuid4()) + '.webp'}),
                 ('hi8_avatar_trash_take', {'p_n': 5}), ('hi8_avatar', {'p_email': 'alice@example.com'}), ('hi8_email', {'p_key': A['key']}), ('hi8_balance', {'p_email': 'alice@example.com'}),
                 ('hi8_seat_price', {'p_crew': sql("select id from crews where code = '%s'" % code), 'p_email': 'bob@example.com'}), ('hi8_key_owner', {'p_key': A['key']}), ('hi8_secret', {'p_name': 'resend_api_key'})]:
    st, _ = rpc(fn, args)
    if not denied(st): check(False, '%s is callable from the website (%d)' % (fn, st))
check(True, 'erase, wallet balance, secrets, emails by key, cartoon storage: not callable from the website')
money = sql("select string_agg(proname, ' ') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where nspname = 'public' and proname ~ '(topup|credit|stripe|payout|refund|webhook|approve|captain_set|admin)' and has_function_privilege('anon', p.oid, 'EXECUTE')")
check(money == '', 'no top-up, credit, refund, payout, Stripe webhook or approve-captain function is callable from the website ' + money)

print('3. a stranger (Mallory) against Alice and Bob')
st, out = rpc('hi8_crew', {'p_code': code, 'p_key': M['key']})
blob = json.dumps(out)
check(st == 200 and 'members' not in out and 'alice@' not in blob and 'bob@' not in blob and 'north car park' not in blob, "Mallory sees the crew card but no members, no emails, no chat")
st, out = rpc('hi8_messages', {'p_key': M['key'], 'p_code': code})
check(st != 200 or not out or 'north car park' not in json.dumps(out), "she can't read the crew chat")
st, _ = rpc('hi8_send', {'p_key': M['key'], 'p_code': code, 'p_body': 'spam'})
check(st != 200 and sql("select count(*) from crew_messages where body = 'spam'") == '0', "she can't post in it")
st, _ = rpc('hi8_settle', {'p_key': M['key'], 'p_code': code, 'p_cost': 499, 'p_link': 'https://paypal.me/mallory'})
check(st != 200 and sql("select count(*) from crew_members where pay_link like '%mallory%'") == '0', "she can't set herself up as the driver to be paid (or change the price)")
st, _ = rpc('hi8_paid', {'p_key': M['key'], 'p_code': code})
check(st != 200, "she can't mark seats paid")
for fn in ['hi8_leave_crew', 'hi8_checkin']:
    rpc(fn, {'p_key': M['key'], 'p_code': code})
check(sql("select count(*) from crew_members m join crews c on c.id = m.crew_id where code = '%s'" % code) == '2' and sql("select status from crews where code = '%s'" % code) == 'on', "leaving or checking in as herself doesn't touch Alice's or Bob's places, and the crew stays on")
st, out = rpc('hi8_me', {'p_key': str(uuid.uuid4())})
check(st != 200 or not out or 'alice' not in json.dumps(out), 'a made-up key gets nobody\'s data')
st, out = rpc('hi8_me', {'p_key': M['key']})
check('alice@' not in json.dumps(out) and 'bob@' not in json.dumps(out), "her own Me shows only her")

print('4. the public lists leak no emails')
for fn, args in [('hi8_crews', {'p_city': 'amsterdam'}), ('hi8_live', {'p_city': 'amsterdam'}), ('hi8_counts', {}), ('hi8_places', {}), ('hi8_plans', {'p_city': 'amsterdam'}), ('hi8_settings', {})]:
    st, out = rpc(fn, args); blob = json.dumps(out)
    if st != 200 or '@example.com' in blob: check(False, '%s: %d, %s' % (fn, st, '@example.com' in blob and 'shows an email'))
check(True, 'crews, live, counts, places, plans, settings: no emails anywhere')
st, out = rpc('hi8_settings', {})
check(not any(k for k in out if any(w in k for w in ('secret', 'key', 'token', 'password'))), 'settings hold no secrets (they live in Vault)')

print('5. tricks')
st, _ = rpc('hi8_start_crew', {'p_key': M['key'], 'p_sport': 'kite', 'p_spot': "zandvoort'; drop table crews; --", 'p_day': sql("select (hi8_today('amsterdam') + 1)::text"), 'p_start': '10:00', 'p_levels': 'regular', 'p_getting': 'own'})
check(st != 200 and sql("select count(*) from crews") == '1', 'SQL in a field is just text (no such spot), the table is fine')
# a name and a chat message carrying HTML: shown as text in the crew page, never run
XSS = '<img src=x onerror="window.__pwned=1">'
rpc('hi8_profile', {'p_key': B['key'], 'p_name': XSS})
rpc('hi8_send', {'p_key': B['key'], 'p_code': code, 'p_body': XSS + '<script>window.__pwned=2</script>'})
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    br = p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'), args=['--no-sandbox'])
    ctx = br.new_context(viewport={'width': 390, 'height': 844})
    ctx.add_init_script("localStorage.setItem('hi8.me', JSON.stringify(%s)); localStorage.setItem('hi8.city28', JSON.stringify('amsterdam'));" % json.dumps({'key': A['key'], 'city': 'amsterdam', 'plates': {'amsterdam': A.get('plate', 1)}}))
    pg = ctx.new_page(); pg.goto(BASE + '/?c=' + code); pg.wait_for_selector('#sheet.on'); pg.wait_for_timeout(2000)
    shown = pg.locator('#sheet').inner_text()
    pg.goto(BASE + '/?c=' + code + '#chat'); pg.wait_for_timeout(2500)
    check('<img src=x' in shown and pg.evaluate('window.__pwned') is None and pg.locator('img[src="x"]').count() == 0, 'a name or chat message with HTML in it shows as text and never runs (crew page and chat)')
    br.close()
st, _ = call('POST', '/rest/v1/rpc/hi8_settings', {}, key='not-the-key')
check(denied(st), 'without the publishable key: nothing')
st, _ = rpc('hi8_crew', {'p_code': code, 'p_key': B['key']}, headers={'authorization': 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.forged'})
check(denied(st) or st == 400, 'a forged service-role token is rejected')
hits = 0
for i in range(25):
    s2, _ = call('POST', '/rest/v1/rpc/hi8_join', {'p_email': 'spam%d@example.com' % i, 'p_city': 'amsterdam'}, headers={'x-test-ip': '10.99.0.1'})
    hits += s2 == 200
check(hits == 20, 'sign-up spam from one address stops after 20 in 10 minutes')
print(f'\nALL {ok} SECURITY CHECKS PASSED')
