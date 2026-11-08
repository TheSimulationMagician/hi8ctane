# TEST ONLY. The crews API (0003) through PostgREST, as the website calls it.
# Needs the same setup as e2e.py (Postgres with 0001-0003, PostgREST, serve.mjs in live mode).
import json, os, subprocess, datetime, urllib.request, urllib.error

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
def rpc(fn, body, ip='10.1.1.1'):
    h = {'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': ip}
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), headers=h, method='POST')
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
def must(fn, body):
    s, b = rpc(fn, body)
    if s != 200: raise SystemExit(f'FAIL: {fn} {s} {b}')
    return b
def err(fn, body):
    s, b = rpc(fn, body)
    return b.get('message') if s >= 400 else None

sql("truncate public.signups, public.night_rsvps, public.rider_keys, public.partner_leads, public.rate_hits, public.crews, public.crew_members, public.crew_messages, public.city_requests cascade")
sql("update public.app_settings set value = 'false' where key = 'open_posting'")  # these checks are for captains-only mode (0005 switches open posting on)
tomorrow = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
yesterday = (datetime.date.today() - datetime.timedelta(days=1)).isoformat()

print('places')
pl = must('hi8_places', {})
check(len(pl['spots']) >= 20 and any(s['slug'] == 'wijk-aan-zee' for s in pl['spots']) and len(pl['hubs']) >= 7, 'spots and hubs for the forecast and the form')

print('people')
cap = must('hi8_join', {'p_email': 'cap@example.com', 'p_city': 'amsterdam'})['key']
must('hi8_profile', {'p_key': cap, 'p_name': 'Marta', 'p_sports': ['kite', 'wing'], 'p_levels': {'kite': 'ripper'}})
r1 = must('hi8_join', {'p_email': 'r1@example.com', 'p_city': 'amsterdam'})['key']
must('hi8_profile', {'p_key': r1, 'p_name': 'Sam', 'p_sports': ['kite']})
r2 = must('hi8_join', {'p_email': 'r2@example.com', 'p_city': 'amsterdam'})['key']
r3 = must('hi8_join', {'p_email': 'r3@example.com', 'p_city': 'amsterdam'})['key']
crew_args = {'p_sport': 'kite', 'p_spot': 'wijk-aan-zee', 'p_day': tomorrow, 'p_start': '13:30', 'p_end': '16:30', 'p_levels': 'all',
             'p_max': 4, 'p_meet_hub': 'cs', 'p_meet_time': '12:40', 'p_meet_note': 'Kite beach, access 3', 'p_level': 'ripper', 'p_getting': 'drive', 'p_seats': 2}
check(err('hi8_start_crew', dict(crew_args, p_key=cap)) == 'not_captain', 'not approved yet: can\'t start a crew')
sql("select public.approve_captain('cap@example.com', 'amsterdam')")
check(err('hi8_start_crew', dict(crew_args, p_key=r1)) == 'not_captain', 'a rider who isn\'t a captain can\'t start one')

print('start')
check(err('hi8_start_crew', dict(crew_args, p_key=cap, p_day=yesterday)) == 'bad_day', 'no crews in the past')
check(err('hi8_start_crew', dict(crew_args, p_key=cap, p_sport='mtb')) == 'wrong_sport_for_spot', 'sport must fit the spot')
check(err('hi8_start_crew', dict(crew_args, p_key=cap, p_start='13:30', p_end='12:00')) == 'bad_time', 'ends after it starts')
c = must('hi8_start_crew', dict(crew_args, p_key=cap))
code = c['code']
check(len(code) == 6 and c['going'] == 1 and c['host'] == 'Marta' and c['host_is_me'] and c['meet_note'] == 'Kite beach, access 3', 'captain starts a crew and is its first member')
check(c['seats_free'] == 2 and c['drivers'] == 1, 'the captain drives with 2 seats')

print('public view')
lst = must('hi8_crews', {'p_city': 'amsterdam'})
card = [x for x in lst if x['code'] == code][0]
check(card['going'] == 1 and card['spot_name'] == 'Wijk aan Zee' and card['initials'] == ['MA'] and 'meet_note' not in card, 'listed for everyone: counts and initials, no meeting note')
check('@' not in json.dumps(lst), 'no emails in the public list')
pub = must('hi8_crew', {'p_code': code})
check('members' not in pub and 'meet_note' not in pub, 'crew page without a key: no names, no meeting note')
pub2 = must('hi8_crew', {'p_code': code, 'p_key': r1})
check('members' not in pub2 and pub2['host_is_me'] is False, 'signed up but not in it: still no names')

print('join')
host_mid = c['members'][0]['member_id']
j = must('hi8_join_crew', {'p_key': r1, 'p_code': code, 'p_level': 'rookie', 'p_getting': 'seat', 'p_car_with': host_mid})
check(j['going'] == 2 and j['seats_free'] == 1 and j['me']['car_with'] == host_mid, 'rider joins with a seat in the captain\'s car')
check([m['name'] for m in j['members']] == ['Marta', 'Sam'] and '@' not in json.dumps(j), 'members see each other by rider name, never email')
j2 = must('hi8_join_crew', {'p_key': r2, 'p_code': code, 'p_level': 'regular', 'p_getting': 'seat', 'p_car_with': host_mid})
check(j2['seats_free'] == 0, 'second passenger: car full')
check(err('hi8_join_crew', {'p_key': r3, 'p_code': code, 'p_level': 'regular', 'p_getting': 'seat', 'p_car_with': host_mid}) == 'car_full', 'a third passenger can\'t squeeze in')
must('hi8_join_crew', {'p_key': r3, 'p_code': code, 'p_level': 'regular', 'p_getting': 'own'})
check(err('hi8_join_crew', {'p_key': must('hi8_join', {'p_email': 'r4@example.com'})['key'], 'p_code': code, 'p_level': 'regular'}) == 'crew_full', 'max 4: the fifth rider is told it\'s full')
must('hi8_join_crew', {'p_key': r2, 'p_code': code, 'p_level': 'regular', 'p_getting': 'own'})
check(must('hi8_crew', {'p_code': code})['seats_free'] == 1, 'changing to "my own way" frees the seat')

print('levels')
c2 = must('hi8_start_crew', dict(crew_args, p_key=cap, p_levels='regular', p_getting='own', p_seats=0, p_force=True))  # same slot on purpose (0005 would warn)
check(err('hi8_join_crew', {'p_key': r1, 'p_code': c2['code'], 'p_level': 'rookie'}) == 'level', 'regulars-only crew turns rookies away')

print('chat')
check(err('hi8_messages', {'p_key': must('hi8_join', {'p_email': 'r5@example.com'})['key'], 'p_code': code}) == 'not_in_crew', 'not in the crew: no chat')
must('hi8_send', {'p_key': r1, 'p_code': code, 'p_body': 'Bringing a pump <b>and</b> a 9'})
msgs = must('hi8_messages', {'p_key': cap, 'p_code': code})
check([m['kind'] for m in msgs] == ['join', 'join', 'join', 'msg'] and msgs[-1]['name'] == 'Sam' and msgs[-1]['body'] == 'Bringing a pump <b>and</b> a 9', 'chat: join notices, then the message as typed')
check(must('hi8_messages', {'p_key': cap, 'p_code': code, 'p_after': msgs[-1]['id']}) == [], 'polling after the last id: nothing new')
check(err('hi8_send', {'p_key': r1, 'p_code': code, 'p_body': '   '}) == 'empty', 'empty message refused')

print('leave and call off')
lv = must('hi8_leave_crew', {'p_key': r1, 'p_code': code})
check(lv['going'] == 3 and 'members' not in lv, 'rider leaves; no longer sees the members')
off = must('hi8_leave_crew', {'p_key': cap, 'p_code': code, 'p_reason': 'Wind dropped'})
check(off['status'] == 'off' and off['off_reason'] == 'Wind dropped', 'captain leaving calls it off, with the reason')
check(err('hi8_join_crew', {'p_key': r1, 'p_code': code, 'p_level': 'regular'}) == 'crew_off', 'can\'t join a crew that\'s off')
check(must('hi8_messages', {'p_key': r3, 'p_code': code})[-1]['body'] == 'Called off: Wind dropped', 'the crew is told in its chat')

print('me')
me = must('hi8_me', {'p_key': cap})
check(me['name'] == 'Marta' and me['home'] == 'amsterdam' and me['cities'][0]['captain_approved'] and len(me['crews']) == 2, 'Me: name, captain, my crews')
check(must('hi8_city_request', {'p_key': r1, 'p_city': 'Utrecht', 'p_captain': True})['asking'] == 1, '"Other city": Utrecht saved')
cnt = must('hi8_counts', {})
check(cnt['cities']['amsterdam']['sports'].get('kite') == 2 and cnt['cities']['amsterdam']['crews'] == 1 and cnt['cities']['amsterdam']['captains_ok'] == 1, 'counts: riders per sport, crews coming up, captains')

print('locked')
for t in ['crews', 'crew_members', 'crew_messages', 'spots', 'hubs', 'city_requests']:
    req = urllib.request.Request(f'{BASE}/rest/v1/{t}?select=*', headers={'apikey': 'sb_publishable_test'})
    try: urllib.request.urlopen(req); code_ = 200
    except urllib.error.HTTPError as e: code_ = e.code
    check(code_ in (401, 403), f'table {t} closed to the website')
for fn in ['approve_captain', 'hi8_name', 'hi8_crew_card', 'hi8_today']:
    s, b = rpc(fn, {})
    check(s in (401, 403, 404) or (b and b.get('code') == '42501'), f'{fn} cannot be called from the website')

print('erase')
e = json.loads(sql("select public.erase_email('cap@example.com')"))
check(e['crew_memberships_deleted'] == 2 and sql(f"select status from crews where code = '{c2['code']}'") == 'off', 'erasing a captain calls their crews off')
check(sql("select count(*) from crew_messages where email = 'cap@example.com'") == '0', 'their messages are gone')

print(f'\nALL {ok} CREWS CHECKS PASSED')
