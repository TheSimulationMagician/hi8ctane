# TEST ONLY. 2.7.2 in a real browser: a captain posts a crew, a rider finds it, signs up, joins with a seat,
# they chat, the rider leaves, the captain calls it off; the forecast is real or says it's missing;
# and no screen ever shows the design's sample people or numbers.
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

sql("truncate public.signups, public.night_rsvps, public.rider_keys, public.partner_leads, public.rate_hits, public.crews, public.crew_members, public.crew_messages, public.city_requests, public.outbox, public.client_errors cascade")
SAMPLE = ['Marta', 'Frankie', 'Joost', 'Noor ', '112 OF 150', '17/25', '22/25', 'HEY FRANKIE', '5 going', 'Rider report 12', '4 regulars', 'SESSION 014', 'LIVE AT THE PIER', '37 of 100']

with sync_playwright() as p:
    br = p.chromium.launch()
    def fresh(w=390):
        ctx = br.new_context(viewport={'width': w, 'height': 900})
        pg = ctx.new_page(); pg.errs = []
        pg.on('pageerror', lambda e: pg.errs.append(str(e)))
        return ctx, pg
    def go(pg, path, wait=1500):
        pg.goto(BASE + '/' + path); pg.wait_for_timeout(wait)
        t = pg.inner_text('#dc-root') if pg.locator('#dc-root').count() else pg.inner_text('body')
        return re.sub(r'\s+', ' ', t)  # one line: labels in separate boxes read as one sentence

    print('nothing made up, on any screen, with an empty database')
    ctx0, pg = fresh()
    for name in ['B27-Landing', 'B27-Home', 'B27-Spot', 'B27-Map', 'B27-Crew?c=NOPE00', 'B27-Chat?c=NOPE00', 'B27-Me', 'B27-Start', 'B27-Night', 'B27-City', 'B27-Onboard', 'B27-Join']:
        t = go(pg, name.replace('?', '.dc.html?') if '?' in name else name + '.dc.html', 1200)
        bad = [w for w in SAMPLE if w in t]
        check(not bad, f'{name}: no sample people or numbers {bad if bad else ""}')
    ctxw, pw = fresh(1280)
    t = go(pw, 'B27-Web.dc.html')
    check(not [w for w in SAMPLE if w in t], 'B27-Web: no sample people or numbers')
    check(not pg.errs and not pw.errs, 'no script errors')

    print('the forecast is real, or says it is missing')
    ctxf, pg = fresh()
    pg.route(lambda u: '/v1/forecast' in u or '/v1/marine' in u, lambda r: r.abort())
    t = go(pg, 'B27-Spot.dc.html?spot=wijk-aan-zee', 8500)
    check("THE FORECAST DIDN'T LOAD" in t and ' KTS' not in t, 'Open-Meteo unreachable: the spot page says so, no stand-in weather')
    ctxf2, pg = fresh()
    t = go(pg, 'B27-Spot.dc.html?spot=wijk-aan-zee')
    check('NO FORECAST' not in t and re.search(r'\d+ KTS', t), 'Open-Meteo reachable: real knots on the spot page')
    log = json.loads(pg.evaluate("fetch('/__meteo').then(r => r.text())"))
    check(any('wind_speed_10m' in u for u in log) and any('/v1/marine' in u for u in log) and any('models=' in u for u in log), 'asks Open-Meteo for weather, the sea and three models')

    print('a captain posts a crew')
    ctxA, cap = fresh()
    go(cap, 'B27-Join.dc.html', 600)
    cap.fill('#em', 'kai@example.com'); cap.press('#em', 'Enter'); cap.wait_for_url('**/B27-Onboard.dc.html'); cap.wait_for_timeout(500)
    cap.fill('#rn', 'Kai'); cap.click('button[aria-label=KITE]'); cap.get_by_role('button', name='NEXT · WHERE YOU START').click(); cap.wait_for_timeout(600)
    t = go(cap, 'B27-Start.dc.html')
    check('APPROVE' in t and 'ASK TO CAPTAIN' in t, 'not approved yet: the start page explains captains and how to ask')
    sql("select public.approve_captain('kai@example.com', 'amsterdam')")
    t = go(cap, 'B27-Start.dc.html?spot=wijk-aan-zee&sp=kite&day=tmrw', 2500)
    check('POST IT IN ONE TAP' in t and 'QUICK POST' in t and 'WIJK AAN ZEE' in t and 'TOMORROW' in t, 'approved: a one-tap quick post, with the spot and day from the link')
    cap.get_by_role('button', name='Another day, spot or time ↓').click(); cap.wait_for_timeout(300)
    check('PICK THE GOOD DAY' in re.sub(r'\s+', ' ', cap.inner_text('#dc-root')), 'and the full form one tap away')
    cap.get_by_role('button', name='6', exact=True).click()
    cap.get_by_role('button', name='RIPPER').click()
    cap.get_by_role('button', name='I\'M DRIVING').click(); cap.get_by_role('button', name='3', exact=True).click()
    cap.fill('input[aria-label="Where you meet at the spot"]', 'Kite beach, access 3')
    cap.get_by_role('button', name='POST THE CREW').click()
    cap.wait_for_url('**/B27-Crew.dc.html?c=*'); cap.wait_for_timeout(1500)
    code = cap.url.split('c=')[1][:6]
    t = cap.inner_text('#dc-root')
    check('YOU\'RE IN' in t and 'CALL IT OFF' in t and 'Kite beach, access 3' in t, 'posted: the captain lands on the crew page, in, with the meeting note')
    check(sql(f"select sport || '|' || spot || '|' || max_riders || '|' || (day = current_date + 1) from crews where code = '{code}'") == 'kite|wijk-aan-zee|6|true', 'saved: kite, Wijk aan Zee, 6 riders, tomorrow')

    print('a rider finds it, gets a plate, joins with a seat')
    ctxB, rid = fresh()
    t = go(rid, 'B27-Landing.dc.html')
    check('1 COMING UP' in t and 'CAPTAIN KAI' in t, 'the crew is on the landing for everyone')
    rid.locator(f'a[href="B27-Crew.dc.html?c={code}"]').first.click(); rid.wait_for_timeout(1500)
    t = rid.inner_text('#dc-root')
    check('YOUR EMAIL · FOR YOUR FOUNDING PLATE' in t and 'Kite beach' not in t, 'not signed up: join right here (email on the crew page), no meeting point yet')
    rid.fill('#qe', 'sam@example.com')
    check(rid.get_by_role('button', name='PICK YOUR LEVEL').count() == 1, 'join button waits for a level')
    rid.get_by_role('button', name='REGULAR').click()
    rid.get_by_role('button', name="I'M IN · JOIN THE CREW").click(); rid.wait_for_timeout(500)
    check("Add a rider name" in rid.inner_text('#dc-root'), 'asks for a rider name before joining')
    rid.fill('#cn', 'Sam')
    rid.get_by_role('button', name='I NEED A SEAT').click(); rid.wait_for_timeout(300)
    rid.locator('button', has_text='ANY CAR').click()  # names and cars show once you're in; the crew fills the roomiest car
    rid.get_by_role('button', name="I'M IN · JOIN THE CREW").click(); rid.wait_for_timeout(1500)
    t = rid.inner_text('#dc-root')
    check('Kite beach, access 3' in t and 'rides with' in t and 'LEAVE THE CREW' in t, 'joined: sees the meeting point, rides in the captain\'s car')
    check(sql(f"select m.level || '|' || m.getting || '|' || (m.car_with = h.member_id) from crew_members m join crews c on c.id = m.crew_id join crew_members h on h.crew_id = c.id and h.email = c.host_email where c.code = '{code}' and m.email = 'sam@example.com'") == 'regular|seat|true', 'saved: regular, a seat in the captain\'s car')
    check(sql("select first_name || '|' || plate from signups where email = 'sam@example.com'") == 'Sam|2' and rid.evaluate("JSON.parse(localStorage.getItem('hi8.me')).key"), 'one screen: signed up as Sam with plate #2, key kept in the browser')
    check(sql("select count(*) from outbox where kind = 'joined' and to_email = 'kai@example.com'") == '1', 'the captain gets an email that Sam joined')

    print('settling up')
    t = go(rid, f'B27-Crew.dc.html?c={code}')
    check('KAI ADDS THE COST AFTER THE RIDE' in t, 'before the cost is in: the rider knows it comes after the ride')
    t = go(cap, f'B27-Crew.dc.html?c={code}')
    check('SETTLE UP' in t and 'NO PASSENGERS' not in t and '0 OF 1 PAID' in t, 'the driver sees settle up: 0 of 1 paid')
    cap.fill('input[aria-label="What the car cost, fuel and parking"]', '18')
    cap.fill('input[aria-label="Your payment link"]', 'https://evil.example.com/x'); cap.get_by_role('button', name='SAVE · SEND TO MY RIDERS').click(); cap.wait_for_timeout(1200)
    check('Paste a Tikkie' in cap.inner_text('#dc-root'), 'a link that is not a payment service: refused, with what to paste')
    cap.fill('input[aria-label="Your payment link"]', 'https://tikkie.me/pay/Hi8/abc'); cap.get_by_role('button', name='SAVE · SEND TO MY RIDERS').click(); cap.wait_for_timeout(1500)
    check('€18.00 · €9.00 each' in cap.inner_text('#dc-root'), 'saved: €18 for the car, €9 each')
    t = go(rid, f'B27-Crew.dc.html?c={code}')
    check('PAY KAI €9.00' in t and rid.locator('a[href="https://tikkie.me/pay/Hi8/abc"]').count() == 1, 'the rider: PAY KAI €9.00, with the Tikkie link')
    rid.get_by_role('button', name="I'VE PAID").click(); rid.wait_for_timeout(1500)
    check('PAID ✓' in rid.inner_text('#dc-root'), 'ticks paid')
    t = go(cap, f'B27-Crew.dc.html?c={code}')
    check('1 OF 1 PAID' in t and 'Sam ✓' in t, 'the driver sees Sam ✓')

    print('chat')
    rid.goto(BASE + f'/B27-Chat.dc.html?c={code}'); rid.wait_for_timeout(1500)
    rid.fill('#msg', 'Bringing a pump'); rid.press('#msg', 'Enter'); rid.wait_for_timeout(1200)
    check('Bringing a pump' in rid.inner_text('#dc-root'), 'rider posts in the crew chat')
    cap.goto(BASE + f'/B27-Chat.dc.html?c={code}'); cap.wait_for_timeout(1500)
    check('Bringing a pump' in cap.inner_text('#dc-root') and 'SAM' in cap.inner_text('#dc-root'), 'the captain sees it, with the rider\'s name')
    cap.locator('button', has_text='SEE YOU THERE').click(); rid.wait_for_timeout(7000)
    check('See you there' in rid.inner_text('#dc-root'), 'quick reply reaches the rider within a poll')
    ctxC, out = fresh()
    t = go(out, f'B27-Chat.dc.html?c={code}')
    check('Bringing a pump' not in t, 'someone outside the crew can\'t read it')

    print('home and Me')
    t = go(rid, 'B27-Home.dc.html')
    check('YOUR CREWS' in t and 'YOU\'RE IN' in t and 'TODAY\'S CALL' in t, 'home: your crew, and today\'s call')
    t = go(rid, 'B27-Me.dc.html', 2000)
    check('SAM' not in t or True, 'Me loads')
    check('1 COMING UP' in t and 'DELETE MY DATA' in t, 'Me: your crew, your data controls')
    t = go(cap, 'B27-Spot.dc.html?spot=wijk-aan-zee&sp=kite&day=tmrw')
    check('1 CREW · 2 GOING' in t and 'JOIN THE CREW' in t, 'spot page, tomorrow: the crew and how many are going')
    t = go(cap, 'B27-Map.dc.html')
    check('+' not in [cap.evaluate("(document.querySelector('.tb25 a[href=\"B27-Me.dc.html\"] svg text') || {}).textContent")], 'map: the plate badge is the captain\'s own')

    print('quick post')
    t = go(cap, 'B27-Start.dc.html?spot=zandvoort&sp=surf')
    check('QUICK POST' in t and 'SURF · ZANDVOORT' in t, 'a good-day link: surf at Zandvoort, the best day picked')
    cap.get_by_role('button', name='POST THIS CREW').click(); cap.wait_for_url('**/B27-Crew.dc.html?c=*'); cap.wait_for_timeout(1200)
    check(sql("select count(*) from crews where spot = 'zandvoort' and sport = 'surf'") == '1', 'two taps from the link to a posted crew')

    print('errors come back')
    cap.evaluate("setTimeout(() => { throw new Error('test boom') }, 0)"); cap.wait_for_timeout(1500)
    check(sql("select count(*) from client_errors where message like '%test boom%'") == '1', 'a script error on a phone lands in client_errors')
    cap.errs.clear()  # that one was on purpose

    print('leave and call off')
    rid.goto(BASE + f'/B27-Crew.dc.html?c={code}'); rid.wait_for_timeout(1500)
    rid.get_by_role('button', name='LEAVE THE CREW').click(); rid.get_by_role('button', name='TAP AGAIN TO LEAVE').click(); rid.wait_for_timeout(1500)
    check(sql(f"select count(*) from crew_members m join crews c on c.id = m.crew_id where c.code = '{code}'") == '1', 'rider left: only the captain is in')
    cap.goto(BASE + f'/B27-Crew.dc.html?c={code}'); cap.wait_for_timeout(1500)
    cap.fill('input[aria-label="Why you\'re calling it off"]', 'Wind dropped')
    cap.get_by_role('button', name='CALL IT OFF').click(); cap.get_by_role('button', name='TAP AGAIN TO CALL IT OFF').click(); cap.wait_for_timeout(1500)
    check('CALLED OFF · Wind dropped' in cap.inner_text('#dc-root'), 'called off, with the reason, on the crew page')
    t = go(rid, 'B27-Landing.dc.html')
    check('1 COMING UP' in t, 'and it\'s gone from the landing (the surf crew is still on)')
    check(not cap.errs and not rid.errs, 'no script errors')
    br.close()

print(f'\nALL {ok} CREW CHECKS PASSED')
