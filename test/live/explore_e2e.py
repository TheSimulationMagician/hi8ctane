# TEST ONLY. 2.33 in a browser: WHAT'S ON. One Adventure Card per thing worth doing (a crew going, or the best window
# of a sport with no crew yet), each in its sport's colours, each with one button: the next move.
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
        return pg
    print('a visitor')
    V = phone(); V.goto(BASE + '/?r=1#join'); V.wait_for_selector('#sheet.on'); V.wait_for_timeout(2500)
    check("WHAT'S ON?" in V.inner_text('#sheet .won'), "the sheet asks WHAT'S ON?")
    cards = V.locator('#sheet .adrail .ad')
    check(cards.count() >= 3, f'a swipe row of adventure cards ({cards.count()})')
    ana = V.locator(f'#sheet .ad:has([data-code="{code}"])')
    # card-first B: one calm card. The sport's colour on top (spot, verdict, the day's line), three numbers, who, one button
    check(ana.count() == 1 and "ANA'S CREW" in ana.locator('.k2c').inner_text().upper() and 'GOING' in ana.locator('.k2c').inner_text().upper(), "Ana's crew is a card: ANA'S CREW · N GOING")
    check(ana.locator('.oc-t.s-kite .tile').count() == 1 and ana.locator('.oc-a.s-kite .oc-fig').count() == 1 and ana.locator('.oc-n').count() == 1, 'the simple card: the kite banner with its figure and the spot')
    check('KT' in ana.locator('.oc-p').inner_text().upper() and 'GOING' in ana.locator('.oc-m').inner_text().upper() and 'GUSTS' in ana.locator('.oc-meta').inner_text().upper(), 'the day, the wind in pink, who is going; gusts and the drive in the note')
    check('DRIVER' in ana.locator('.k2c').inner_text().upper() or 'SEAT' in ana.locator('.k2c').inner_text().upper() or 'CAR FULL' in ana.locator('.k2c').inner_text().upper(), 'it says whether there is a driver: ' + ana.locator('.k2c').inner_text())
    check(ana.locator('.ad-go').count() == 1 and ana.locator('.ad-go').inner_text().strip() in ("I'M IN", 'MAKE IT GO'), "one button: I'M IN")
    ana.locator('.ad-cx').click(); V.wait_for_timeout(600)
    check(V.locator('#sheet .c2').count() == 1 and V.locator('#sheet .c2d[aria-pressed=true]').count() == 1, 'CONDITIONS, HOUR BY HOUR opens the spot: the open card on that day')
    V.goto(BASE + '/?r=1#join'); V.wait_for_selector('#sheet.on'); V.wait_for_timeout(1500)
    sports = set(V.locator('#sheet .ad .oc-a').evaluate_all("els => els.map(e => (e.className.match(/s-(\\w+)/) || [])[1]).filter(Boolean)"))
    win = V.locator('#sheet .ad [data-act=startwin]')
    check(win.count() >= 1 and len(sports) >= 2, f'sports with no crew yet show their best window, START THIS ONE ({sorted(sports)})')
    check(V.locator('#sheet .ad.end [data-act=looking]').count() == 1 and V.locator('#sheet .ad.end [data-act=start]').count() == 1, "the last card: I'M UP FOR A RIDE, or start your own")
    w0 = win.first; sp = w0.get_attribute('data-sport'); w0.click(); V.wait_for_timeout(800)
    check(V.locator('#sheet .qsum').count() == 1 and sp.upper() in V.locator('#sheet .qsum').inner_text().upper(), f'START THIS ONE opens the start form, filled in, on that sport ({sp})')
    print('a rider in the crew')
    sql(f"insert into public.crew_members (crew_id, email, level, getting, seats) values ('{cid}', 'bo@example.com', 'regular', 'own', 0)")
    B = phone(K['bo']); B.goto(BASE + '/?r=1#join'); B.wait_for_selector('#sheet.on'); B.wait_for_timeout(2500)
    first = B.locator('#sheet .adrail .ad').first
    check('mine' in first.get_attribute('class') and "YOU'RE IN" in first.inner_text().upper(), "Bo's crew comes first: YOU'RE IN")
    first.locator('.ad-go').click(); B.wait_for_timeout(1500)
    check('KITE CREW' in B.inner_text('#shTitle').upper(), 'OPEN MY CREW: one tap, the crew')
    print('the home')
    H = phone(); H.goto(BASE + '/?r=1'); H.wait_for_timeout(3000)
    check(H.locator('#sessions .homerail .ad').count() >= 2 and H.locator(f'#sessions .homerail [data-act=going][data-code="{code}"]').count() == 1, 'the home uses the same card; a tap there joins')
    check(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
print(f'ALL {ok} WHAT\'S ON CHECKS PASSED')
