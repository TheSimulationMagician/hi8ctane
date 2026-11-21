# TEST ONLY. 2.25: the live map with a thumb. One finger scrolls the page, two move the map; days show which is good;
# the hours are buttons; a spot opens a card under the map with the window and the crews: hop on, or start one.
import json, os, subprocess
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

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.spot_reports cascade")
sql("insert into public.signups (email, city, source) values ('ana@example.com', 'amsterdam', 'test')")
sql("insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email, code) values ('amsterdam','kite','zandvoort', hi8_today('amsterdam') + 2, '13:00','17:00','all',6,'cs','11:45','ana@example.com','MAPC01')")
sql("insert into public.crew_members (crew_id, email, level, getting, seats) select id, 'ana@example.com', 'regular', 'drive', 3 from crews where code = 'MAPC01'")

with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(**p.devices['iPhone 13'], timezone_id='Europe/Amsterdam'); pg = c.new_page(); errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    cdp = c.new_cdp_session(pg)
    pg.goto(BASE + '/'); pg.wait_for_timeout(4500)
    top = pg.evaluate("document.querySelector('.mapsec').getBoundingClientRect().top + scrollY")
    pg.evaluate("y => scrollTo(0, y - 60)", top); pg.wait_for_timeout(800)
    r = pg.evaluate("(() => { const r = document.querySelector('#map').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()")
    touch = lambda kind, pts: cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': [{'x': x, 'y': y} for x, y in pts]})
    view = lambda: pg.evaluate("(() => { const m = document.querySelector('#map')._map, s = HI8.spot('zandvoort'); return m.at(s.lat, s.lon).map(Math.round) })()")

    print('gestures')
    y0, v0 = pg.evaluate('scrollY'), view()
    touch('touchStart', [(r[0], r[1])])
    for i in range(1, 20): touch('touchMove', [(r[0], r[1] - i * 12)]); pg.wait_for_timeout(16)
    touch('touchEnd', []); pg.wait_for_timeout(700)
    check(pg.evaluate('scrollY') - y0 > 100 and view() == v0, 'one finger up over the map: the page scrolls, the map stays')
    pg.evaluate("y => scrollTo(0, y - 60)", top); pg.wait_for_timeout(600)
    r = pg.evaluate("(() => { const r = document.querySelector('#map').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] })()")
    touch('touchStart', [(r[0], r[1])])
    for i in range(1, 12): touch('touchMove', [(r[0] + i * 12, r[1])]); pg.wait_for_timeout(16)
    check(pg.locator('.map-hint.on').count() == 1, 'one finger sideways: "two fingers to move the map"')
    touch('touchEnd', []); pg.wait_for_timeout(300)
    v0 = view()
    touch('touchStart', [(r[0] - 40, r[1]), (r[0] + 40, r[1])])
    for i in range(1, 15): touch('touchMove', [(r[0] - 40 + i * 5, r[1] + i * 3), (r[0] + 40 + i * 5, r[1] + i * 3)]); pg.wait_for_timeout(16)
    touch('touchEnd', []); pg.wait_for_timeout(600)
    v1 = view()
    check(abs(v1[0] - v0[0]) > 30 or abs(v1[1] - v0[1]) > 20, f'two fingers move the map ({v0} -> {v1})')

    print('the day and the hour')
    days = pg.locator('#mapdays button')
    check(days.count() >= 3 and pg.locator('#mapdays button .dt').count() == days.count(), 'every day chip shows how good that day is')
    hrs = pg.locator('#hours .hr')
    bb = hrs.first.bounding_box()
    check(hrs.count() >= 8 and bb['width'] >= 36 and bb['height'] >= 40, f'the hours are buttons a thumb can hit ({hrs.count()}, {round(bb["width"])}x{round(bb["height"])})')
    days.nth(2).click(); pg.wait_for_timeout(600)
    w0 = pg.locator('#when').inner_text()
    pg.locator('#hours .hr').nth(3).click(); pg.wait_for_timeout(500)
    check(pg.locator('#when').inner_text() != w0 and pg.locator('#hours .hr[aria-pressed=true]').count() == 1, 'tap an hour: the map shows it')

    print('a spot: the card, the crew, hop on')
    xy = pg.evaluate("(() => { const m = document.querySelector('#map'), s = HI8.spot('zandvoort'), q = m._map.at(s.lat, s.lon), r = m.getBoundingClientRect(); return [r.left + q[0], r.top + q[1]] })()")
    pg.touchscreen.tap(xy[0], xy[1]); pg.wait_for_timeout(1200)
    card = pg.locator('#mapcard')
    t = card.inner_text().upper()
    check(card.is_visible() and 'ZANDVOORT' in t and "'S CREW" in t and ('BEST HERE' in t or 'NO GOOD WINDOW' in t), 'tap Zandvoort: a card with that hour, the window and the crew that day')
    check(pg.evaluate("document.querySelector('.mapsec .mapwrap').classList.contains('carded')"), 'on a phone the card opens under the map, not over it')
    check(card.locator('[data-act=going][data-code=MAPC01]').count() == 1, "I'M GOING right on the card")
    card.locator('[data-act=going]').click(); pg.wait_for_selector('#sheet.on'); pg.wait_for_timeout(1200)
    check('ZANDVOORT' in pg.locator('#sheet').inner_text().upper(), "I'M GOING opens that crew to join")
    pg.locator('#sheet [data-act=close]').first.click(); pg.wait_for_timeout(600)
    pg.locator('#mapcard [data-act=mapcardx]').click(); pg.wait_for_timeout(400)
    check(not pg.locator('#mapcard').is_visible(), '✕ closes the card')
    check(not errs, 'no script errors: ' + '; '.join(errs)[:300])

    print('a computer')
    d = b.new_context(viewport={'width': 1280, 'height': 800}).new_page(); d.goto(BASE + '/'); d.wait_for_timeout(4000)
    m = d.locator('#map').bounding_box()
    vd = lambda: d.evaluate("(() => { const m = document.querySelector('#map')._map, s = HI8.spot('zandvoort'); return m.at(s.lat, s.lon).map(Math.round) })()")
    a0 = vd(); d.mouse.move(m['x'] + 300, m['y'] + 300); d.mouse.down(); d.mouse.move(m['x'] + 380, m['y'] + 340, steps=8); d.mouse.up(); d.wait_for_timeout(600)
    a1 = vd()
    check(abs(a1[0] - a0[0]) > 40, f'the mouse drags the map ({a0} -> {a1})')
    b.close()
print(f'\nALL {ok} MAP CHECKS PASSED')
