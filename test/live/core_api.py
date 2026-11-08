# TEST ONLY. 0004 (2.7.3) through the real API: captains in any city, one-go join from a crew link,
# settling up with payment links, the email outbox and its triggers, sending through Resend (pg_net stubbed),
# error reports, and that none of it is readable from the website.
import json, os, subprocess, urllib.request, datetime, uuid

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
def rpc(fn, body, ip='10.4.4.4'):
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST',
                                 headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': ip})
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

# pg_net stand-in: records what would have gone to Resend
sql("create schema if not exists net; create table if not exists net.sent (id bigint generated always as identity, url text, body jsonb, headers jsonb);"
    "create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000) returns bigint language sql as $$ insert into net.sent (url, body, headers) values (url, body, headers) returning id $$;")
sql("truncate public.signups, public.night_rsvps, public.rider_keys, public.crews, public.crew_members, public.crew_messages, public.rate_hits, public.outbox, public.client_errors, net.sent cascade; delete from public.app_secrets where name = 'resend_api_key'")
sql("update public.app_settings set value = 'false' where key = 'open_posting'")  # these checks are for captains-only mode (0005 switches open posting on)
tmrw = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()

print('captains: approved once, any city')
s, j = rpc('hi8_join', {'p_email': 'Cap@Example.com', 'p_city': 'barcelona'}); cap = j['key']
rpc('hi8_profile', {'p_key': cap, 'p_name': 'Paco'})
try: sql("select public.approve_captain('nobody@example.com')"); check(False, 'no sign-up: refused')
except SystemExit as e: check('no_signup' in str(e), 'approving an email that never signed up says so')
check(json.loads(sql("select public.approve_captain('cap@example.com')"))['rows'] == 1, 'approve_captain(email) without a city works')
s, c = rpc('hi8_start_crew', {'p_key': cap, 'p_sport': 'kite', 'p_spot': 'wijk-aan-zee', 'p_day': tmrw, 'p_start': '13:30', 'p_end': '16:30', 'p_max': 6,
                              'p_meet_hub': 'west', 'p_meet_time': '12:40', 'p_meet_note': 'Kite beach, access 3', 'p_getting': 'drive', 'p_seats': 3})
check(s == 200 and c['code'], 'approved in Barcelona, starts a crew in Amsterdam')
code = c['code']
check(sql("select plate from signups where email = 'cap@example.com' and city = 'amsterdam'") == '1', 'and gets an Amsterdam plate with it')
s, j = rpc('hi8_join', {'p_email': 'nocap@example.com'})
s, b = rpc('hi8_start_crew', {'p_key': j['key'], 'p_sport': 'kite', 'p_spot': 'wijk-aan-zee', 'p_day': tmrw, 'p_start': '13:30'})
check(s in (401, 403) and b['message'] == 'not_captain', 'not approved: still refused')

print('one go from a crew link')
s, b = rpc('hi8_quick_join', {'p_email': 'sam@example.com', 'p_name': '', 'p_code': code, 'p_level': 'rookie'})
check(s == 400 and b['message'] == 'name_required', 'a rider name is required')
s, q = rpc('hi8_quick_join', {'p_email': 'Sam@Example.com', 'p_name': 'Sam', 'p_code': code, 'p_level': 'rookie', 'p_getting': 'seat', 'p_ref': 'kaiwave'})
check(s == 200 and q['key'] and q['me'] and q['plate'] == 3, 'email + name + level + seat: signed up, plate #3, in the crew')
sam = q['key']
check(sql("select first_name || '|' || ref from signups where email = 'sam@example.com'") == 'Sam|kaiwave', 'saved with the name and the ref code')
mem = {m['name']: m for m in q['members']}
check(mem['Sam']['car_with'] == mem['Paco']['member_id'], "any car: Sam rides in Paco's car")
s, q2 = rpc('hi8_quick_join', {'p_email': 'sam@example.com', 'p_name': 'Samuel', 'p_code': code, 'p_level': 'regular', 'p_getting': 'seat'})
check(s == 200 and sql("select first_name from signups where email = 'sam@example.com'") == 'Sam' and q2['going'] == 2, 'same email again: keeps the name, updates the level, not counted twice')
s, b = rpc('hi8_quick_join', {'p_email': 'bad', 'p_name': 'X', 'p_code': code, 'p_level': 'rookie'})
check(s == 400 and b['message'] == 'bad_email', 'bad email: refused')
s, q = rpc('hi8_quick_join', {'p_email': 'noor@example.com', 'p_name': 'Noor', 'p_code': code, 'p_level': 'regular', 'p_getting': 'own'})
noor = q['key']

print('settling up')
s, b = rpc('hi8_settle', {'p_key': sam, 'p_code': code, 'p_cost': 20})
check(s in (401, 403) and b['message'] == 'not_driver', 'only drivers add a cost')
s, b = rpc('hi8_settle', {'p_key': cap, 'p_code': code, 'p_cost': 18, 'p_link': 'https://evil.example.com/pay'})
check(s == 400 and b['message'] == 'bad_link', 'a link that is not a known payment service: refused')
s, b = rpc('hi8_settle', {'p_key': cap, 'p_code': code, 'p_cost': 900})
check(s == 400 and b['message'] == 'bad_cost', 'more than €500: refused')
s, c = rpc('hi8_settle', {'p_key': cap, 'p_code': code, 'p_cost': 18, 'p_link': 'https://tikkie.me/pay/Hi8/abc123'})
paco = {m['name']: m for m in c['members']}['Paco']
check(s == 200 and paco['trip_cost'] == 18 and paco['share'] == 9 and paco['pay_link'].startswith('https://tikkie.me'), 'Tikkie link + €18: €9 each for the two in the car')
s, sc = rpc('hi8_crew', {'p_code': code, 'p_key': sam})
check({m['name']: m for m in sc['members']}['Paco']['pay_link'], 'the rider sees the pay link')
s, pub = rpc('hi8_crew', {'p_code': code})
check('pay_link' not in json.dumps(pub) and 'members' not in pub, 'outside the crew: no pay link, no members')
check("€9.00 each" in sql(f"select body from crew_messages m join crews c on c.id = m.crew_id where c.code = '{code}' and kind = 'edit' order by m.id desc limit 1"), 'the chat says what each pays')
check(sql("select count(*) from outbox where kind = 'pay' and to_email = 'sam@example.com'") == '1', 'Sam gets a payment email')
s, c = rpc('hi8_paid', {'p_key': sam, 'p_code': code})
check(s == 200 and c['me']['paid'] is True, 'Sam ticks paid')
s, c = rpc('hi8_crew', {'p_code': code, 'p_key': cap})
check({m['name']: m for m in c['members']}['Sam']['paid'] is True, 'the driver sees the tick')
s, b = rpc('hi8_paid', {'p_key': noor, 'p_code': code})
check(s == 400 and b['message'] == 'no_ride', "Noor goes her own way: nothing to pay")
rpc('hi8_settle', {'p_key': cap, 'p_code': code, 'p_cost': 18, 'p_link': 'https://tikkie.me/pay/Hi8/abc123'})
check(sql("select count(*) from outbox where kind = 'pay' and to_email = 'sam@example.com'") == '1', 'saving the same cost again sends no second email')

print('emails')
check(sql("select count(*) from outbox where kind = 'welcome'") == '4', 'a welcome for each new rider (and only one per email)')
check(sql("select subject from outbox where kind = 'welcome' and to_email = 'sam@example.com'") == 'Your founding plate: #003 in Amsterdam', 'the welcome has the plate')
check(sql("select count(*) from outbox where kind = 'joined' and to_email = 'cap@example.com'") == '2', 'the captain hears about each rider who joins')
check(sql("select count(*) from outbox where kind = 'in'") == '2', 'each rider gets "you\'re in" with the link')
check('/?c=' + code in sql("select body from outbox where kind = 'in' and to_email = 'noor@example.com'"), 'with the crew link')
rpc('hi8_send', {'p_key': sam, 'p_code': code, 'p_body': 'Bringing a pump'})
rpc('hi8_send', {'p_key': sam, 'p_code': code, 'p_body': 'And snacks'})
check(sql("select count(*) from outbox where kind = 'chat'") == '2', 'chat: the other two get one email, not one per message')
rpc('hi8_leave_crew', {'p_key': noor, 'p_code': code})
check(sql("select count(*) from outbox where kind = 'left' and to_email = 'cap@example.com'") == '1', 'the captain hears when someone leaves')
check(json.loads(sql("select public.hi8_queue_reminders()")) == 2, 'reminders for tomorrow: the captain and Sam')
sql("select public.hi8_queue_reminders()")
check(sql("select count(*) from outbox where kind = 'remind'") == '2', 'running it twice sends no doubles')
rpc('hi8_leave_crew', {'p_key': cap, 'p_code': code, 'p_reason': 'Wind dropped'})
check('Wind dropped' in sql("select body from outbox where kind = 'off' and to_email = 'sam@example.com'"), 'called off: Sam gets the reason')
check(sql("select count(*) from outbox where kind = 'off' and to_email = 'cap@example.com'") == '0', 'not the captain who called it off')

print('sending through Resend')
check(sql("select public.hi8_mail_flush()") == '0' and sql("select count(*) from net.sent") == '0', 'no Resend key yet: nothing is sent, everything waits')
sql("insert into app_secrets (name, value) values ('resend_api_key', 're_test') on conflict (name) do update set value = excluded.value")
n = int(sql("select public.hi8_mail_flush()"))
check(n == int(sql("select count(*) from outbox")) and n == int(sql("select count(*) from net.sent")), f'with the key: all {n} go out')
sent = json.loads(sql("select json_build_object('url', url, 'body', body, 'auth', headers->>'Authorization') from net.sent order by id limit 1"))
check(sent['url'] == 'https://api.resend.com/emails' and sent['auth'] == 'Bearer re_test' and sent['body']['from'] == 'Hi8ctane <crews@hi8ctane.com>', 'to Resend, with the key, from crews@hi8ctane.com')
check(sql("select public.hi8_mail_flush()") == '0', 'nothing is sent twice')
check(sql("select count(*) from outbox where sent_at is null") == '0', 'the outbox shows them as sent')

print('errors, privacy, access')
s, _ = rpc('hi8_log_error', {'p_screen': 'B27-Crew', 'p_message': 'TypeError: x is undefined', 'p_ua': 'test'}, ip='9.1.1.1')
check(s in (200, 204) and sql("select count(*) from client_errors") == '1', 'the site can report an error')
codes = [rpc('hi8_log_error', {'p_screen': 'x', 'p_message': 'y'}, ip='9.1.1.2')[0] for _ in range(21)]
check(codes[-1] == 429, 'and can\'t flood the error log')
for t in ['outbox', 'client_errors']:
    req = urllib.request.Request(f'{BASE}/rest/v1/{t}?select=*', headers={'apikey': 'sb_publishable_test'})
    try: urllib.request.urlopen(req); code_ = 200
    except urllib.error.HTTPError as e: code_ = e.code
    check(code_ in (401, 403), f'{t} is closed to the website')
for fn in ['hi8_mail_flush', 'hi8_queue_reminders', 'hi8_mail', 'hi8_secret', 'approve_captain']:
    s, b = rpc(fn, {})
    check(s in (401, 403, 404) or (b and b.get('code') == '42501'), f'{fn} cannot be called from the website')
erased = json.loads(sql("select public.erase_email('sam@example.com')"))
check(erased['emails_deleted'] >= 1 and sql("select count(*) from outbox where to_email = 'sam@example.com'") == '0', 'erase_email also removes their emails')

print(f'\nALL {ok} CORE-LOOP CHECKS PASSED')
