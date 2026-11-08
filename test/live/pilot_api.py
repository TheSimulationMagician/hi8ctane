# TEST ONLY. 0005 (2.8, the Barcelona pilot) through the real API: open posting and its switch, rookie crews
# for captains only, "coming soon" sports, the duplicate warning, starting a crew and signing up in one go,
# check-ins and live reports, the live map feed, Bizum, alerts with their stop link, and what stays private.
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
def rpc(fn, body, ip='10.5.5.5'):
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

sql("truncate public.signups, public.night_rsvps, public.rider_keys, public.crews, public.crew_members, public.crew_messages, public.rate_hits, public.outbox, public.spot_reports, public.crew_alerts cascade")
sql("update public.app_settings set value = 'true' where key = 'open_posting'")
tmrw = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()
in3 = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()

print('settings and places')
s, st = rpc('hi8_settings', {})
check(s == 200 and st['open_posting'] is True and st['pilot_city'] == 'barcelona' and st['live_sports'] == ['kite', 'mtb', 'mx'] and 'surf' in st['soon_sports'], 'the website reads open posting, the pilot city and the live sports')
s, pl = rpc('hi8_places', {})
bcn = {x['slug']: x for x in pl['spots'] if x['city'] == 'barcelona'}
check(all(k in bcn for k in ('castelldefels', 'sant-pere-pescador', 'trabucador', 'riumar', 'collserola', 'garraf-park', 'sant-llorenc', 'roccos-ranch', 'vallgorguina-mx', 'bellpuig-mx')),
      'Barcelona has kite, MTB and MX spots')
check(bcn['trabucador']['lake'] is True and bcn['castelldefels']['face'] == 160 and bcn['vallgorguina-mx']['maps'] == 'ParcMotor Vallgorguina', 'lagoon, beach direction and directions are right')
check(sum(1 for x in pl['spots'] if x['city'] == 'barcelona' and 'mx' in x['sports']) == 3, 'three MX tracks')
check(any(h['slug'] == 'zona-uni' for h in pl['hubs']), 'Zona Universitària is a meeting point')

print('anyone with a plate starts a crew')
s, j = rpc('hi8_join', {'p_email': 'Kai@Example.com', 'p_city': 'barcelona'}); kai = j['key']
rpc('hi8_profile', {'p_key': kai, 'p_name': 'Kai'})
args = {'p_sport': 'kite', 'p_spot': 'castelldefels', 'p_day': tmrw, 'p_start': '12:00', 'p_end': '16:00', 'p_meet_hub': 'sants', 'p_meet_time': '11:15',
        'p_getting': 'drive', 'p_seats': 3, 'p_note': 'SW 18 kt, bring a 9'}
s, b = rpc('hi8_start_crew', dict(args, p_key=kai, p_levels='all'))
check(s in (401, 403) and b['message'] == 'captains_only', 'not a captain: no crews for rookies')
s, b = rpc('hi8_start_crew', dict(args, p_key=kai, p_sport='wing'))
check(s == 400 and b['message'] == 'sport_soon', 'wing is coming soon: not yet')
sql("update public.app_settings set value = 'false' where key = 'open_posting'")
s, b = rpc('hi8_start_crew', dict(args, p_key=kai))
check(s in (401, 403) and b['message'] == 'not_captain', 'open posting off: captains only again')
sql("update public.app_settings set value = 'true' where key = 'open_posting'")
s, c = rpc('hi8_start_crew', dict(args, p_key=kai))
check(s == 200 and c['code'] and c['levels'] == 'regular' and c['host'] == 'Kai' and c['going'] == 1, 'open posting on: Kai posts a crew for riders who ride on their own')
code = c['code']
check(c['me']['getting'] == 'drive' and c['seats_free'] == 3, 'driving, 3 seats free')

print('the same crew twice')
s, b = rpc('hi8_start_crew', dict(args, p_key=kai, p_start='13:00'))
check(s == 400 and b['message'] == 'duplicate' and b['details'] == code and 'Castelldefels' in b['hint'], 'a crew an hour later at the same spot: warned, with the code of the one that exists')
s, c2 = rpc('hi8_start_crew', dict(args, p_key=kai, p_start='13:00', p_force=True))
check(s == 200 and c2['code'] != code, 'posted anyway when they say so')
s, c3 = rpc('hi8_start_crew', dict(args, p_key=kai, p_spot='sant-pere-pescador'))
check(s == 200, 'another spot the same day: no warning')

print('start a crew and sign up in one go')
n0 = sql("select count(*) from signups")
s, b = rpc('hi8_quick_start', dict(args, p_email='lu@example.com', p_name='', p_spot='collserola', p_sport='mtb'))
check(s == 400 and b['message'] == 'name_required', 'a rider name is required')
s, b = rpc('hi8_quick_start', dict(args, p_email='lu@example.com', p_name='Lu', p_start='12:30'))
check(s == 400 and b['message'] == 'duplicate' and sql("select count(*) from signups") == n0, 'duplicate: warned, and nothing saved yet')
s, q = rpc('hi8_quick_start', {'p_email': 'Lu@Example.com', 'p_name': 'Lu', 'p_sport': 'mtb', 'p_spot': 'collserola', 'p_day': tmrw, 'p_start': '09:30',
                               'p_getting': 'own', 'p_level': 'ripper', 'p_ref': 'kaiwave'})
check(s == 200 and q['key'] and q['plate'] and q['code'] and q['host'] == 'Lu' and q['me']['level'] == 'ripper', 'email + name + crew: signed up with a plate, crew posted')
lu = q['key']; mtb = q['code']
check(sql("select first_name || '|' || source || '|' || ref from signups where email = 'lu@example.com'") == 'Lu|start|kaiwave', 'saved with the name, where they came from and the ref')

print('alerts for new crews')
s, a = rpc('hi8_alert_signup', {'p_email': 'Noor@Example.com', 'p_city': 'barcelona', 'p_sport': 'kite'})
check(s == 200 and a['key'] and a['plate'] and a['alerts'] == [{'city': 'barcelona', 'sport': 'kite'}], 'no account: one email field signs up and switches the kite alert on')
noor = a['key']
s, a = rpc('hi8_alert', {'p_key': lu, 'p_city': 'barcelona', 'p_sport': 'kite'})
check(s == 200 and len(a['alerts']) == 1, 'a rider switches an alert on')
s, a = rpc('hi8_alert', {'p_key': kai, 'p_city': 'barcelona', 'p_sport': 'kite'})
s, c4 = rpc('hi8_start_crew', dict(args, p_key=kai, p_spot='trabucador', p_day=in3, p_start='11:00', p_end=None, p_meet_hub=None, p_meet_time=None))
check(s == 200, 'Kai posts a Trabucador crew')
mails = sql(f"select to_email || '|' || subject || '|' || body from outbox where kind = 'new_crew' and crew_id = (select id from crews where code = '{c4['code']}') order by to_email")
check('noor@example.com|New kite crew' in mails and 'lu@example.com|New kite crew' in mails and 'kai@example.com' not in mails, 'Noor and Lu hear about it, Kai (who posted it) doesn\'t')
check('/?c=' + c4['code'] in mails and '/?stop=' in mails and 'Kai posted a crew' in mails, 'with the crew link, who posted it and a stop link')
for i, t in enumerate(['08:00', '15:00', '18:30']):
    rpc('hi8_start_crew', dict(args, p_key=kai, p_spot='riumar', p_day=in3, p_start=t, p_force=True))
check(sql("select count(*) from outbox where kind = 'new_crew' and to_email = 'noor@example.com'") == '3', 'at most 3 of those a day')
tok = sql("select token from crew_alerts where email = 'noor@example.com' and sport = 'kite'")
s, u = rpc('hi8_unsubscribe', {'p_token': tok})
check(s == 200 and u['stopped'] is True and u['sport'] == 'kite' and sql("select count(*) from crew_alerts where email = 'noor@example.com'") == '0', 'the stop link switches it off')
s, u = rpc('hi8_unsubscribe', {'p_token': tok})
check(s == 200 and u['stopped'] is False, 'clicking it twice is fine')
s, me = rpc('hi8_me', {'p_key': lu})
check(me['alerts'] == [{'city': 'barcelona', 'sport': 'kite'}] and me['email_hint'] == 'l•••@example.com', 'Me shows the alerts and a hint of the email')
s, a = rpc('hi8_alert', {'p_key': lu, 'p_city': 'barcelona', 'p_sport': 'kite', 'p_on': False})
check(a['alerts'] == [], 'and switches them off')

print('joining, seats and Bizum')
s, q = rpc('hi8_quick_join', {'p_email': 'sam@example.com', 'p_name': 'Sam', 'p_code': code, 'p_level': 'regular', 'p_getting': 'seat'})
sam = q['key']
check(s == 200 and {m['name']: m for m in q['members']}['Sam']['car_with'] == {m['name']: m for m in q['members']}['Kai']['member_id'], "Sam gets a seat in Kai's car")
s, q = rpc('hi8_quick_join', {'p_email': 'ines@example.com', 'p_name': 'Ines', 'p_code': code, 'p_level': 'ripper', 'p_getting': 'own'})
ines = q['key']
s, b = rpc('hi8_quick_join', {'p_email': 'rook@example.com', 'p_name': 'Rook', 'p_code': code, 'p_level': 'rookie'})
check(s == 400 and b['message'] == 'level', 'a rookie can\'t join a crew for riders who ride on their own')
s, b = rpc('hi8_settle', {'p_key': kai, 'p_code': code, 'p_cost': 16, 'p_bizum': '12345'})
check(s == 400 and b['message'] == 'bad_bizum', 'Bizum: not a Spanish mobile number, refused')
s, c = rpc('hi8_settle', {'p_key': kai, 'p_code': code, 'p_cost': 16, 'p_bizum': '612 345 678'})
kaim = {m['name']: m for m in c['members']}['Kai']
check(s == 200 and kaim['bizum'] == '+34612345678' and kaim['share'] == 8, 'Bizum 612 345 678: saved as +34612345678, €8 each')
s, sc = rpc('hi8_crew', {'p_code': code, 'p_key': sam})
check({m['name']: m for m in sc['members']}['Kai']['bizum'] == '+34612345678', 'Sam (in that car) sees the number')
s, ic = rpc('hi8_crew', {'p_code': code, 'p_key': ines})
check({m['name']: m for m in ic['members']}['Kai']['bizum'] is None, 'Ines (own way) doesn\'t')
s, pub = rpc('hi8_crew', {'p_code': code})
check('612345678' not in json.dumps(pub) and 'members' not in pub, 'nor does anyone outside the crew')
check("How to pay is on the crew page" in sql(f"select body from crew_messages m join crews c on c.id = m.crew_id where c.code = '{code}' and kind = 'edit' order by m.id desc limit 1"), 'the chat says where to pay')
check('612' not in sql("select coalesce(string_agg(body, ' '), '') from outbox where kind = 'pay'"), 'the number never goes out by email')

print('at the spot: check-ins and live reports')
s, b = rpc('hi8_checkin', {'p_key': sam, 'p_code': code})
check(s == 400 and b['message'] == 'not_today', 'check in only on the day')
sql(f"update crews set day = hi8_today(city), start_time = (hi8_city_now(city) - interval '20 minutes')::time, end_time = null where code = '{code}'")
s, b = rpc('hi8_checkin', {'p_key': lu, 'p_code': code})
check(s in (401, 403) and b['message'] == 'not_in_crew', 'not in the crew: no check-in')
s, c = rpc('hi8_checkin', {'p_key': sam, 'p_code': code})
check(s == 200 and c['me']['here'] is True and c['here'] == 1 and c['live'] is True, 'Sam checks in: 1 at the spot, the crew is live')
rpc('hi8_checkin', {'p_key': sam, 'p_code': code})
check(sql(f"select count(*) from crew_messages m join crews c on c.id = m.crew_id where c.code = '{code}' and kind = 'here'") == '1', 'checking in twice says it once')
s, b = rpc('hi8_report', {'p_key': ines, 'p_code': code, 'p_verdict': 'on', 'p_ground': 'muddy'})
check(s == 400 and b['message'] == 'bad_ground', 'no trail state on a kite crew')
s, b = rpc('hi8_report', {'p_key': ines, 'p_code': code, 'p_verdict': 'epic'})
check(s == 400 and b['message'] == 'bad_verdict', 'on, meh or off only')
s, c = rpc('hi8_report', {'p_key': ines, 'p_code': code, 'p_verdict': 'on', 'p_kite': 9, 'p_note': 'Gusty near the pier, fine out back'})
check(s == 200 and c['here'] == 2 and c['reports'][0]['kite'] == 9 and c['reports'][0]['name'] == 'Ines' and c['reports'][0]['note'].startswith('Gusty'),
      'Ines reports ON on a 9: counted at the spot; the crew sees her name and note')
check('Ines at the spot: ON · 9 m · Gusty' in sql(f"select body from crew_messages m join crews c on c.id = m.crew_id where c.code = '{code}' and kind = 'report'"), 'the report shows in the chat')
s, pub = rpc('hi8_crew', {'p_code': code})
check(pub['reports'][0]['verdict'] == 'on' and 'name' not in pub['reports'][0] and 'note' not in pub['reports'][0] and pub['here'] == 2, 'outside the crew: the report, without name or note')
s, live = rpc('hi8_live', {'p_city': 'barcelona'})
lc = {x['code']: x for x in live['crews']}
check(s == 200 and lc[code]['live'] is True and lc[code]['here'] == 2 and live['reports'][0]['spot'] == 'castelldefels' and live['reports'][0]['kite'] == 9,
      'the live map: the crew is live, 2 at the spot, the latest report')
check('Ines' not in json.dumps(live) and 'Gusty' not in json.dumps(live) and '@' not in json.dumps(live), 'no names, notes or emails on the map')
check(mtb in lc and c4['code'] not in lc, 'the map has the next three days only')
s, c = rpc('hi8_checkin', {'p_key': sam, 'p_code': code, 'p_here': False})
check(c['me']['here'] is False and c['here'] == 1, 'Sam leaves the spot')
for i in range(12): rpc('hi8_report', {'p_key': ines, 'p_code': code, 'p_verdict': 'meh'})
s, b = rpc('hi8_report', {'p_key': ines, 'p_code': code, 'p_verdict': 'meh'})
check(s == 429, 'reports are rate-limited')

print('locked')
for t in ('app_settings', 'spot_reports', 'crew_alerts'):
    check(get(t + '?select=*') in (401, 403, 404), f'the website can\'t read {t}')
for fn, body in (('hi8_setting', {'p_key': 'open_posting'}), ('hi8_alert_list', {'p_email': 'lu@example.com'}), ('hi8_on_new_crew', {})):
    s, b = rpc(fn, body)
    check(s in (401, 403, 404), f'{fn} is not callable from the website')

print('erase')
r = json.loads(sql("select public.erase_email('ines@example.com')"))
check(r['crew_memberships_deleted'] >= 1 and sql("select count(*) from spot_reports where email = 'ines@example.com'") == '0'
      and sql("select count(*) from spot_reports where note is not null") == '0', 'erasing Ines removes her email and notes from the reports')

print(f'\nALL {ok} PILOT CHECKS PASSED')
