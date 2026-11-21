# TEST ONLY. 2.26: making your rider card from a crew page, choosing who sees it, and what others then see.
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
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST', headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': '10.6.6.6'})
    with urllib.request.urlopen(req) as r: return json.loads(r.read() or b'null')

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.spot_reports cascade")
K = {n: rpc('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})['key'] for n in ('ana', 'bo', 'eve')}
sql("update signups set first_name = 'Bo' where email = 'bo@example.com'")
cid = sql("insert into public.crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email, code) values ('amsterdam','kite','wijk-aan-zee', hi8_today('amsterdam') + 1, '13:00','17:00','all',6,'cs','11:45','ana@example.com','CARD01') returning id").split('\n')[0]
sql(f"insert into public.crew_members (crew_id, email, level, getting, seats) values ('{cid}', 'ana@example.com', 'regular', 'drive', 3), ('{cid}', 'bo@example.com', 'regular', 'seat', 0)")

with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    def phone(key=None):
        c = b.new_context(**p.devices['iPhone 13'], timezone_id='Europe/Amsterdam'); pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '/')
        if key: pg.evaluate("k => localStorage.setItem('hi8.me', JSON.stringify({key: k}))", key)
        return pg
    print('nobody has a card yet')
    O = phone(K['eve']); O.goto(BASE + '/?c=CARD01'); O.wait_for_timeout(3000)
    check(O.locator('.rc').count() == 2 and 'NO CARD YET' in O.locator('.rcbox').inner_text().upper() and O.locator('.rc-av.none').count() == 2, 'riders without a card show a "?": nothing is opened for them')
    print('Bo makes his card from his crew')
    B = phone(K['bo']); B.goto(BASE + '/?c=CARD01'); B.wait_for_timeout(3000)
    check(B.locator('.cardnudge [data-act=mycard]').count() == 1 and 'YOUR CARD IS EMPTY' in B.locator('.rcbox').inner_text().upper(), 'in his crew: "your card is empty" with MAKE MY CARD')
    B.locator('.cardnudge [data-act=mycard]').click(); B.wait_for_timeout(2000)
    check(B.evaluate('location.hash') == '#card' and B.locator('[data-act=cardsave][disabled]').count() == 1, 'the card page: SAVE waits until he chooses who sees it')
    B.fill('#prLine', 'Learning jumps. Always up for a drive.'); B.fill('#prYears', '2'); B.select_option('#prHome', 'muiderberg')
    B.locator('[data-act=cardwho][data-v="1"]').click(); B.wait_for_timeout(300)
    check(B.locator('#prLine').input_value() == 'Learning jumps. Always up for a drive.', 'what he typed stays when he picks')
    B.locator('[data-act=cardsave]').click(); B.wait_for_timeout(2500)
    check(sql("select card_public || '|' || tagline || '|' || years_riding || '|' || home_spot from signups where email = 'bo@example.com'") == 'true|Learning jumps. Always up for a drive.|2|muiderberg', 'saved: open to riders deciding to join, with his line, years and home spot')
    check('#card' not in B.evaluate('location.hash') and B.locator('.cardnudge').count() == 0, 'back on his crew, the nudge is gone')
    print('what others see')
    O.goto(BASE + '/?c=CARD01'); O.wait_for_timeout(3000)
    t = O.locator('.rcbox').inner_text().upper()
    check('1 WITH A CARD' in t and O.locator('.rc-av.none').count() == 1, 'Eve, deciding to join: one card made, one "?"')
    O.locator('.rc').nth(1).click(); O.wait_for_timeout(600)
    pc = O.locator('.bcard').inner_text()
    check('Learning jumps' in pc and 'MUIDERBERG' in pc.upper() and 'Bo' not in pc.replace('BO', ''), "Bo's card: his line and home spot, not his name")
    print('Ana keeps hers to her crews')
    A = phone(K['ana']); A.goto(BASE + '/#card'); A.wait_for_timeout(2500)
    A.locator('[data-act=cardwho][data-v="0"]').click(); A.locator('[data-act=cardsave]').click(); A.wait_for_timeout(2000)
    O.goto(BASE + '/?c=CARD01'); O.wait_for_timeout(3000)
    O.locator('.rc').first.click(); O.wait_for_timeout(600)
    check('keeps their card for their crews' in O.locator('.bcard').inner_text(), 'outside her crews: just the basics')
    B.goto(BASE + '/?c=CARD01'); B.wait_for_timeout(3000); B.locator('.rc').first.click(); B.wait_for_timeout(600)
    check('RIDES' in B.locator('.bcard').inner_text().upper() and 'keeps their card' not in B.locator('.bcard').inner_text(), 'Bo, in her crew, sees her whole card')
    check(not errs, 'no script errors: ' + '; '.join(errs)[:300])
    b.close()
print(f'\nALL {ok} CARD APP CHECKS PASSED')
