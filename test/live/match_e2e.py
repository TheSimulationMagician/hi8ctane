# TEST ONLY. 2.29 in a browser: the crew that fits you first (and why), "I'm looking" from the landing without an
# account, the captain seeing who's looking when starting a crew, and Me.
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
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST', headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': '10.6.1.1'})
    with urllib.request.urlopen(req) as r: return json.loads(r.read() or b'null')

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.ride_asks, public.spot_reports cascade")
K = {n: rpc('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})['key'] for n in ('ana', 'bo', 'di', 'eve')}
sql("update signups set first_name = initcap(split_part(email, '@', 1)) where email like '%@example.com'")
def crew(off, host, members, levels='all', seats=0, hub='cs', spot='wijk-aan-zee', start='13:00'):
    cid = sql(f"insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email) values ('amsterdam','kite','{spot}', hi8_today('amsterdam') + {off}, '{start}','17:00','{levels}',6,'{hub}','11:45','{host}@example.com') returning id").split('\n')[0]
    for m in members:
        g = ('drive' if seats else 'own') if m == host else 'own'
        sql(f"insert into public.crew_members (crew_id, email, level, getting, seats) values ('{cid}', '{m}@example.com', 'regular', '{g}', {seats if m == host else 0})")
    return sql(f"select code from public.crews where id = '{cid}'")
crew(-6, 'ana', ['ana', 'di'])                               # Di rode with Ana before
first = crew(2, 'eve', ['eve'], levels='rookie', start='10:00')   # sooner, but a rookie session
fits = crew(2, 'ana', ['ana'], levels='all', seats=3, start='14:00')  # Ana drives, 3 seats from Centraal

with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    def phone(key=None, store=None):
        c = b.new_context(**p.devices['iPhone 13'], timezone_id='Europe/Amsterdam'); pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '/'); pg.wait_for_timeout(300)
        if key: pg.evaluate("k => localStorage.setItem('hi8.me', JSON.stringify({key: k}))", key)
        for k, v in (store or {}).items(): pg.evaluate("([k, v]) => localStorage.setItem('hi8.' + k, JSON.stringify(v))", [k, v])
        return pg
    print('the crew that fits you first')
    D = phone(K['di'], {'lv.kite': 'regular', 'getting': 'seat'})
    D.goto(BASE + '/'); D.wait_for_timeout(3500)
    ss = D.locator('#sessions .ss.has').first
    check(fits in (ss.locator('.sgl').first.get_attribute('href') or ''), "Di (a rider, needs a seat): on the landing Ana's crew is the one shown, not the sooner rookie session")
    why = ss.locator('.ss-why').inner_text().upper()
    check('A SEAT FROM CENTRAAL' in why and "1 RIDER YOU'VE RIDDEN WITH" in why, 'and it says why: ' + why)
    D.goto(BASE + '/#join'); D.wait_for_selector('#sheet.on'); D.wait_for_timeout(1500)
    cards = D.locator('#sheet .sc')
    check(cards.count() == 2 and fits in (cards.first.get_attribute('href') or '') and first in (cards.nth(1).get_attribute('href') or ''), 'ALL CREWS: hers first, the rookie session after')
    check(cards.first.locator('.scwhy').count() == 1 and cards.nth(1).locator('.scwhy').count() == 0, 'the rookie session says nothing (not her level, no seat)')
    print("I'm looking, without an account")
    F = phone()
    F.goto(BASE + '/'); F.wait_for_timeout(3500)
    box = F.locator('#sessions .lookbox')
    check(box.count() == 1 and 'UP FOR A RIDE?' in box.inner_text().upper(), 'the landing: UP FOR A RIDE?')
    box.locator('[data-act=looking]').click(); F.wait_for_selector('#sheet.on'); F.wait_for_timeout(500)
    check(F.locator('[data-act=lksave][disabled]').count() == 1, 'the button waits for a day')
    good = F.locator('.lkdays .opt:has(small.t-good), .lkdays .opt:has(small.t-epic)')
    n = good.count(); check(n >= 1, f'{n} good day(s) this week to pick from')
    for i in range(n): good.nth(i).click(); F.wait_for_timeout(100)
    F.locator('[data-act=lkseat][data-v="1"]').click(); F.wait_for_timeout(200)
    F.locator('[data-act=lkhub][data-v=cs]').click(); F.wait_for_timeout(200)
    F.fill('#lkEmail', 'fi@example.com')
    F.locator('[data-act=lksave]').click(); F.wait_for_timeout(2500)
    check(sql("select count(*) || '|' || bool_and(need_seat) || '|' || min(hub) from ride_asks where email = 'fi@example.com'") == f'{n}|true|cs', 'saved: her days, a seat from Centraal')
    check("ON THE LIST" in F.locator('#toast').inner_text().upper(), 'a toast: ' + F.locator('#toast').inner_text()[:100])
    F.wait_for_timeout(800)
    check("YOU'RE UP FOR A RIDE" in F.locator('#sessions .lookbox').inner_text().upper(), "the landing now says YOU'RE UP FOR A RIDE, with CHANGE")

    print('the captain sees it')
    B = phone(K['bo'], {'lv.kite': 'regular'})
    B.goto(BASE + '/#start'); B.wait_for_selector('#sheet.on'); B.wait_for_timeout(2500)
    h = B.locator('.hint.looking')
    check(h.count() == 1 and 'LOOKING FOR' in h.inner_text().upper() and 'NEEDS A SEAT' in h.inner_text().upper() and 'FROM CENTRAAL' in h.inner_text().upper(), 'starting a crew that day: ' + (h.inner_text() if h.count() else 'nothing'))
    check('fi@' not in B.content() and 'Fi' not in h.inner_text(), '...a number: no name, no email')

    print('Me')
    F.goto(BASE + '/#me'); F.wait_for_selector('#sheet.on'); F.wait_for_timeout(2000)
    check(F.locator('#sheet .lookbox.on').count() == 1, "Me: what you're looking for, and CHANGE")
    F.locator('#sheet .lookbox [data-act=looking]').click(); F.wait_for_timeout(800)
    sel = F.locator('.lkdays .opt[aria-pressed=true]')
    for i in range(sel.count()): F.locator('.lkdays .opt[aria-pressed=true]').first.click(); F.wait_for_timeout(100)
    F.locator('[data-act=lksave]').click(); F.wait_for_timeout(2000)
    check(sql("select count(*) from ride_asks where email = 'fi@example.com'") == '0', 'untick every day: STOP LOOKING, and it\'s gone')
    check(not errs, 'no script errors: ' + '; '.join(errs)[:300])
    b.close()
print(f'\nALL {ok} MATCHING APP CHECKS PASSED')
