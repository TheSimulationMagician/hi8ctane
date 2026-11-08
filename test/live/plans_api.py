# TEST ONLY. 0006 (2.9) through the real API: plans you can sign up for, the ride fee setting, the
# Martorelles MX spot, who sees what, and erasing a rider.
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
def rpc(fn, body, ip='10.6.6.6'):
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

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.outbox, public.plan_leads cascade")
sql("update public.plans set active = true")
in5 = (datetime.date.today() + datetime.timedelta(days=5)).isoformat()

print('the fee and the new spot')
s, st = rpc('hi8_settings', {})
check(s == 200 and st['ride_fee_pct'] == 15 and st['fee_live'] is False, 'the ride fee is 15% and not charged (pilot)')
s, pl = rpc('hi8_places', {})
m = [x for x in pl['spots'] if x['slug'] == 'martorelles-mx']
check(m and m[0]['sports'] == ['mx'] and m[0]['maps'] == 'Moto Club Martorelles' and 'Saturday' in m[0]['note'], 'Moto Club Martorelles is an MX spot with its opening days')

print('plans')
s, P = rpc('hi8_plans', {'p_city': 'barcelona'})
by = {p['slug']: p for p in P}
check(s == 200 and list(by)[:3] == ['mx-day-martorelles', 'bcp-cable', 'olimpic-cable'], 'three plans in Barcelona, in order')
mx = by['mx-day-martorelles']
check(mx['spot'] == 'martorelles-mx' and mx['price_from'] in (25, 180) and 'insurance' in mx['price_note'] and mx['interested'] == 0 and mx['mine'] is None, 'the MX day: spot, price, nobody in yet')
check(by['bcp-cable']['price_from'] is None and 'ask' in by['bcp-cable']['price_note'].lower(), 'no made-up price where the park publishes none')
s, A = rpc('hi8_plans', {'p_city': 'amsterdam'})
check(s == 200 and A == [], 'no plans in Amsterdam yet')
check(get('plans?select=slug') in (401, 403, 404) and get('plan_leads?select=email') in (401, 403, 404), 'the tables themselves are closed')

print("I'm in")
s, b = rpc('hi8_plan_interest', {'p_plan': 'mx-day-martorelles', 'p_email': 'bad'})
check(s == 400 and b['message'] == 'bad_email', 'a bad email is refused')
s, b = rpc('hi8_plan_interest', {'p_plan': 'nope', 'p_email': 'a@example.com'})
check(s == 400 and b['message'] == 'no_plan', 'an unknown plan is refused')
s, b = rpc('hi8_plan_interest', {'p_plan': 'mx-day-martorelles', 'p_email': 'a@example.com', 'p_day': '2001-01-01'})
check(s == 400 and b['message'] == 'bad_day', 'a day in the past is refused')
s, b = rpc('hi8_plan_interest', {'p_plan': 'mx-day-martorelles', 'p_email': 'a@example.com', 'p_people': 40})
check(s == 400 and b['message'] == 'bad_people', 'more than 12 people is refused')
s, j = rpc('hi8_plan_interest', {'p_plan': 'mx-day-martorelles', 'p_email': 'Pau@Example.com', 'p_day': in5, 'p_people': 2, 'p_note': 'size M, 1.80 m'})
check(s == 200 and j['ok'] and j['key'] and j['plate'] and j['interested'] == 1, 'Pau is in with an email: signed up with a plate, 1 in')
pau = j['key']
check(sql("select email || '|' || people || '|' || day from plan_leads") == f'pau@example.com|2|{in5}', 'the lead has the day and the people, email in lower case')
check(sql("select count(*) from outbox where kind = 'plan_lead' and to_email = 'hello@hi8ctane.com'") == '1', 'the team gets an email about it')
s, j = rpc('hi8_plan_interest', {'p_plan': 'mx-day-martorelles', 'p_key': pau, 'p_people': 3})
check(s == 200 and j['interested'] == 1 and sql("select people from plan_leads") == '3', 'again: updated, not counted twice')
check(sql("select count(*) from outbox where kind = 'plan_lead'") == '1', 'and no second email to the team')
s, j = rpc('hi8_plan_interest', {'p_plan': 'mx-day-martorelles', 'p_email': 'joan@example.com'}, ip='10.6.6.7')
check(s == 200 and j['interested'] == 2, 'Joan is in too: 2')
s, P = rpc('hi8_plans', {'p_city': 'barcelona', 'p_key': pau})
mx = [p for p in P if p['slug'] == 'mx-day-martorelles'][0]
check(mx['interested'] == 2 and mx['mine'] == {'day': None, 'people': 3}, 'Pau sees the count and his own answer')
check('pau@' not in json.dumps(P) and 'joan@' not in json.dumps(P), 'no emails in what the website gets')
s, P = rpc('hi8_plans', {'p_city': 'barcelona'})
check([p for p in P if p['slug'] == 'mx-day-martorelles'][0]['mine'] is None, 'without a key: nobody\'s answer')
s, b = rpc('hi8_plan_interest', {'p_plan': 'bcp-cable', 'p_key': '00000000-0000-0000-0000-000000000000'})
check(s in (401, 403) and b['message'] == 'unknown_key', 'an unknown key is refused')
s, j = rpc('hi8_plan_leave', {'p_key': pau, 'p_plan': 'mx-day-martorelles'})
check(s == 200 and j['interested'] == 1, 'Pau is out: 1 left')
sql("update public.plans set active = false where slug = 'olimpic-cable'")
s, P = rpc('hi8_plans', {'p_city': 'barcelona'})
check(all(p['slug'] != 'olimpic-cable' for p in P), 'a plan switched off disappears')
s, b = rpc('hi8_plan_interest', {'p_plan': 'olimpic-cable', 'p_key': pau})
check(s == 400 and b['message'] == 'no_plan', 'and can\'t be signed up for')
sql("update public.plans set active = true")

print('limits and erasing')
for i in range(25):
    s, b = rpc('hi8_plan_interest', {'p_plan': 'bcp-cable', 'p_key': pau}, ip='10.6.6.99')
check(s == 429, 'too many tries from one place: slow down')
rpc('hi8_plan_interest', {'p_plan': 'bcp-cable', 'p_key': pau}, ip='10.6.6.8')
r = json.loads(sql("select public.erase_email('pau@example.com')"))
check(r['plan_leads_deleted'] == 1 and sql("select count(*) from plan_leads where email = 'pau@example.com'") == '0', 'erasing Pau removes his plan answers')

print(f'\nALL {ok} PLAN CHECKS PASSED')
