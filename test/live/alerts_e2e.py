# TEST ONLY. 2.23 in a browser: the alert sheet and its preview, the push guide per phone, one-tap I'M GOING for a
# rider who's joined before, "I'm in if 2 more", the forecast dropping on a crew (and moving it), and "how was it".
import json, os, subprocess, urllib.request
from playwright.sync_api import sync_playwright

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
def rpc(fn, body):
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST', headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': '10.7.7.7'})
    with urllib.request.urlopen(req) as r: return json.loads(r.read() or b'null')

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.crew_alerts, public.spot_watch, public.wind_alerts, public.push_subs, public.push_queue, public.alert_sent, public.spot_reports cascade")
sql("update public.app_settings set value = 'true' where key = 'open_posting'")  # riders start crews here (crews_api switches it off)
sql("insert into public.app_settings (key, value, public) values ('vapid_public', '\"BOr3Yp8tGg0o5xSmN0y0Hn3nq6r2s3hZx8c5mB4q1yYc9n8kQe0b7mPq2v1sXx4lU8y1tZ6n0a9rJ2w3e4r5t6y\"', true) on conflict (key) do update set value = excluded.value")
K = {n: rpc('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})['key'] for n in ('ana', 'bo', 'cy')}
day = lambda off: sql(f"select ((now() at time zone 'Europe/Amsterdam')::date + {off})::text")
def crew(spot, off, host, members, start, end, mn=None):
    cid = sql(f"insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email, min_riders) values ('amsterdam','kite','{spot}', '{day(off)}', '{start}', '{end}', 'all', 6, 'cs', '07:00', '{host}@example.com', {mn or 'null'}) returning id").split('\n')[0]
    for m in members: sql(f"insert into public.crew_members (crew_id, email, level, getting, seats) values ('{cid}', '{m}@example.com', 'regular', '{'drive' if m == host else 'seat'}', {3 if m == host else 0})")
    return sql(f"select code from public.crews where id = '{cid}'")
# a crew a rider can still join: today when it's early enough, else tomorrow (this test failed when run after 18:00)
late = os.environ.get('HI8_LATE') or int(sql("select extract(hour from now() at time zone 'Europe/Amsterdam')")) >= 14
today_crew = crew('wijk-aan-zee', 1 if late else 0, 'bo', ['bo'], '15:00', '18:00')
drop_crew = crew('zandvoort', 1, 'ana', ['ana'], '13:00', '17:00')      # tomorrow is 7 kt in the stand-in forecast
past_crew = crew('wijk-aan-zee', -1, 'bo', ['bo', 'cy'], '12:00', '16:00')

with sync_playwright() as p:
    b = p.chromium.launch()
    def phone(dev, key=None, store=None):
        c = b.new_context(**p.devices[dev], timezone_id='Europe/Amsterdam'); pg = c.new_page(); errs = []
        if dev != 'iPhone 13': c.add_init_script("Object.defineProperty(Notification, 'permission', { get: () => 'default' })")  # headless Chromium says 'denied'; a phone that was never asked says 'default'
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '/'); pg.wait_for_timeout(300)
        if key: pg.evaluate("k => localStorage.setItem('hi8.me', JSON.stringify({key: k}))", key)
        for k, v in (store or {}).items(): pg.evaluate("([k, v]) => localStorage.setItem('hi8.' + k, JSON.stringify(v))", [k, v])
        return c, pg, errs
    txt = lambda pg, sel: pg.locator(sel).inner_text().upper()

    print('the alert')
    c1, A, eA = phone('Pixel 7', K['ana'])
    A.goto(BASE + '/'); A.wait_for_timeout(2500)
    check("TELL ME WHEN IT'S ON" in txt(A, '#sessions'), 'the landing asks: tell me when it\'s on')
    A.locator('#sessions [data-act=alerts]').click(); A.wait_for_selector('#sheet.on'); A.wait_for_timeout(800)
    t = txt(A, '#sheet')
    check('THIS WEEK YOU\'D GET' in t and A.locator('.alprev .alrow').count() >= 1, 'a preview: the alerts these settings would send this week')
    check(A.locator('[data-act=alpre]').count() == 3 and A.locator('[data-act=almin]').count() == 0, 'three ready-made starts; the wind detail is folded away (H10)')
    A.locator('[data-act=alpre][data-v=wknd]').click(); A.wait_for_timeout(300)
    check(A.locator('[data-act=alpre][data-v=wknd]').get_attribute('aria-pressed') == 'true', 'WEEKENDS is one tap')
    A.locator('[data-act=alpre][data-v=any]').click(); A.wait_for_timeout(300)
    A.locator('[data-act=altune]').click(); A.wait_for_timeout(300)
    n0 = A.locator('.alprev .alrow').count()
    A.locator('[data-act=almin][data-v="25"]').click(); A.wait_for_timeout(300)
    check(A.locator('.alprev .alrow').count() <= n0, 'asking for 25 kt: fewer (or no) days')
    A.locator('[data-act=almin][data-v="15"]').click(); A.wait_for_timeout(200)
    t = txt(A, '#sheet'); check('ONE TAP' in t, 'push on Android: one tap away: ' + t[t.find('HOW YOU HEAR'):][:160])
    A.locator('[data-act=alsave]').click(); A.wait_for_timeout(1500)
    check(sql("select min_kt || '|' || array_length(spots, 1) from wind_alerts where email = 'ana@example.com'") .startswith('15|'), 'saved with her conditions')
    A.locator('[data-act=close]').click(); A.wait_for_timeout(500)
    check('ALERT ON · KITE' in txt(A, '#sessions'), 'the landing shows the alert is on')
    A.goto(BASE + '/#push'); A.wait_for_selector('#sheet.on'); A.wait_for_timeout(500)
    check('ONE TAP AWAY' in txt(A, '#sheet') and A.locator('[data-act=pushon]').count() == 1, 'the push guide on Android: TURN ON PUSH')
    c2, I, eI = phone('iPhone 13', K['cy'])
    I.goto(BASE + '/#push'); I.wait_for_selector('#sheet.on'); I.wait_for_timeout(500)
    t = txt(I, '#sheet')
    check('IPHONE: 3 STEPS' in t and 'ADD TO HOME SCREEN' in t and 'IOS 16.4' in t, 'on iPhone in Safari: add to home screen first, in three steps')

    print('one tap')
    c3, R, eR = phone('Pixel 7', K['cy'], {'getting': 'seat', 'lv.kite': 'regular'})
    R.goto(BASE + '/'); R.wait_for_timeout(2500)
    R.locator(f'#sessions [data-act=going][data-code="{today_crew}"]').first.click(); R.wait_for_timeout(2500)
    check(sql(f"select count(*) from crew_members m join crews c on c.id = m.crew_id where c.code = '{today_crew}' and m.email = 'cy@example.com'") == '1' and "YOU'RE IN" in txt(R, '#toast'),
          "a rider who's joined before: I'M GOING and she's in, no form")
    check('CHANGE' in txt(R, '#toast'), '...with CHANGE right there')

    print("I'm in if 2 more")
    R.goto(BASE + '/'); R.wait_for_timeout(2000)
    R.locator('.bd-c[data-act=startwin]').first.click()
    R.wait_for_selector('#sheet.on'); R.wait_for_timeout(500)
    R.locator('[data-act=sfmin][data-v="3"]').click(); R.wait_for_timeout(200)
    check('NEEDS 2 MORE' in txt(R, '#sheet'), 'IF 2 MORE: it says it will show NEEDS 2 MORE')
    R.locator('.sh-foot .big.start').click(); R.wait_for_selector('text=YOUR CREW IS UP', timeout=8000); R.wait_for_timeout(800)
    check(sql("select min_riders from crews where host_email = 'cy@example.com' order by created_at desc limit 1") == '3' and 'NEEDS 2 MORE' in txt(R, '#sheet'), 'posted with a minimum of 3')

    print('the forecast dropped')
    A.goto(BASE + f'/?c={drop_crew}'); A.wait_for_timeout(2500)
    t = txt(A, '#sheet')
    check(('THE FORECAST DROPPED' in t or 'TOO LIGHT SO FAR' in t or 'NOT RECOMMENDED' in t) and A.locator('[data-act=movecrew]').count() == 1, 'tomorrow 7 kt: the captain sees it dropped, and the next good window')
    A.locator('[data-act=movecrew]').click(); A.wait_for_timeout(1500)
    check(sql(f"select day::text from crews where code = '{drop_crew}'") != day(1) and 'THE FORECAST DROPPED' not in txt(A, '#sheet'), 'MOVE IT: the crew moves to that window · ' + txt(A, '#toast')[:120] + ' · ' + sql(f"select day::text || ' ' || start_time from crews where code = '{drop_crew}'"))

    print('how was it')
    R.goto(BASE + f'/?c={past_crew}#rate'); R.wait_for_timeout(2500)
    check('HOW WAS IT?' in txt(R, '#sheet') and 'GO AGAIN' in txt(R, '#sheet'), 'the day after: how was it, and the next good window to go again')
    R.locator('#rateBox [data-act=report][data-v=on]').click(); R.wait_for_timeout(1500)
    check(sql(f"select verdict from spot_reports r join crews c on c.id = r.crew_id where c.code = '{past_crew}'") == 'on' and 'STAMPED' in txt(R, '#sheet'), 'one tap: stamped on the card')

    print('trust')
    R.goto(BASE + '/#me'); R.wait_for_selector('#sheet.on'); R.wait_for_timeout(1500)
    R.locator('[data-act=mycard]').click(); R.wait_for_timeout(1500)   # 2.26: the profile is the rider card
    R.fill('#prYears', '5'); R.fill('#prInsta', '@cy.kites'); R.locator('[data-act=cardwho][data-v="0"]').click(); R.locator('[data-act=cardsave]').click(); R.wait_for_timeout(1500)
    check(sql("select years_riding || '|' || insta from signups where email = 'cy@example.com'") == '5|cy.kites', 'a rider card from Me')
    R.goto(BASE + f'/?c={today_crew}'); R.wait_for_timeout(2500)
    check('5 YRS RIDING' in txt(R, '#sheet') and '@CY.KITES' in txt(R, '#sheet'), 'the crew sees it next to her name')
    check(not (eA + eI + eR), 'no script errors: ' + '; '.join(eA + eI + eR)[:300])
    b.close()
print(f'\nALL {ok} ALERT APP CHECKS PASSED')
