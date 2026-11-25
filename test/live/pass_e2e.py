# TEST ONLY. The next preview in a browser: the Session Pass is role-aware (passenger, driver, own way) and tells an
# exact pin from an approximate spot; STILL TO SORT OUT lists only what is open; Plan B after a call-off offers the
# same spot later, another spot and another sport the rider rides, and commits nobody; the weekend proposal shows who
# is up which day; the alert form starts from presets with the detail folded away.
import json, os, subprocess, urllib.request, urllib.error
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
ipn = [0]
def rpc(fn, body):
    ipn[0] += 1
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST', headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': f'10.67.{ipn[0] // 200}.{ipn[0] % 200}'})
    try:
        with urllib.request.urlopen(req) as r: return json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return {'error': e.code, **json.loads(e.read() or b'{}')}

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.ride_asks, public.spot_reports, public.events, public.squads, public.squad_members, public.spot_notes, public.wind_alerts cascade; delete from auth.users;")
sql("update app_settings set value = 'true' where key in ('open_posting', 'strict_keys')")
K = {n: rpc('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})['key'] for n in ('ana', 'bo', 'cy', 'di', 'eve', 'jo')}
sql("update signups set first_name = initcap(split_part(email, '@', 1)) where email like '%@example.com'")
def crew(off, host, seats, start='13:00', end='16:00'):
    cid = sql(f"insert into crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email, min_riders) values ('amsterdam','kite','wijk-aan-zee', hi8_today('amsterdam') + {off}, '{start}','{end}','all',6,'cs','11:45','{host}@example.com', 3) returning id").split('\n')[0]
    sql(f"insert into crew_members (crew_id, email, level, getting, seats) values ('{cid}', '{host}@example.com', 'ripper', '{'drive' if seats else 'own'}', {seats})")
    return sql(f"select code from crews where id = '{cid}'")
A = crew(2, 'bo', 2)
for n, g in (('ana', 'seat'), ('cy', 'seat'), ('di', 'own'), ('eve', 'seat')): rpc('hi8_join_crew', {'p_key': K[n], 'p_code': A, 'p_level': 'regular', 'p_getting': g, 'p_seats': 0})
sq = sql("insert into squads (code, name, city, sport, created_by) values ('PASSQ', 'Wijk regulars', 'amsterdam', 'kite', 'jo@example.com') returning id").split('\n')[0]
for n in ('jo', 'bo', 'cy', 'di'): sql(f"insert into squad_members (squad_id, email) values ('{sq}', '{n}@example.com')")
P = crew(-6, 'bo', 3); sql(f"update crews set squad = '{sq}' where code = '{P}'")
for n, days in (('bo', range(1, 7)), ('cy', range(2, 7)), ('di', (3, 4, 5))):
    for d in days: sql(f"insert into ride_asks (email, city, sport, day) values ('{n}@example.com', 'amsterdam', 'kite', hi8_today('amsterdam') + {d})")

def page(br, key):
    c = br.new_context(**{**pw.devices['iPhone 13']}, timezone_id='Europe/Amsterdam')
    pg = c.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(BASE + '/'); pg.evaluate("() => localStorage.clear()")
    pg.evaluate("k => { localStorage.setItem('hi8.me', JSON.stringify({key: k})); localStorage.setItem('hi8.lv.kite', '\"regular\"'); localStorage.setItem('hi8.lv.mtb', '\"regular\"'); }", key)
    return c, pg, errs
txt = lambda pg, sel: pg.locator(sel).first.inner_text() if pg.locator(sel).count() else ''

with sync_playwright() as pw:
    br = pw.chromium.launch()
    print('the pass knows who you are')
    c, pg, errs = page(br, K['ana']); pg.goto(f'{BASE}/?c={A}'); pg.wait_for_timeout(3000)
    t = txt(pg, '#sheet.on .pass')
    check("BO'S CAR" in t and 'YOUR LIFT IS CONFIRMED' in t and 'Bo is driving you, with Cy' in t, 'passenger: seat in Bo\'s car, who drives, who else is in it')
    check('THE SPOT · APPROXIMATE' in t, 'no pin yet: the spot is marked approximate, not a meeting point')
    check('GOOGLE MAPS · PICK-UP' in t and 'CONDITIONS' in t and 'CHAT' in t and 'CALENDAR' in t, 'one big GOOGLE MAPS to the first stop; calendar, conditions and chat next to it')
    todo = txt(pg, '#sheet.on .pass-todo'); crewl = txt(pg, '#sheet.on .pass-crew')
    check('Eve still needs a lift' in todo and 'pin' in todo.lower(), 'STILL TO SORT OUT: Eve\'s lift, the exact pin')
    check('needs a lift' not in crewl and 'pin' not in crewl, 'THE CREW line keeps only the facts (no repeat of the open items)')
    pg.locator('#sheet.on [data-act=tofx]').click(); pg.wait_for_timeout(900)
    check(pg.evaluate("() => { const a = document.getElementById('fxAnchor'), b = document.querySelector('#sheet.on .sh-body'); return !!a && Math.abs(a.getBoundingClientRect().top - b.getBoundingClientRect().top) < 60; }"), 'CONDITIONS scrolls to the forecast')
    check(not errs, 'no page errors'); c.close()
    c, pg, errs = page(br, K['bo']); pg.goto(f'{BASE}/?c={A}'); pg.wait_for_timeout(3000)
    t = txt(pg, '#sheet.on .pass')
    check("YOU'RE DRIVING 2" in t and 'Picking up Ana, Cy' in t and 'Your car is full' in t, 'driver: who you pick up, and that the car is full')
    check('FIND EVE A SEAT' in t, 'the captain\'s one thing to do is on the pass'); c.close()
    c, pg, errs = page(br, K['di']); pg.goto(f'{BASE}/?c={A}'); pg.wait_for_timeout(3000)
    t = txt(pg, '#sheet.on .pass')
    check('YOUR OWN WAY' in t and 'GETTING THERE' in t, 'own way: no pick-up, meet at the spot'); c.close()
    sql(f"update crews set meet_lat = 52.49, meet_lon = 4.59 where code = '{A}'")
    c, pg, errs = page(br, K['ana']); pg.goto(f'{BASE}/?c={A}'); pg.wait_for_timeout(3000)
    check('EXACT PIN' in txt(pg, '#sheet.on .pass') and 'pin' not in txt(pg, '#sheet.on .pass-todo').lower(), 'with the pin dropped: EXACT PIN, and it leaves STILL TO SORT OUT'); c.close()

    print('the weekend proposal')
    c, pg, errs = page(br, K['jo']); pg.goto(BASE + '/'); pg.wait_for_timeout(3500)
    g = txt(pg, '.wk-g')
    check('WHEN ARE WE RIDING?' in g and 'Bo' in g and 'Cy' in g and 'Di' in g, 'who is up which day, by first name, for the people in the kept crew')
    check(pg.locator('.wk-g thead th.pick').count() == 1, 'the proposed day is marked in the grid')
    before = sql('select count(*) from crews')
    pg.locator('[data-act=propose]').click(); pg.wait_for_timeout(1500)
    check(pg.locator('#sheet.on').count() == 1 and sql('select count(*) from crews') == before, 'PROPOSE opens the start form, filled in: nothing is posted yet'); c.close()

    print('Plan B')
    sql(f"update crews set status = 'off', off_reason = 'No wind after all' where code = '{A}'")
    c, pg, errs = page(br, K['ana']); pg.goto(BASE + '/'); pg.wait_for_timeout(3500)
    pb = txt(pg, '.pb')
    check('PLAN B' in pb and pg.locator('.pb-o').count() >= 1, 'after a call-off: Plan B with at least one option')
    n0 = sql('select count(*) from crew_members')
    print('  info · another sport (MTB) offered:', 'yes' if 'MTB INSTEAD' in pb else 'no (not good that day in this forecast)')
    pg.locator('.pb-o').first.click(); pg.wait_for_timeout(1500)
    check(sql('select count(*) from crew_members') == n0 and pg.locator('#sheet.on').count() == 1, 'a Plan B option opens the start form; nobody is moved over'); c.close()

    print('alerts start from presets')
    c, pg, errs = page(br, K['eve']); pg.goto(BASE + '/#alerts'); pg.wait_for_timeout(3000)
    check(pg.locator('[data-act=alpre]').count() == 3 and pg.locator('[data-act=almin]').count() == 0, 'three presets; the wind detail is folded')
    pg.locator('[data-act=alpre][data-v=work]').click(); pg.wait_for_timeout(300)
    check('weekdays' in txt(pg, '.altune') and '17–21' in txt(pg, '.altune'), 'AFTER WORK sets weekdays, 17–21 (shown in the summary line)')
    pg.locator('[data-act=altune]').click(); pg.wait_for_timeout(300)
    check(pg.locator('[data-act=almin]').count() == 5, 'one tap opens the wind detail'); c.close()
    br.close()
print(f'\n{ok} checks passed')
