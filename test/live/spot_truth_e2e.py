# TEST ONLY. 0030 in a browser: what riders at the spot say shows on the cards and on the open card; reporting from
# the spot (location shared once, refused when far away); "open to new riders" on I'M UP FOR A RIDE and for a captain.
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

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.ride_asks, public.spot_reports cascade")
K = {n: rpc('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})['key'] for n in ('ana', 'bo')}
lat, lon = [float(x) for x in sql("select lat || ',' || lon from public.spots where slug = 'wijk-aan-zee'").split(',')]
sql("insert into public.spot_reports (spot, sport, email, verdict, wind, gusts, water, crowd, kite, level, how, at) values "
    "('wijk-aan-zee','kite','x1@example.com','on','stronger','gusty','chop','busy',9,'regular','location', now() - interval '25 minutes'),"
    "('wijk-aan-zee','kite','x2@example.com','on','stronger','steady','chop','busy',10,'ripper','checkin', now() - interval '9 minutes'),"
    "('wijk-aan-zee','kite','x3@example.com','meh','as_forecast','gusty','waves',null,12,'regular','location', now() - interval '40 minutes')")

with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    def phone(key=None, geo=None):
        c = b.new_context(viewport={'width': 390, 'height': 844}, timezone_id='Europe/Amsterdam', geolocation=geo, permissions=['geolocation'] if geo else [])
        pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '/'); pg.wait_for_timeout(200)
        if key: pg.evaluate("k => localStorage.setItem('hi8.me', JSON.stringify({key: k}))", key)
        return pg

    print('what riders at the spot say')
    V = phone(); V.goto(BASE + '/#spot/wijk-aan-zee'); V.wait_for_selector('.c2live', timeout=8000); V.wait_for_timeout(500)
    t = V.inner_text('.c2live').upper()
    check('AT THE SPOT NOW' in t and '2 OF 3 RIDERS SAY ON' in t, 'the open card: AT THE SPOT NOW · 2 OF 3 RIDERS SAY ON')
    check('STRONGER THAN FORECAST' in t and 'ON 9, 10, 12 M' in t and '1 CHECKED IN WITH A CREW' in t and '2 BY LOCATION' in t, '...the wind against the forecast, the kites, and how each was checked')
    check('EXAMPLE.COM' not in V.inner_text('#sheet').upper(), '...no names, no emails')
    V.goto(BASE + '/'); V.wait_for_timeout(2500)
    strip = V.locator('#sessions .ad.k2 .k2live')
    check(strip.count() >= 1 and 'LIVE · ON' in strip.first.inner_text().upper() and '3 RIDERS AT THE SPOT' in strip.first.inner_text().upper(), "a card for today at that spot: LIVE · ON · 3 riders at the spot")
    check('LIVE FROM 1 SPOT' in V.inner_text('#sessions .hb-h').upper(), 'the cards header: LIVE FROM 1 SPOT · LAST REPORT …')

    print('reporting')
    far = phone(K['ana'], {'latitude': lat + 0.2, 'longitude': lon})
    far.goto(BASE + '/#spot/wijk-aan-zee'); far.wait_for_selector('.c2live [data-act=spotrep]', timeout=8000)
    far.locator('[data-act=spotrep]').click(); far.wait_for_selector('[data-act=rfsend]')
    check(far.locator('[data-act=rfsend][disabled]').count() == 1, 'SEND waits for ON, MEH or OFF')
    far.locator('[data-act=rfset][data-k=verdict][data-v=off]').click(); far.locator('[data-act=rfsend]').click(); far.wait_for_selector('#sheet .err', timeout=8000)
    check('MORE THAN 2 KM' in far.inner_text('#sheet .err').upper() and sql("select count(*) from spot_reports where lower(email) = 'ana@example.com'") == '0', '22 km away: refused, nothing saved')
    near = phone(K['bo'], {'latitude': lat + 0.004, 'longitude': lon})
    near.goto(BASE + '/#report/wijk-aan-zee'); near.wait_for_selector('[data-act=rfsend]', timeout=8000)
    for k, v in (('verdict', 'on'), ('wind', 'stronger'), ('gusts', 'steady'), ('water', 'flat'), ('kite', '9'), ('crowd', 'quiet')):
        near.locator(f'[data-act=rfset][data-k={k}][data-v="{v}"]').click()
    near.locator('[data-act=rfsend]').click(); near.wait_for_selector('.c2live', timeout=8000); near.wait_for_timeout(500)
    check(sql("select verdict || '|' || wind || '|' || water || '|' || kite::int || '|' || how from spot_reports where lower(email) = 'bo@example.com'") == 'on|stronger|flat|9|location', 'Bo at the beach: sent with his location (compared, not kept)')
    check('3 OF 4 RIDERS SAY ON' in near.inner_text('.c2live').upper(), '...and he is back on the open card, with his answer counted')

    print('open to new riders')
    L = phone(K['ana']); L.goto(BASE + '/#looking'); L.wait_for_selector('[data-act=lkopen]', timeout=8000)
    check(L.locator('[data-act=lkopen][data-v="0"][aria-pressed=true]').count() == 1, "I'M UP FOR A RIDE: ONLY MY CREWS unless you say so")
    L.locator('.lkdays .opt').nth(1).click(); L.locator('[data-act=lkopen][data-v="1"]').click(); L.locator('[data-act=lksave]').click(); L.wait_for_timeout(2000)
    check(sql("select bool_and(open_new)::text from ride_asks where email = 'ana@example.com'") == 'true', 'YES, COUNT ME IN: saved as open')
    cid = sql("insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, host_email) values ('amsterdam','kite','wijk-aan-zee', hi8_today('amsterdam') + 2, '13:00','17:00','all',6,'bo@example.com') returning code").splitlines()[0]
    sql(f"insert into public.crew_members (crew_id, email, level, getting, seats) select id, 'bo@example.com', 'regular', 'own', 0 from public.crews where code = '{cid}'")
    C = phone(K['bo']); C.goto(BASE + f'/?c={cid}'); C.wait_for_selector('[data-act=crewopen]', timeout=10000)
    check(C.locator('[data-act=crewopen][data-v="1"][aria-pressed=true]').count() == 1, 'the captain: OPEN TO NEW RIDERS? YES by default')
    C.locator('[data-act=crewopen][data-v="0"]').click(); C.wait_for_timeout(1200)
    check(sql(f"select open_new::text from crews where code = '{cid}'") == 'false', 'ONLY OUR CREW: saved')
    check(not errs, 'no page errors ' + str(errs[:2]))
    b.close()
print(f'ALL {ok} SPOT TRUTH APP CHECKS PASSED')
