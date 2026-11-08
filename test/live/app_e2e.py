# TEST ONLY. The 2.8 app (site/index.html) in a real browser against Postgres + PostgREST and the stand-in
# Open-Meteo: the live map, the two options (start a crew, join a crew) for people with no account, sharing,
# the duplicate warning, the crew chat, settling up with Bizum, checking in and reporting, alerts and the stop
# link, Me, the spot forecast tables, old links, the desktop layout, the landing iterations, no forecast.
import json, os, re, subprocess, datetime
from playwright.sync_api import sync_playwright

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
def txt(pg, sel='body'): return re.sub(r'\s+', ' ', pg.inner_text(sel)).upper()  # headings are upper-cased by CSS

sql("truncate public.signups, public.night_rsvps, public.rider_keys, public.crews, public.crew_members, public.crew_messages, public.rate_hits, public.outbox, public.spot_reports, public.crew_alerts cascade")
sql("update public.app_settings set value = 'true' where key = 'open_posting'")

with sync_playwright() as p:
    br = p.chromium.launch()
    def fresh(w=390, h=844):
        ctx = br.new_context(viewport={'width': w, 'height': h}, accept_downloads=True)
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.abort())  # no internet here
        pg = ctx.new_page(); pg.errs = []
        pg.on('pageerror', lambda e: pg.errs.append(str(e)))
        return ctx, pg

    print('the landing: live map, forecast, two options')
    ctxA, A = fresh()
    A.goto(BASE + '/?ref=kaiwave')
    A.wait_for_selector('.map-canvas'); A.wait_for_timeout(2500)
    check(A.locator('.dock .big.join').inner_text() == 'JOIN A CREW' and A.locator('.dock .big.start').inner_text() == 'START A CREW', 'two options, always on screen')
    check([x.inner_text() for x in A.locator('.sports .sp[data-act=sport]').all()] == ['KITE', 'MTB', 'MX'] and 'SOON' in A.locator('.sports .soon').inner_text(), 'kite, MTB and MX live; the rest coming soon')
    check('BARCELONA' in A.locator('.city').inner_text().upper() and 'PILOT' in A.locator('.city').inner_text(), 'opens on Barcelona, the pilot')
    px = A.evaluate("""(() => { const c = document.querySelector('.map-canvas'), x = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, seen = new Set();
                        for (let i = 0; i < x.length; i += 4 * 997) seen.add(x[i] >> 4 << 8 | x[i + 1] >> 4 << 4 | x[i + 2] >> 4); return seen.size; })()""")
    check(px > 25, f'the map is drawn: wind colours, coast, spots ({px} colours)')
    check('KITE FORECAST'.upper() in txt(A, '#best') and 'AROME'.upper() in txt(A, '#best') and ('BEST WINDOW'.upper() in txt(A, '#best') or 'No good'.upper() in txt(A, '#best')), 'the forecast: the sharp model, the best window')
    check('No Kite crews yet in Barcelona'.upper() in txt(A, '#crews'), 'no crews yet: says so, and offers to start the first')
    check(json.loads(A.evaluate("localStorage.getItem('hi8.src')"))['ref'] == 'kaiwave', 'the ref code from the link is kept')

    print('START A CREW, as someone with no account')
    A.locator('.dock .big.start').click()
    A.wait_for_selector('#sheet.on'); A.wait_for_timeout(300)
    check('START A CREW'.upper() in txt(A, '#shTitle') and 'WHEN'.upper() in txt(A, '#sheet') and 'WHERE'.upper() in txt(A, '#sheet'), 'one screen: sport, when, where, how you get there, you')
    first_when = A.locator('[data-act=sfwin]').first
    check(first_when.count() == 1 and first_when.get_attribute('aria-pressed') == 'true', 'the best window from the forecast is picked for you')
    check(A.locator('[data-act=sfspot]').first.get_attribute('aria-pressed') == 'true', 'and the best spot for it')
    A.locator('[data-act=sfspot][data-spot=castelldefels]').click()
    check('Castelldefels'.upper() in txt(A, '#sheet') and 'marked zones'.upper() in txt(A, '#sheet'), "the spot's rules show under it")
    check(A.locator('[data-act=sfget][data-v=drive]').get_attribute('aria-pressed') == 'true' and A.locator('[data-act=sfhub][aria-pressed=true]').count() == 1, 'driving, from the nearest pick-up point')
    meet = A.input_value('#sfMeet')
    check(re.match(r'^\d\d:\d\d$', meet or '') is not None, f'leaving time set from the drive time ({meet})')
    check(A.locator('[data-act=sflevels]').count() == 1 and 'RIDERS WHO RIDE SOLO'.upper() in txt(A, '#sheet'), 'not a captain: crews for riders who ride solo')
    A.locator('.sh-foot .big.start').click(); A.wait_for_timeout(300)
    check('Add your email'.upper() in txt(A, '#sheet'), 'no email: says so, nothing posted')
    A.fill('#sfEmail', 'Kai@Example.com'); A.fill('#sfName', 'Kai'); A.fill('#sfNote', 'Bring a 9')
    A.locator('.sh-foot .big.start').click()
    A.wait_for_selector('text=YOUR CREW IS UP', timeout=8000)
    wa = A.locator('a.big.wa').get_attribute('href')
    msg = __import__('urllib.parse').parse.unquote(wa.split('text=', 1)[1])
    code = re.search(r'\?c=([A-Z0-9]{6})', msg).group(1)
    check(wa.startswith('https://wa.me/?text=') and 'KITE CREW' in msg and '📍 Castelldefels' in msg and 'seats free' in msg and 'Join in one tap: ' + BASE + '/?c=' + code in msg,
          'posted: a WhatsApp message with the spot, the time, the wind, the seats and the link')
    check(sql(f"select s.plate || '|' || s.source || '|' || s.ref || '|' || c.note from crews c join signups s on lower(s.email) = c.host_email where c.code = '{code}'") == '1|start|kaiwave|Bring a 9',
          'one go: signed up with plate #1 (and the ref), crew posted')
    check(A.locator('.plate').inner_text() == '#001', 'the plate shows in the top bar')

    print('the same crew again')
    A.locator('[data-act=crew]').last.click(); A.wait_for_selector('#sheet .hero', timeout=8000); A.wait_for_timeout(500)
    check('KITE CREW'.upper() in txt(A, '#shTitle') and 'Kai · captain · you'.upper() in txt(A, '#sheet'), 'the captain sees the crew, with names')
    A.locator('[data-act=close]').click()
    A.locator('.dock .big.start').click(); A.wait_for_timeout(300)
    A.locator('[data-act=sfspot][data-spot=castelldefels]').click()
    A.locator('.sh-foot .big.start').click(); A.wait_for_selector('#dup', timeout=6000)
    check('Already up'.upper() in txt(A, '#dup') and 'CASTELLDEFELS' in txt(A, '#dup') and A.locator('#dup [data-act=crew]').get_attribute('data-code') == code, 'warned, with a JOIN IT that opens the existing one')
    A.locator('[data-act=close]').click()

    print('JOIN A CREW from the shared link, no account')
    ctxB, B = fresh()
    B.goto(BASE + '/?c=' + code); B.wait_for_selector('#sheet .hero', timeout=8000); B.wait_for_timeout(500)
    t = txt(B, '#sheet')
    check('CASTELLDEFELS'.upper() in t and '1/8'.upper() in t and 'Names, cars and the chat are for the crew'.upper() in t, 'the crew: spot, time, who is going, no names for outsiders')
    check(B.locator('.hcell').count() >= 2 or 'forecast reaches 3 days'.upper() in t, 'the hour-by-hour forecast for its window')
    B.locator('.sh-foot .big.join').click(); B.wait_for_selector('#joinForm')
    check(B.locator('[data-act=jflevel]').count() == 2 and 'LEARNING'.upper() not in txt(B, '#joinForm'), 'a crew for riders who ride solo: no learner option')
    B.locator('[data-act=jfget][data-v=seat]').click()
    B.fill('#jfEmail', 'sam@example.com'); B.fill('#jfName', 'Sam')
    B.locator('#joinForm [data-act=jfgo]').click()
    B.wait_for_selector('#chatBox', timeout=8000)
    check("You're in: founding plate #002".upper() in txt(B, '#toast'), "in, with founding plate #002, on the same screen")
    check('rides with Kai'.upper() in txt(B, '#sheet') and 'MEETING POINT'.upper() in txt(B, '#sheet'), "Sam sees the meeting point and rides in Kai's car")
    B.fill('#chatIn', 'On my way, 5 min late'); B.press('#chatIn', 'Enter'); B.wait_for_timeout(1500)
    check('On my way'.upper() in txt(B, '#chatBox'), 'Sam writes in the crew chat')
    A.goto(BASE + '/?c=' + code); A.wait_for_selector('#chatBox', timeout=8000); A.wait_for_timeout(2500)
    check('On my way'.upper() in txt(A, '#chatBox') and 'Sam is in'.upper() in txt(A, '#chatBox'), 'Kai sees it (and that Sam joined)')

    print('settling up with Bizum')
    A.fill('#payCost', '16'); A.fill('#payBizum', '612 345 678'); A.locator('[data-act=settle]').click(); A.wait_for_timeout(1200)
    check(sql(f"select m.bizum || '|' || m.trip_cost from crew_members m join crews c on c.id = m.crew_id where c.code = '{code}' and m.getting = 'drive'") == '+34612345678|16.00', 'Kai saves €16 and his Bizum')
    B.reload(); B.wait_for_selector('text=YOUR SHARE', timeout=8000)
    check('€8.00'.upper() in txt(B, '#sheet') and 'BIZUM 612 345 678'.upper() in txt(B, '#sheet'), 'Sam sees €8.00 and the Bizum number to copy')
    B.locator('[data-act=paid]').click(); B.wait_for_timeout(1000)
    check('PAID'.upper() in txt(B, '#sheet') and sql(f"select count(*) from crew_members m join crews c on c.id = m.crew_id where c.code = '{code}' and paid_at is not null") == '1', "Sam ticks I'VE PAID")

    print('at the spot')
    sql(f"update crews set day = hi8_today(city), start_time = (hi8_city_now(city) - interval '10 minutes')::time, end_time = null where code = '{code}'")
    B.reload(); B.wait_for_selector("text=I'M AT THE SPOT", timeout=8000)
    B.locator('[data-act=checkin]').click(); B.wait_for_selector("text=YOU'RE THERE", timeout=6000)
    B.locator('[data-act=rkite][data-v="9"]').click(); B.locator('[data-act=report][data-v=on]').click(); B.wait_for_timeout(1200)
    check(sql("select verdict || '|' || kite from spot_reports") == 'on|9.0', 'Sam checks in and reports ON on a 9')
    ctxC, C = fresh()
    C.goto(BASE + '/'); C.wait_for_timeout(2500)
    check('AT THE SPOTS NOW'.upper() in txt(C, '#live') and 'Castelldefels'.upper() in txt(C, '#live') and 'on a 9'.upper() in txt(C, '#live') and 'Sam'.upper() not in txt(C, '#live'), 'everyone sees it on the landing, without the name')
    check('CREW ON NOW'.upper() in txt(C, '#mapnote'), 'the map says a crew is on now')
    check('LIVE NOW'.upper() in txt(C, '#crews'), 'the crew card says LIVE NOW')

    print('alerts and the stop link')
    C.locator('.sports [data-sport=mx]').click(); C.wait_for_timeout(400)
    check('No MX crews yet'.upper() in txt(C, '#crews'), 'MX: nothing yet')
    C.fill('#alertEmail', 'noor@example.com'); C.locator('#crews form button').click(); C.wait_for_timeout(1500)
    check('founding plate #003'.upper() in txt(C, '#toast') and sql("select sport from crew_alerts where email = 'noor@example.com'") == 'mx', 'one email: plate #003 and an MX alert')
    check('STOP THESE EMAILS'.upper() in txt(C, '#crews'), 'and the button now offers to stop them')
    tok = sql("select token from crew_alerts where email = 'noor@example.com'")
    C.goto(BASE + '/?stop=' + tok); C.wait_for_timeout(1500)
    check('Stopped'.upper() in txt(C, '#toast') and sql("select count(*) from crew_alerts where email = 'noor@example.com'") == '0', 'the stop link stops them')

    print('Me')
    B.goto(BASE + '/#me'); B.wait_for_selector('#sheet.on'); B.wait_for_timeout(1500)
    t = txt(B, '#sheet')
    check('#002'.upper() in t and 'Sam'.upper() in t and 's•••@example.com'.upper() in t, 'plate, name, a hint of the email')
    B.locator('#sheet [data-act=alert][data-sport=kite]').click(); B.wait_for_timeout(1000)
    check(sql("select sport from crew_alerts where email = 'sam@example.com'") == 'kite', 'switches on the kite alert')
    B.fill('#kgIn', '90'); B.press('#kgIn', 'Tab'); B.wait_for_timeout(300)
    check(B.evaluate("localStorage.getItem('hi8.kg')") == '90', 'weight for the kite size stays on the phone')

    print('the spot forecast')
    C.goto(BASE + '/#spot/castelldefels'); C.wait_for_selector('table.fx'); C.wait_for_timeout(300)
    t = txt(C, '#sheet')
    check('WIND KT · AROME'.upper() in t and 'ECMWF'.upper() in t and 'GFS'.upper() in t and 'GUSTS'.upper() in t and 'KITE M'.upper() in t and 'WAVES M'.upper() in t, 'kite: hourly wind, gusts, direction, 4 models, waves, kite size')
    C.goto(BASE + '/#spot/vallgorguina-mx'); C.wait_for_timeout(600)
    t = txt(C, '#sheet')
    check('GROUND'.upper() in t and 'RAIN 24H'.upper() in t and 'C-61'.upper() in t, 'MX: the ground from the last 24 h of rain, and the track notes')

    print('old links')
    C.goto(BASE + '/B27-Crew.dc.html?c=' + code); C.wait_for_url('**/?c=' + code); C.wait_for_selector('#sheet.on')
    check('KITE CREW'.upper() in txt(C, '#shTitle'), 'an old crew link (emails, chats) opens the crew')
    C.goto(BASE + '/B27-Start.dc.html?spot=trabucador&sp=kite'); C.wait_for_url(re.compile(r'.*\?spot=trabucador&sport=kite#start$')); C.wait_for_timeout(800)
    check(C.locator('[data-act=sfspot][data-spot=trabucador]').get_attribute('aria-pressed') == 'true', 'an old start link opens START with that spot')
    C.goto(BASE + '/join?ref=pinkflyer'); C.wait_for_url(re.compile(r'.*/\?ref=pinkflyer#join$')); C.wait_for_timeout(500)
    check('JOIN A CREW'.upper() in txt(C, '#shTitle'), 'hi8ctane.com/join opens JOIN A CREW')

    print('desktop and the landing iterations')
    ctxD, D = fresh(1440, 900)
    D.goto(BASE + '/'); D.wait_for_timeout(2000)
    m, pnl = D.locator('.mapwrap').bounding_box(), D.locator('.panel').bounding_box()
    check(m['x'] == 0 and m['width'] > 900 and pnl['x'] >= 990 and m['height'] > 800, 'computer: the map fills the left, the app on the right')
    ctxV, V = fresh()
    V.goto(BASE + '/?v=crews'); V.wait_for_timeout(1500)
    check(V.locator('#crews').bounding_box()['y'] < V.locator('.mapwrap').bounding_box()['y'], '?v=crews: crews first')
    V.goto(BASE + '/?v=forecast'); V.wait_for_timeout(1500)
    check(V.locator('#best').bounding_box()['y'] < V.locator('.mapwrap').bounding_box()['y'], '?v=forecast: forecast first')

    print('no forecast')
    ctxN, N = fresh()
    N.route(re.compile(r'.*/v1/(forecast|marine).*'), lambda r: r.abort())
    N.goto(BASE + '/'); N.wait_for_timeout(2500)
    check('No forecast right now'.upper() in txt(N, '#best') and 'KITE CREWS'.upper() in txt(N, '#crews') and not N.errs, 'Open-Meteo down: says so, crews still work, nothing breaks')

    for name, pg in (('A', A), ('B', B), ('C', C), ('D', D), ('V', V)):
        check(not pg.errs, f'no script errors ({name}): {pg.errs[:2]}')
    br.close()
print(f'\nALL {ok} APP CHECKS PASSED')
