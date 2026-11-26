# TEST ONLY. 2.33 in a browser: Explore. The three sport modes (kite, MTB, MX) in their 2.5 colours, the sport cards,
# a button on each card for its state, and the next move always in the bar at the bottom.
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
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST', headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': '10.6.3.1'})
    with urllib.request.urlopen(req) as r: return json.loads(r.read() or b'null')

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.ride_asks, public.spot_reports cascade")
K = {n: rpc('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})['key'] for n in ('ana', 'bo')}
sql("update signups set first_name = initcap(split_part(email, '@', 1)) where email like '%@example.com'")
def crew(off, host, sport='kite', spot='wijk-aan-zee', start='13:00'):
    cid = sql(f"insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email) values ('amsterdam','{sport}','{spot}', hi8_today('amsterdam') + {off}, '{start}', '17:00', 'all', 8, 'cs', '{start}', '{host}@example.com') returning id")
    sql(f"insert into public.crew_members (crew_id, email, level, getting, seats) values ('{cid}', '{host}@example.com', 'regular', 'own', 0)")
    return cid, sql(f"select code from public.crews where id = '{cid}'")
cid, code = crew(2, 'ana', spot='muiderberg')  # the test forecast: Muiderberg is on in two days

with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    def phone(key=None):
        c = b.new_context(**p.devices['iPhone 13'], timezone_id='Europe/Amsterdam'); pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '/'); pg.wait_for_timeout(300)
        if key: pg.evaluate("k => localStorage.setItem('hi8.me', JSON.stringify({key: k}))", key)
        pg.evaluate("localStorage.setItem('hi8.sport28', JSON.stringify('kite'))")
        return pg
    print('a visitor')
    V = phone(); V.goto(BASE + '/?r=1#join'); V.wait_for_selector('#sheet.on'); V.wait_for_timeout(2000)
    check('EXPLORE' in V.inner_text('#shTitle'), 'the sheet is EXPLORE')
    modes = V.locator('#sheet .modes .mode')
    check(modes.count() == 3 and [modes.nth(i).get_attribute('data-sport') for i in range(3)] == ['kite', 'mtb', 'mx'], 'three sport modes: kite, MTB, MX')
    check(V.locator('#sheet .mode[data-sport=kite]').get_attribute('aria-pressed') == 'true' and V.locator('#sheet .xband.a-kite').count() == 1, 'kite is on, with its band')
    check('#B5532B' in (V.locator('#sheet .mode[data-sport=mx]').get_attribute('style') or ''), 'MX is rust, as in the 2.5 cards')
    check(V.locator('#sheet .sc').count() == 1 and V.locator('#sheet .sc .jn').inner_text().strip() == 'JOIN NOW', "Ana's crew, as a sport card: JOIN NOW")
    nm = V.locator('#sheet .sh-foot .nmv')
    check(nm.count() == 1 and 'n-join' in nm.get_attribute('class') and 'JOIN THIS CREW' in nm.inner_text().upper() and nm.get_attribute('data-code') == code, 'the bar: the next move is joining that crew')
    check(V.locator('#sheet .sh-foot [data-act=start]').count() == 1, 'and starting one is one tap beside it')
    V.locator('#sheet .mode[data-sport=mx]').click(); V.wait_for_timeout(500)
    check(V.locator('#sheet .mode[data-sport=mx]').get_attribute('aria-pressed') == 'true' and V.locator('#sheet .xband.a-mx').count() == 1, 'tap MX: the band turns MX')
    k = V.locator('#sheet .sh-foot .nmv').get_attribute('class')
    check(('n-start' in k and V.locator('#sheet .sh-foot .nmplus').count() == 0) or 'n-alert' in k, 'no MX crew: the next move is to start the best window, or to get told when it\'s on (' + k + ')')
    print('a rider in the crew')
    sql(f"insert into public.crew_members (crew_id, email, level, getting, seats) values ('{cid}', 'bo@example.com', 'regular', 'own', 0)")
    B = phone(K['bo']); B.goto(BASE + '/?r=1#join'); B.wait_for_selector('#sheet.on'); B.wait_for_timeout(2500)
    check("YOU'RE IN" in B.locator('#sheet .sc .jn').inner_text().upper(), "Bo's card says YOU'RE IN")
    check("YOU'RE IN" in B.locator('#sheet .mode[data-sport=kite] small').inner_text().upper(), 'and so does the kite mode')
    nm = B.locator('#sheet .sh-foot .nmv')
    check('n-mine' in nm.get_attribute('class') and 'OPEN MY CREW' in nm.inner_text().upper(), 'the bar: open my crew')
    nm.click(); B.wait_for_timeout(1500)
    check('KITE CREW' in B.inner_text('#shTitle').upper(), 'one tap: the crew')
    check(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
print(f'ALL {ok} EXPLORE CHECKS PASSED')
