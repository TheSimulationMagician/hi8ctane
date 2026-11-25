# TEST ONLY. The readiness P0 (2.31) in a browser: a known email gets a sign-in link (no key, nothing joined); the
# readiness line and one next action; one-tap directions to the exact pin (Apple Maps on iPhone, copy coordinates);
# the calendar entry in UTC across daylight saving; RUN IT AGAIN; no overbooking under 12 simultaneous joins; the
# anonymous counts.
import re, json, os, subprocess, threading, urllib.request, urllib.error
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
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST', headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': f'10.66.{ipn[0] // 200}.{ipn[0] % 200}'})
    try:
        with urllib.request.urlopen(req) as r: return json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return {'error': e.code, **json.loads(e.read() or b'{}')}

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.ride_asks, public.spot_reports, public.events cascade; delete from auth.users;")
sql("insert into public.app_settings (key, value, public) values ('strict_keys', 'true', false) on conflict (key) do update set value = 'true'")
K = {n: rpc('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})['key'] for n in ('ana', 'bo', 'cy', 'di', 'eve')}
sql("update signups set first_name = initcap(split_part(email, '@', 1)) where email like '%@example.com'")
def crew(off, host, seats, start='13:00', mx=6, levels='regular'):
    cid = sql(f"insert into crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email, min_riders) values ('amsterdam','kite','wijk-aan-zee', hi8_today('amsterdam') + {off}, '{start}','16:00','{levels}',{mx},'cs','11:45','{host}@example.com', 3) returning id").split('\n')[0]
    sql(f"insert into crew_members (crew_id, email, level, getting, seats) values ('{cid}', '{host}@example.com', 'ripper', 'drive', {seats})")
    return sql(f"select code from crews where id = '{cid}'")
code = crew(1, 'bo', 2)
for n in ('ana', 'cy', 'eve'): rpc('hi8_join_crew', {'p_key': K[n], 'p_code': code, 'p_level': 'regular', 'p_getting': 'seat', 'p_seats': 0})
rpc('hi8_join_crew', {'p_key': K['di'], 'p_code': code, 'p_level': 'regular', 'p_getting': 'own', 'p_seats': 0})
lat, lon = [float(x) for x in sql("select lat || ',' || lon from spots where slug = 'wijk-aan-zee'").split(',')]

print('no overbooking')
big = crew(4, 'di', 0, '10:00', 6, 'all')
extra = [rpc('hi8_join', {'p_email': f'r{i}@example.com', 'p_city': 'amsterdam'})['key'] for i in range(12)]
res = []
def go(k): res.append(rpc('hi8_join_crew', {'p_key': k, 'p_code': big, 'p_level': 'regular', 'p_getting': 'own', 'p_seats': 0}))
ts = [threading.Thread(target=go, args=(k,)) for k in extra]
[t.start() for t in ts]; [t.join() for t in ts]
n_in = sql(f"select count(*) from crew_members m join crews c on c.id = m.crew_id where c.code = '{big}'")
check(n_in == '6' and sum(1 for r in res if r.get('message') == 'crew_full') == 7, f'12 riders join a 6-rider crew at the same moment: exactly 6 in (captain + 5), 7 told it\'s full ({n_in})')

with sync_playwright() as p:
    b = p.chromium.launch(); errs = []
    def phone(key=None, dev='Pixel 7', **kw):
        c = b.new_context(**p.devices[dev], timezone_id='Europe/Amsterdam', **kw); pg = c.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '/'); pg.wait_for_timeout(300)
        if key: pg.evaluate("k => localStorage.setItem('hi8.me', JSON.stringify({key: k}))", key)
        return pg
    T = lambda pg, sel: pg.locator(sel).first.inner_text().upper() if pg.locator(sel).count() else ''

    print('a known email')
    X = phone()
    n_auth = len(json.loads(urllib.request.urlopen(BASE + '/__auth').read()))
    X.goto(BASE + f'/?c={code}'); X.wait_for_selector('#sheet.on'); X.wait_for_timeout(2000)
    X.locator('.sh-foot [data-act=jfopen]').click(); X.wait_for_selector('#joinForm')   # I'M GOING, or JOIN ANYWAY when the forecast is against it
    X.locator('[data-act=jfget][data-v=own]').click()
    X.fill('#jfEmail', 'ana@example.com'); X.fill('#jfName', 'Not Ana')
    X.locator('.sh-foot [data-act=jfgo]').click(); X.wait_for_timeout(2500)
    auth = json.loads(urllib.request.urlopen(BASE + '/__auth').read())[n_auth:]
    check(any(a['path'] == '/auth/v1/otp' and 'ana@example.com' in a['body'] for a in auth), 'joining with an email we know: the site asks Supabase to email Ana a sign-in link')
    check('SIGN-IN LINK' in X.locator('#sheet').inner_text().upper() and X.evaluate("JSON.parse(localStorage.getItem('hi8.me') || '{}').key || null") is None, '...says so, and this browser gets no key')

    print('readiness and the next action')
    B = phone(K['bo'])
    B.goto(BASE + f'/?c={code}'); B.wait_for_selector('#sheet.on'); B.wait_for_timeout(2500)
    r = T(B, '#sheet .rdy')
    check('5 GOING OF 6' in r and '1 NEEDS A LIFT' in r and 'NO EXACT PIN YET' in r, 'the captain sees the facts: ' + r.replace('\n', ' / ')[:160])
    check('NEXT FOR YOU: FIND EVE A SEAT' in r, 'and one next action: find Eve a seat')
    B.locator('#sheet .rdy [data-act=askdriver]').click(); B.wait_for_timeout(1500)
    check(sql(f"select count(*) from crew_messages m join crews c on c.id = m.crew_id where c.code = '{code}' and m.body like 'Eve still needs a lift from Centraal at 11:45%'") == '1', 'ASK THE CREW FOR A DRIVER: posted in the crew chat')
    E = phone(K['eve'])
    E.goto(BASE + f'/?c={code}'); E.wait_for_selector('#sheet.on'); E.wait_for_timeout(2500)
    check("NEXT FOR YOU: YOUR LIFT ISN'T SORTED YET" in T(E, '#sheet .rdy'), "Eve sees it from her side: her lift isn't sorted yet, ask the crew")
    G = phone()
    G.goto(BASE + f'/?c={code}'); G.wait_for_selector('#sheet.on'); G.wait_for_timeout(2500)
    g = T(G, '#sheet .ess')
    check('5 GOING OF 6' in g and not re.search(r'\bEVE\b', g) and not re.search(r'\bPIN\b', g) and G.locator('#sheet .rdy').count() == 0, 'someone outside the crew: the essentials, counts only, no names, nothing about the pin (UX review H01/H02)')

    print('directions')
    rpc('hi8_set_pin', {'p_key': K['bo'], 'p_code': code, 'p_lat': lat + 0.003, 'p_lon': lon + 0.002})
    A = phone(K['ana'])
    A.goto(BASE + '/'); A.wait_for_timeout(3500)
    href = A.locator('#next .navl').first.get_attribute('href') or ''
    check(href.startswith('https://www.google.com/maps/dir/?api=1&destination=') and '%2C' in href, 'Ana (needs a seat): DIRECTIONS goes to the pick-up, as a Google directions link: ' + href)
    A.goto(BASE + f'/?c={code}'); A.wait_for_selector('#sheet.on'); A.wait_for_timeout(2500)
    pins = [h for h in A.eval_on_selector_all('.navl', 'els => els.map(e => e.href)') if f'{lat + 0.003:.5f}' in h]
    check(len(pins) == 1 and A.locator(f'[data-act=copy][data-text="{lat + 0.003:.5f},{lon + 0.002:.5f}"]').count() == 1, "the crew page: directions to the captain's exact pin, and COPY with its coordinates")
    check(A.locator('.navl', has_text='APPLE MAPS').count() == 0, 'no Apple Maps button on Android')
    A.route('https://www.google.com/**', lambda r: r.fulfill(status=200, body='ok'))
    A.context.route('https://www.google.com/**', lambda r: r.fulfill(status=200, body='ok'))
    A.evaluate("() => document.querySelector('.navl').click()"); A.wait_for_timeout(600)
    with A.expect_download() as dl: A.evaluate("() => document.querySelector('[data-act=ics]').click()")
    check(dl.value.suggested_filename == f'hi8ctane-{code}.ics', 'ADD TO CALENDAR downloads the entry')
    I = phone(K['cy'], 'iPhone 13')
    I.goto(BASE + f'/?c={code}'); I.wait_for_selector('#sheet.on'); I.wait_for_timeout(2500)
    ap = I.locator('.navl', has_text='APPLE MAPS')
    check(ap.count() >= 1 and (ap.first.get_attribute('href') or '').startswith('https://maps.apple.com/directions?destination='), 'on iPhone: APPLE MAPS, with the unified directions link')

    print('the calendar')
    out = A.evaluate("""(code) => fetch('/rest/v1/rpc/hi8_crew', {method: 'POST', headers: {'apikey': 'sb_publishable_test', 'content-type': 'application/json'}, body: JSON.stringify({p_code: code, p_key: JSON.parse(localStorage.getItem('hi8.me')).key})})
      .then(r => r.json()).then(c => [HI8.icsFile(Object.assign({}, c, {day: '2027-03-28', start: '13:00', end: '16:00'})), HI8.icsFile(Object.assign({}, c, {day: '2027-03-27', start: '13:00', end: '16:00'})), HI8.icsFile(Object.assign({}, c, {status: 'off', off_reason: 'No wind'}))])""", code)
    check('DTSTART:20270328T110000Z' in out[0] and 'DTSTART:20270327T120000Z' in out[1], 'calendar times in UTC: 13:00 in Amsterdam is 11:00Z the day the clocks change (28 Mar 2027), 12:00Z the day before')
    check(f'GEO:{lat + 0.003:.5f};{lon + 0.002:.5f}' in out[0] and 'Pick-up Centraal 11:45' in out[0] and 'UID:' + code + '@hi8ctane.com' in out[0], 'the pin, the pick-up and a fixed UID (opening it again updates the entry)')
    check('STATUS:CANCELLED' in out[2] and 'CALLED OFF' in out[2], 'called off: STATUS:CANCELLED')
    check('captain calls it' in out[0] and 'safe' not in out[0].lower(), 'it says the forecast is a model and the captain calls it, never "safe"')
    out2 = G.evaluate("""(code) => fetch('/rest/v1/rpc/hi8_crew', {method: 'POST', headers: {'apikey': 'sb_publishable_test', 'content-type': 'application/json'}, body: JSON.stringify({p_code: code})}).then(r => r.json()).then(c => HI8.icsFile(c))""", code)
    check(f'{lat + 0.003:.5f}' not in out2, "someone outside the crew: the spot only, never the captain's pin")

    print('run it again')
    past = crew(-1, 'bo', 3, '12:00', 7, 'regular')   # "how was it" shows the day after
    sql(f"delete from crews where code = '{big}'")   # the overbooking crew can sit on the next good window, and then RUN IT AGAIN rightly opens it instead
    sql(f"insert into crew_members (crew_id, email, level, getting, seats) select id, 'cy@example.com', 'regular', 'seat', 0 from crews where code = '{past}'")
    B.goto(BASE + f'/?c={past}'); B.wait_for_selector('#sheet.on'); B.wait_for_timeout(2500)
    ag = B.locator('[data-act=again]')
    check(ag.count() == 1, 'a past session: RUN IT AGAIN · SAME CREW SET-UP')
    ag.click(); B.wait_for_selector('#sheet.on'); B.wait_for_timeout(1500)
    check(B.url.endswith('#start') and 'WIJK AAN ZEE' in T(B, '#sheet'), 'it opens the start form on the same spot, at the next good window')
    B.locator('.sh-foot .big.start').click(); B.wait_for_timeout(3000)
    row = sql("select spot || '|' || levels || '|' || max_riders || '|' || meet_hub from crews where host_email = 'bo@example.com' and created_at > now() - interval '1 minute' and day >= hi8_today('amsterdam') order by created_at desc limit 1")
    check(row == 'wijk-aan-zee|regular|7|cs', 'published with the same set-up (spot, levels, 7 riders, pick-up Centraal) in one tap: ' + row)
    check(sql("select count(*) from events where name = 'publish' and extra = 'again'") == '1', '...and counted as a run-again')
    print('counts')
    names = sql("select string_agg(distinct name, ',' order by name) from events")
    check(all(n in names for n in ('link_open', 'nav', 'ics')) and sql("select count(*) from events where anon !~ '^[a-z0-9]{8,32}$'") == '0', 'anonymous counts recorded: ' + names)
    check(sql("select count(*) from events where src like '%@%' or crew like '%@%'") == '0', '...with no email anywhere in them')
    check(not errs, 'no script errors: ' + '; '.join(errs)[:300])
    b.close()
print(f'\nALL {ok} READINESS CHECKS PASSED')
