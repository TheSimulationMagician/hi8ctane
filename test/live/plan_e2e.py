# TEST ONLY. 2.30 in a browser: YOUR NEXT SESSION on the landing (stages, the lift, the meeting point), the captain's
# exact pin, a move asking STILL IN?, the captain handing it over and the next rider keeping it on.
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
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST', headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': '10.6.2.2'})
    with urllib.request.urlopen(req) as r: return json.loads(r.read() or b'null')

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.ride_asks, public.spot_reports cascade")
K = {n: rpc('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})['key'] for n in ('ana', 'bo', 'cy', 'di')}
sql("update signups set first_name = initcap(split_part(email, '@', 1)) where email like '%@example.com'")
cid = sql("insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email, min_riders) values ('amsterdam','kite','wijk-aan-zee', hi8_today('amsterdam') + 2, '13:00','16:00','regular',6,'cs','11:45','bo@example.com', 3) returning id").split('\n')[0]
sql(f"insert into public.crew_members (crew_id, email, level, getting, seats) values ('{cid}', 'bo@example.com', 'ripper', 'drive', 3)")
code = sql(f"select code from public.crews where id = '{cid}'")
for n, g in (('ana', 'seat'), ('cy', 'own'), ('di', 'own')): rpc('hi8_join_crew', {'p_key': K[n], 'p_code': code, 'p_level': 'regular', 'p_getting': g, 'p_seats': 0})
lat, lon = [float(x) for x in sql("select lat || ',' || lon from spots where slug = 'wijk-aan-zee'").split(',')]

with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    def phone(key=None, **kw):
        c = b.new_context(**p.devices['iPhone 13'], timezone_id='Europe/Amsterdam', **kw); pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '/'); pg.wait_for_timeout(300)
        if key: pg.evaluate("k => localStorage.setItem('hi8.me', JSON.stringify({key: k}))", key)
        return pg
    T = lambda pg, sel: pg.locator(sel).inner_text().upper() if pg.locator(sel).count() else ''

    print('your next session')
    N = phone()
    N.goto(BASE + '/'); N.wait_for_timeout(2500)
    check(N.locator('#next').is_hidden(), 'not signed in: no next-session card')
    A = phone(K['ana'])
    A.goto(BASE + '/'); A.wait_for_timeout(4000)
    t = T(A, '#next')
    check('YOUR NEXT SESSION' in t and 'WIJK AAN ZEE' in t and '13:00–16:00' in t, 'Ana sees her next session first: the spot, the day, the window')
    check('CREW CONFIRMED' in t and A.locator('#next .stg li.now').inner_text().upper().replace('\n', ' ') == 'CREW CONFIRMED', '4 in, the minimum is 3: CREW CONFIRMED, not more')
    check('YOUR LIFT' in t and 'BO DRIVES' in t and 'CENTRAAL AT 11:45' in t, 'her lift: Bo drives, from Centraal at 11:45')
    check('4 RIDERS' in t and A.locator('#next .nx-go').get_attribute('href') == f'?c={code}', 'the crew, and SESSION PLAN opens it')
    sql(f"select public.hi8_recheck('{code}', true, 21, '21 kt WSW at 13:00, EPIC')")
    A.goto(BASE + '/'); A.wait_for_timeout(3500)
    check('RECHECKED' in T(A, '#next .nx-tag') and '21 KT WSW' in T(A, '#next .stg'), 'after the worker rechecks: RECHECKED, with the time and what it found')

    print("the captain's pin")
    B = phone(K['bo'], geolocation={'latitude': lat + 0.003, 'longitude': lon + 0.002}, permissions=['geolocation'])
    B.goto(BASE + f'/?c={code}'); B.wait_for_selector('#sheet.on'); B.wait_for_timeout(2500)
    B.locator('[data-act=pin]').click(); B.wait_for_timeout(2500)
    check(sql(f"select round(meet_lat::numeric, 3)::text from crews where code = '{code}'") == f'{round(lat + 0.003, 3):.3f}', 'Bo at the beach entrance: DROP THE PIN WHERE I AM')
    A.goto(BASE + '/'); A.wait_for_timeout(3500)
    check('EXACT PIN FROM THE CAPTAIN' in T(A, '#next') and abs(float((A.locator('#next .pl-a').first.get_attribute('href') or '=0,').split('=')[-1].split(',')[0]) - (lat + 0.003)) < 1e-4, 'Ana sees the exact pin, MAP opens it · ' + str(A.locator('#next .pl-a').first.get_attribute('href')) + ' · ' + T(A, '#next .pl')[:120])

    print('moved: still in?')
    rpc('hi8_move_crew', {'p_key': K['bo'], 'p_code': code, 'p_day': sql("select (hi8_today('amsterdam') + 3)::text"), 'p_start': '14:00', 'p_end': '17:00'})
    A.goto(BASE + '/'); A.wait_for_timeout(3500)
    check('STILL IN?' in T(A, '#next .pask'), 'Bo moves it: Ana is asked STILL IN?')
    check('PROPOSED' in T(A, '#next .nx-tag'), '3 riders unsure, only Bo sure: back to PROPOSED until they say')
    A.locator('#next [data-act=stillin]').click(); A.wait_for_timeout(2000)
    check(sql(f"select unsure::text from crew_members m join crews c on c.id = m.crew_id where c.code = '{code}' and m.email = 'ana@example.com'") == 'false' and A.locator('#next .pask').count() == 0, 'STILL IN: saved, the question goes away')

    print('the captain hands it over')
    B.goto(BASE + f'/?c={code}'); B.wait_for_selector('#sheet.on'); B.wait_for_timeout(2500)
    B.locator('[data-act=stepdown]').click(); B.wait_for_timeout(300); B.locator('[data-act=stepdown]').click(); B.wait_for_timeout(2500)
    asked = sql(f"select split_part(host_email, '@', 1) || '|' || (captain_until is not null) from crews where code = '{code}'")
    check(asked.endswith('|true') and asked.split('|')[0] in ('ana', 'cy', 'di'), "I CAN'T MAKE IT: HAND IT OVER (tap twice): the next rider is asked · " + asked)
    X = phone(K[asked.split('|')[0]])
    X.goto(BASE + f'/?c={code}'); X.wait_for_selector('#sheet.on'); X.wait_for_timeout(2500)
    check('YOU\'RE NEXT IN LINE TO CAPTAIN' in T(X, '#sheet .pask') and 'CAPTAIN NEEDED' in T(X, '#sheet .stg') and 'CAPTAIN NEEDED' in T(X, '#sheet .hero'), 'they see KEEP IT ON / PASS IT ON, and CAPTAIN NEEDED')
    X.locator('#sheet [data-act=captain][data-v="1"]').click(); X.wait_for_timeout(2000)
    check(sql(f"select split_part(host_email, '@', 1) || '|' || (captain_until is null) from crews where code = '{code}'") == asked.split('|')[0] + '|true', 'KEEP IT ON: they are the captain, it is on')
    check(not errs, 'no script errors: ' + '; '.join(errs)[:300])
    b.close()
print(f'\nALL {ok} SESSION PLAN APP CHECKS PASSED')
