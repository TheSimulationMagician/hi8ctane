# TEST ONLY. 0008 (2.10) through the real API: the wallet, paying a seat from it, the money held until the crew
# has ridden, refunds (called off, left, changed cars), the Hi8 fee (pilot, live, waived by the Pass), and that
# only the Stripe functions (service role) can credit a wallet.
import json, os, subprocess, urllib.request, datetime, hmac, hashlib, base64, time

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
def jwt(role):
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).rstrip(b'=').decode()
    h, p = b({'alg': 'HS256', 'typ': 'JWT'}), b({'role': role, 'exp': int(time.time()) + 3600})
    s = base64.urlsafe_b64encode(hmac.new(b'test-secret-test-secret-test-secret-0123', f'{h}.{p}'.encode(), hashlib.sha256).digest()).rstrip(b'=').decode()
    return f'{h}.{p}.{s}'
SERVICE = jwt('service_role')
def rpc(fn, body, ip='10.8.8.8', service=False):
    hd = {'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': ip}
    if service: hd['authorization'] = 'Bearer ' + SERVICE
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST', headers=hd)
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')

sql("truncate public.signups, public.rider_keys, public.crews, public.crew_members, public.crew_messages, public.rate_hits, public.outbox, public.wallet_ledger, public.seat_payments, public.passes, public.payout_accounts cascade")
sql("update public.app_settings set value = 'true' where key = 'open_posting'")
sql("update public.app_settings set value = 'false' where key in ('payments_live', 'fee_live')")
tmrw = (datetime.date.today() + datetime.timedelta(days=1)).isoformat()

def person(email, name, ip):
    s, j = rpc('hi8_join', {'p_email': email, 'p_city': 'barcelona'}, ip=ip); rpc('hi8_profile', {'p_key': j['key'], 'p_name': name}, ip=ip); return j['key']
marta, sam, joost = person('marta@example.com', 'Marta', '10.8.0.1'), person('sam@example.com', 'Sam', '10.8.0.2'), person('joost@example.com', 'Joost', '10.8.0.3')
def crew():
    s, c = rpc('hi8_start_crew', {'p_key': marta, 'p_sport': 'kite', 'p_spot': 'castelldefels', 'p_day': tmrw, 'p_start': '12:00', 'p_end': '16:00',
                                  'p_meet_hub': 'sants', 'p_meet_time': '11:20', 'p_getting': 'drive', 'p_seats': 3, 'p_force': True}, ip='10.8.0.1')
    for k, ip in ((sam, '10.8.0.2'), (joost, '10.8.0.3')):
        rpc('hi8_join_crew', {'p_key': k, 'p_code': c['code'], 'p_level': 'regular', 'p_getting': 'seat', 'p_seats': 0, 'p_car_with': None}, ip=ip)
    return c['code']
code = crew()
bal = lambda e: int(sql(f"select public.hi8_balance('{e}')"))

print('switched off until the Stripe keys are in')
s, w = rpc('hi8_wallet', {'p_key': sam})
check(s == 200 and w['live'] is False and w['balance_cents'] == 0 and w['topups'] == [1000, 2000, 5000] and w['pass_month_cents'] == 399, 'the wallet: off, empty, top-ups of €10, €20, €50, the Pass at €3.99')
s, b = rpc('hi8_pay_seat', {'p_key': sam, 'p_code': code})
check(s == 400 and b['message'] == 'payments_off', 'paying a seat: not yet')
sql("update public.app_settings set value = 'true' where key = 'payments_live'")

print('only Stripe (the service role) credits a wallet')
s, b = rpc('hi8_topup_paid', {'p_email': 'sam@example.com', 'p_cents': 5000, 'p_ref': 'cs_fake'})
check(s in (401, 403, 404) and bal('sam@example.com') == 0, 'the website can\'t top itself up')
check(rpc('hi8_key_owner', {'p_key': sam})[0] in (401, 403, 404), 'nor read whose key is whose')
s, b = rpc('hi8_topup_paid', {'p_email': 'Sam@Example.com', 'p_cents': 2000, 'p_ref': 'cs_test_1'}, service=True)
check(s == 200 and b['balance_cents'] == 2000, 'a paid €20 top-up lands')
rpc('hi8_topup_paid', {'p_email': 'sam@example.com', 'p_cents': 2000, 'p_ref': 'cs_test_1'}, service=True)
check(bal('sam@example.com') == 2000, 'the same Stripe payment twice counts once')
s, o = rpc('hi8_key_owner', {'p_key': sam}, service=True)
check(s == 200 and o['email'] == 'sam@example.com' and o['live'] is True and o['balance_cents'] == 2000, 'the Stripe function knows who\'s paying')

print('paying a seat')
s, b = rpc('hi8_pay_seat', {'p_key': sam, 'p_code': code})
check(s == 400 and b['message'] == 'not_ready', 'before the driver adds what the car costs: not yet')
rpc('hi8_settle', {'p_key': marta, 'p_code': code, 'p_cost': 18, 'p_link': None, 'p_bizum': None}, ip='10.8.0.1')
s, c = rpc('hi8_pay_seat', {'p_key': sam, 'p_code': code})
check(s == 200 and c['me']['paid'] is True and bal('sam@example.com') == 1400, 'Sam pays €6.00 (€18 split 3 ways), no fee in the pilot: €14 left')
check(sql("select share_cents || '|' || fee_cents || '|' || waived || '|' || status || '|' || driver_email from seat_payments") == '600|0|pilot|held|marta@example.com', 'held for Marta until the crew has ridden')
s, b = rpc('hi8_pay_seat', {'p_key': sam, 'p_code': code})
check(s == 400 and b['message'] == 'already_paid', 'paying twice: no')
s, b = rpc('hi8_pay_seat', {'p_key': joost, 'p_code': code})
check(s == 400 and b['message'] == 'no_funds' and b['details'] == '600', 'Joost has no money in: it says how much is missing')
s, w = rpc('hi8_wallet', {'p_key': marta})
check(w['pending_cents'] == 600 and w['balance_cents'] == 0, 'Marta sees €6 on its way')

print('the Hi8 fee: live, or waived by the Pass')
sql("update public.app_settings set value = 'true' where key = 'fee_live'")
rpc('hi8_topup_paid', {'p_email': 'joost@example.com', 'p_cents': 1000, 'p_ref': 'cs_test_2'}, service=True)
s, c = rpc('hi8_pay_seat', {'p_key': joost, 'p_code': code})
check(s == 200 and bal('joost@example.com') == 310, 'fee live: Joost pays €6.00 + €0.90 (15%)')
check(sql("select fee_cents from seat_payments where rider_email = 'joost@example.com'") == '90', 'the fee is kept apart from the share')
rpc('hi8_pass_update', {'p_email': 'joost@example.com', 'p_plan': 'month', 'p_status': 'active', 'p_until': (datetime.datetime.utcnow() + datetime.timedelta(days=30)).isoformat() + 'Z', 'p_sub': 'sub_1', 'p_cus': 'cus_1'}, service=True)
s, w = rpc('hi8_wallet', {'p_key': joost})
check(w['pass']['active'] is True and w['pass']['plan'] == 'month', 'Joost takes the Hi8 Pass')
check(json.loads(sql("select public.hi8_seat_price(c.id, 'joost@example.com') from crews c where code = '" + code + "'"))['waived'] == 'pass', 'with the Pass, no fee on his next seats')
sql("update public.app_settings set value = 'false' where key = 'fee_live'")

print('refunds and paying the driver')
s, j = rpc('hi8_leave_crew', {'p_key': joost, 'p_code': code, 'p_reason': None}, ip='10.8.0.3')
check(bal('joost@example.com') == 1000 and sql("select status from seat_payments where rider_email = 'joost@example.com'") == 'refunded', 'Joost leaves: all €6.90 back')
sql(f"update crews set day = current_date - 1 where code = '{code}'")
check(sql("select public.hi8_release_seats()") == '1' and bal('marta@example.com') == 600, 'the day after: Sam\'s €6 goes to Marta')
check(sql("select status from seat_payments where rider_email = 'sam@example.com'") == 'released', 'and the seat is settled')
check(sql("select public.hi8_release_seats()") == '0' and bal('marta@example.com') == 600, 'never twice')
code2 = crew()
rpc('hi8_settle', {'p_key': marta, 'p_code': code2, 'p_cost': 20, 'p_link': None, 'p_bizum': None}, ip='10.8.0.1')
rpc('hi8_pay_seat', {'p_key': sam, 'p_code': code2})
before = bal('sam@example.com')
rpc('hi8_leave_crew', {'p_key': marta, 'p_code': code2, 'p_reason': 'No wind'}, ip='10.8.0.1')
check(bal('sam@example.com') > before and sql(f"select status from crews where code = '{code2}'") == 'off', 'the captain calls it off: Sam gets his seat back')

print('withdrawing and erasing')
s, b = rpc('hi8_payout_start', {'p_email': 'sam@example.com'}, service=True)
check(s == 200 and b['cents'] == bal('sam@example.com') + b['cents'] and bal('sam@example.com') == 0, 'a withdrawal takes the whole balance out first')
rpc('hi8_payout_done', {'p_ledger': b['ledger_id'], 'p_ref': None, 'p_ok': False}, service=True)
check(bal('sam@example.com') == b['cents'], 'a failed transfer puts it back')
sql("update wallet_ledger set cents = 100 where email = 'joost@example.com' and kind = 'topup'"); sql("delete from wallet_ledger where email = 'joost@example.com' and kind <> 'topup'")
s, e = rpc('hi8_payout_start', {'p_email': 'joost@example.com'}, service=True)
check(s == 400 and e['message'] == 'payout_min', 'under €5: not yet')
r = json.loads(sql("select public.erase_email('sam@example.com')"))
check(r['wallet_anonymised'] and sql("select count(*) from wallet_ledger where email = 'sam@example.com'") == '0' and sql("select count(*) from wallet_ledger where email like 'erased:%'") != '0', 'erasing Sam keeps the books but not his name')
sql("update public.app_settings set value = 'false' where key = 'payments_live'")

print(f'\nALL {ok} WALLET CHECKS PASSED')
