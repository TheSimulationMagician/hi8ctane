# TEST ONLY. Clicks through the live sign-up flows in a real browser against Postgres + PostgREST.
import json, os, subprocess, time, base64, hmac, hashlib, uuid, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get('HI8_BASE', 'http://localhost:8801')  # serve.mjs in live mode
PSQL = ['psql', '-h', os.environ.get('PGHOST', '127.0.0.1'), '-p', os.environ.get('PGPORT', '5440'), '-U', 'postgres', '-d', os.environ.get('PGDATABASE', 'hi8'), '-qAt', '-v', 'ON_ERROR_STOP=1']
ok = 0
def sql(q):
    r = subprocess.run(PSQL + ['-c', q], capture_output=True, text=True)
    if r.returncode: raise SystemExit('SQL failed: ' + r.stderr)
    return r.stdout.strip()
def check(cond, what):
    global ok
    if not cond: raise SystemExit('FAIL: ' + what)
    ok += 1; print('  ok ·', what)
def ls(page, k):
    v = page.evaluate(f"localStorage.getItem('hi8.{k}')")
    return json.loads(v) if v else None
def rpc(fn, body, ip='10.9.9.9', jwt=None):
    h = {'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': ip}
    if jwt: h['authorization'] = 'Bearer ' + jwt
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), headers=h, method='POST')
    try:
        with urllib.request.urlopen(req) as r: return r.status, json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return e.code, json.loads(e.read() or b'null')
def jwt(claims, secret=b'test-secret-test-secret-test-secret-0123'):
    b = lambda d: base64.urlsafe_b64encode(json.dumps(d, separators=(',', ':')).encode()).rstrip(b'=')
    head, body = b({'alg': 'HS256', 'typ': 'JWT'}), b(claims)
    sig = base64.urlsafe_b64encode(hmac.new(secret, head + b'.' + body, hashlib.sha256).digest()).rstrip(b'=')
    return (head + b'.' + body + b'.' + sig).decode()

sql("truncate public.signups, public.night_rsvps, public.rider_keys, public.partner_leads, public.rate_hits; delete from auth.users;")

with sync_playwright() as p:
    br = p.chromium.launch()
    def fresh(w=390):
        ctx = br.new_context(viewport={'width': w, 'height': 844}, accept_downloads=True)
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.errs = errs
        return ctx, pg

    print('A · the app (2.8) → the old Get In → onboarding (Amsterdam)')
    ctxA, pg = fresh()
    pg.goto(BASE + '/B27-Landing.dc.html?ref=kaiwave')  # the 2.7 landing link now opens the live app
    pg.wait_for_url(lambda u: '/?ref=kaiwave' in u); pg.wait_for_timeout(500)
    check(ls(pg, 'src') == {'source': None, 'ref': 'kaiwave'}, 'ref code from the link is kept')
    pg.goto(BASE + '/B27-Join.dc.html?city=amsterdam')
    pg.wait_for_timeout(500)
    check("You'll get founding plate #001 in Amsterdam" in pg.inner_text('#dc-root'), 'sticker shows the real next plate (#001)')
    texts = pg.evaluate("[...document.querySelectorAll('#dc-root svg text')].map(t => t.textContent)")
    check('38' not in texts and '1' in texts, 'header plate badge shows the same number')
    pg.locator('a.big', has_text='EMAIL ME A LINK').click()
    pg.wait_for_timeout(300)
    check('B27-Join.dc.html' in pg.url, 'empty email: stays on Get In')
    check(pg.evaluate("document.getElementById('em').validationMessage") == 'Type your email first.', 'empty email: says what to do')
    pg.locator('a.big', has_text='CONTINUE WITH GOOGLE').click()
    pg.wait_for_timeout(200)
    check('B27-Join.dc.html' in pg.url and 'coming soon' in pg.evaluate("document.getElementById('em').validationMessage"), 'Google (not set up yet): points to email instead of a dead end')
    pg.fill('#em', 'kai@gmial.com'); pg.press('#em', 'Enter'); pg.wait_for_timeout(200)
    check('B27-Join.dc.html' in pg.url and 'kai@gmail.com' in pg.evaluate("document.getElementById('em').validationMessage"), 'typo in the email: "did you mean kai@gmail.com?"')
    pg.fill('#em', 'Kai.Rider@Example.com')
    pg.press('#em', 'Enter')
    pg.wait_for_url('**/B27-Onboard.dc.html')
    me = ls(pg, 'me')
    check(me and me['key'] and me['plates'] == {'amsterdam': 1}, 'Enter submits; browser gets its key and plate #1')
    check(sql("select count(*) from signups where email='kai.rider@example.com' and city='amsterdam' and plate=1 and ref='kaiwave'") == '1', 'saved in Supabase: amsterdam, plate 1, ref kaiwave')
    pg.wait_for_timeout(300)
    check(pg.input_value('#rn') == '', 'onboarding starts with an empty rider name (no "Frankie")')
    check(pg.get_attribute('button[aria-label=KITE]', 'aria-pressed') == 'false', 'no sport picked for you')
    pg.fill('#rn', 'Kai')
    pg.click('button[aria-label=KITE]'); pg.click('button[aria-label=WING]')
    pg.get_by_role('button', name='RIPPER').first.click()  # kite is listed first
    pg.get_by_role('button', name='NEXT · WHERE YOU START').click()
    pg.wait_for_timeout(600)
    check(sql("select first_name || '|' || array_to_string(sports, ',') || '|' || (levels->>'kite') from signups where email='kai.rider@example.com'") == 'Kai|kite,wing|ripper', 'step 1 saved: name, sports, levels')
    pg.locator("button:has-text('CENTRAAL')").first.click()
    pg.get_by_role('button', name='UP TO 90 MIN').click()
    pg.get_by_role('button', name='I CAN DRIVE').click()
    pg.locator('a.big[href="B27-Home.dc.html"]').click()
    pg.wait_for_url(lambda u: u.split('?')[0].split('#')[0].endswith(':8801/'))  # home is the live app now
    check(sql("select hub || '|' || max_min || '|' || getting_there from signups where email='kai.rider@example.com'") == 'cs|90|drive', 'step 2 saved before leaving: hub, max, getting there')
    check(not pg.errs, 'no script errors')

    print('B · Founding Night RSVP without an account: the email right in the RSVP box')
    ctxB, pg = fresh()
    pg.goto(BASE + '/B27-Night.dc.html?utm_source=instagram&utm_campaign=launch')
    pg.wait_for_timeout(500)
    check('0 OF 150 GOING · FREE' in pg.inner_text('#dc-root'), 'real count (0 going)')
    pg.locator('button', has_text='SUP + SURF').first.click()
    pg.locator('button', has_text='GRÀCIA').first.click()
    pg.locator('button', has_text='Every session is my own call').click()
    check(pg.locator('#nem').count() == 1, 'no account: an email field inside the RSVP box')
    pg.locator('button.big', has_text="I'M GOING").click(); pg.wait_for_timeout(200)
    check('email first' in pg.evaluate("document.getElementById('nem').validationMessage"), 'no email yet: asks for it, stays on the page')
    pg.fill('#nem', 'mara@example.com')
    pg.locator('button.big', has_text="I'M GOING").click()
    pg.wait_for_timeout(1500)
    t = pg.inner_text('#dc-root')
    check("YOU'RE GOING · #1" in t and '1 OF 150 GOING' in t and pg.url.split('?')[0].endswith('B27-Night.dc.html'), 'one tap: signed up and going, #1, count 1, never left the page')
    check(sql("select session || '|' || hub || '|' || photo_ok from night_rsvps where email='mara@example.com'") == 'sup-surf|gracia|false', 'RSVP saved: SUP + surf, Gràcia, photos not ticked')
    check(sql("select plate || '|' || source from signups where email='mara@example.com' and city='barcelona'") == '1|instagram/launch', 'sign-up saved with plate 1 in Barcelona and source instagram/launch')
    badge = pg.evaluate("(() => { const s=[...document.querySelectorAll('#dc-root span')].find(x=>/^YOU'RE GOING/.test(x.textContent)); return s.parentNode.parentNode.querySelector('svg text').textContent })()")
    check(badge == '1', 'plate badge shows their own plate')
    pg.locator('button', has_text='MTB').first.click()
    pg.wait_for_timeout(900)
    check(sql("select session from night_rsvps where email='mara@example.com'") == 'mtb', 'changing session after RSVP updates it')
    with pg.expect_download() as dl:
        pg.locator('button', has_text='ADD TO CALENDAR').click()
    ics = open(dl.value.path()).read()
    check('DTSTART:20270123T083000Z' in ics and 'MTB at Collserola' in ics, 'calendar file with the right time and session')
    pg.reload(); pg.wait_for_timeout(800)
    check("YOU'RE GOING · #1" in pg.inner_text('#dc-root'), 'still going after a reload')
    check(not pg.errs, 'no script errors')

    print('C · a new city: I\'m in, captain, out again')
    pg = ctxA.new_page(); pg.errs = []; pg.on('pageerror', lambda e: pg.errs.append(str(e)))
    pg.goto(BASE + '/lisbon')
    pg.wait_for_url('**/B27-City.dc.html?c=lis')
    pg.wait_for_timeout(500)
    check('LISBON' in pg.inner_text('#dc-root') and '0 / 25' in pg.inner_text('#dc-root'), 'hi8ctane.com/lisbon opens Lisbon with real numbers')
    pg.get_by_role('button', name="I'M IN").click(); pg.wait_for_timeout(900)
    check(sql("select plate || '|' || first_name || '|' || array_to_string(sports, ',') from signups where email='kai.rider@example.com' and city='lisbon'") == '1|Kai|kite,wing', "I'm in: Lisbon plate 1, profile carried over")
    check('1 / 25' in pg.inner_text('#dc-root'), 'count shows 1 / 25')
    pg.get_by_role('button', name="I'LL CAPTAIN").click(); pg.wait_for_timeout(300)
    pg.get_by_role('button', name='FRI PM').click(); pg.wait_for_timeout(900)
    check(sql("select captain || '|' || captain_sport || '|' || array_to_string(captain_days, ',') from signups where email='kai.rider@example.com' and city='lisbon'") == 'true|surf|fri,sat', 'captain saved with sport and days')
    pg.get_by_role('button', name="✓ YOU'RE IN").click(); pg.get_by_role('button', name='✓ CAPTAIN').click(); pg.wait_for_timeout(900)
    check(sql("select count(*) from signups where email='kai.rider@example.com' and city='lisbon'") == '0', 'both off: off the Lisbon list')
    check(not pg.errs, 'no script errors')
    pg.goto(BASE + '/tarifa'); pg.wait_for_url('**/?city=tarifa'); pg.wait_for_timeout(1500)
    check('TARIFA' in pg.inner_text('body').upper() and pg.evaluate("localStorage.getItem('hi8.city28') || ''") != 'x', 'hi8ctane.com/tarifa opens the app in Tarifa, now that it is live')

    ctxC, pg = fresh()
    pg.goto(BASE + '/B27-City.dc.html'); pg.wait_for_timeout(300)
    pg.get_by_role('button', name="I'M IN").click()
    pg.wait_for_url('**/B27-Join.dc.html?next=city&c=lis&city=lisbon')
    pg.fill('#em', 'tiago@example.com'); pg.press('#em', 'Enter')
    pg.wait_for_url('**/B27-City.dc.html?c=lis&from=join'); pg.wait_for_timeout(1200)
    check("✓ YOU'RE IN" in pg.inner_text('#dc-root') and '1 / 25' in pg.inner_text('#dc-root'), 'no account yet: get in, then back to Lisbon and in')
    check(sql("select count(*) from signups where email='tiago@example.com' and city='lisbon'") == '1', 'Lisbon sign-up saved')

    print('D · schools + rental shops')
    ctxD, pg = fresh()
    pg.goto(BASE + '/schools'); pg.wait_for_url('**/B27-Schools.dc.html'); pg.wait_for_timeout(300)
    pg.locator('a.big[href^="mailto:"]').click(); pg.wait_for_timeout(300)
    check(pg.evaluate("document.getElementById('sn').validationMessage") == 'Add your school or shop name.', 'empty form: asks for the name first')
    pg.fill('#sn', 'Wind Lab'); pg.fill('#sp', 'Wijk aan Zee'); pg.fill('#ct', 'hi@windlab.example')
    pg.get_by_role('button', name='RENTAL').click()
    pg.locator('a.big[href^="mailto:"]').click(); pg.wait_for_timeout(800)
    check(sql("select name || '|' || spot || '|' || array_to_string(offers, ',') || '|' || contact from partner_leads") == 'Wind Lab|Wijk aan Zee|lessons,rental|hi@windlab.example', 'lead saved')

    print('E · nothing reaches Supabase: the sign-up waits and goes out on the next page')
    ctxE, pg = fresh()
    pg.route('**/rest/v1/rpc/hi8_join', lambda r: r.abort())
    pg.goto(BASE + '/B27-Join.dc.html'); pg.wait_for_timeout(300)
    pg.fill('#em', 'offline@example.com'); pg.press('#em', 'Enter')
    pg.wait_for_url('**/B27-Onboard.dc.html')
    check(len(ls(pg, 'queue') or []) == 1 and sql("select count(*) from signups where email='offline@example.com'") == '0', 'offline: carries on, sign-up kept in the browser')
    pg.unroute('**/rest/v1/rpc/hi8_join')
    pg.fill('#rn', 'Off'); pg.click('button[aria-label=SURF]'); pg.get_by_role('button', name='NEXT · WHERE YOU START').click()
    pg.goto(BASE + '/B27-Home.dc.html'); pg.wait_for_timeout(2500)
    check(sql("select first_name from signups where email='offline@example.com'") == 'Off' and (ls(pg, 'me') or {}).get('key'), 'back online: sign-up and name sent, key saved')

    print('F · email link sign-in (for when Supabase Auth email is switched on)')
    uid = str(uuid.uuid4())
    sql(f"insert into auth.users (id, email, email_confirmed_at, raw_app_meta_data) values ('{uid}', 'Linky@Example.com', now(), '{{\"provider\":\"email\"}}')")
    tok = jwt({'sub': uid, 'role': 'authenticated', 'aud': 'authenticated', 'email': 'linky@example.com', 'exp': int(time.time()) + 3600})
    ctxF, pg = fresh()
    pg.goto(BASE + '/B27-Onboard.dc.html#access_token=' + tok + '&type=magiclink'); pg.wait_for_timeout(1000)
    check('#' not in pg.url and (ls(pg, 'me') or {}).get('key'), 'link opened: token swapped for a key, address bar cleaned')
    check(sql("select count(*) from signups where email='linky@example.com' and email_verified_at is not null") == '1', 'email marked verified')
    uid2 = str(uuid.uuid4())
    sql(f"insert into auth.users (id, email) values ('{uid2}', 'nope@example.com')")
    s, b = rpc('hi8_claim', {}, jwt=jwt({'sub': uid2, 'role': 'authenticated', 'exp': int(time.time()) + 3600}))
    check(s >= 400 and b['message'] == 'email_not_confirmed', 'unconfirmed email gets no key')

    print('G · the API can\'t be misused')
    s, b = rpc('hi8_city', {'p_key': ls(ctxA.pages[0], 'me')['key'], 'p_city': 'amsterdam', 'p_in': False})
    check(s == 400 and b['message'] == 'city_is_open', 'cannot leave an open city (and lose a plate) from the city page')
    s, b = rpc('hi8_profile', {'p_key': str(uuid.uuid4()), 'p_name': 'x'})
    check(s >= 400 and b['message'] == 'unknown_key', 'made-up key: refused')
    s, b = rpc('hi8_profile', {'p_key': ls(ctxA.pages[0], 'me')['key'], 'p_levels': {'kite': 'god'}})
    check(s == 400 and b['message'] == 'bad_level', 'bad level: refused')
    s, b = rpc('hi8_rsvp', {'p_key': ls(ctxA.pages[0], 'me')['key'], 'p_session': 'mtb', 'p_hub': 'sants', 'p_waiver': False})
    check(s == 400 and b['message'] == 'waiver_required', 'RSVP without the waiver tick: refused')
    for t in ['signups', 'night_rsvps', 'rider_keys', 'partner_leads', 'rate_hits', 'app_secrets', 'cities']:
        req = urllib.request.Request(f'{BASE}/rest/v1/{t}?select=*', headers={'apikey': 'sb_publishable_test'})
        try: urllib.request.urlopen(req); code = 200
        except urllib.error.HTTPError as e: code = e.code
        check(code in (401, 403), f'table {t} is closed to the website ({code})')
    for fn in ['join_waitlist', 'rsvp_night', 'public_counts', 'erase_email', 'hi8_email', 'hi8_limit', 'hi8_client', 'hi8_claim']:
        s, b = rpc(fn, {})
        check(s in (401, 403, 404) or (b and b.get('code') == '42501'), f'{fn} cannot be called from the website')
    codes = [rpc('hi8_join', {'p_email': f'bot{i}@example.com'}, ip='6.6.6.6')[0] for i in range(21)]
    check(codes[:20] == [200] * 20 and codes[20] == 429, '21st sign-up from one address in 10 minutes: slowed down (429)')
    check(rpc('hi8_join', {'p_email': 'friend@example.com'}, ip='7.7.7.7')[0] == 200, 'others are not affected')
    check(sql("select count(*) from rate_hits where who ~ '^[0-9a-f]{64}$' or who in ('everyone') or who ~ '^[0-9a-f-]{36}$'") == sql("select count(*) from rate_hits"), 'no raw IP addresses stored')
    _, c = rpc('hi8_counts', {})
    check('email' not in json.dumps(c) and c['night']['going'] == 1 and c['cities']['lisbon']['riders'] == 1, 'public counts: numbers only')
    br.close()

print(f'\nALL {ok} CHECKS PASSED')
