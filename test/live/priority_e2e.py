# TEST ONLY. PR #50a: one priority order decides the pass headline, its stamp, the sticky button and the home dock,
# so a lower-priority action never contradicts a higher one. Each state from the brief, in a browser:
# closed > forecast against it (J10A) > moved, still in? > captain handover > your own lift > on the day > nothing
# pending; and the home dock proposes the kept crew's day instead of another session (J9A). One price per page.
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
    req = urllib.request.Request(f'{BASE}/rest/v1/rpc/{fn}', data=json.dumps(body).encode(), method='POST', headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': f'10.68.{ipn[0] // 200}.{ipn[0] % 200}'})
    try:
        with urllib.request.urlopen(req) as r: return json.loads(r.read() or b'null')
    except urllib.error.HTTPError as e: return {'error': e.code, **json.loads(e.read() or b'{}')}

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.crews, public.crew_members, public.outbox, public.ride_asks, public.spot_reports, public.events, public.squads, public.squad_members, public.spot_notes, public.wind_alerts cascade; delete from auth.users;")
sql("update app_settings set value = 'true' where key in ('open_posting', 'strict_keys')")
K = {n: rpc('hi8_join', {'p_email': n + '@example.com', 'p_city': 'amsterdam'})['key'] for n in ('ana', 'bo', 'cy', 'di', 'eve', 'fay', 'gil', 'hu', 'jo')}
sql("update signups set first_name = initcap(split_part(email, '@', 1)) where email like '%@example.com'")
def crew(off, host, seats, spot='wijk-aan-zee', start='13:00', end='16:00', mn=3):
    cid = sql(f"insert into crews (city, sport, spot, day, start_time, end_time, levels, max_riders, meet_hub, meet_time, host_email, min_riders) values ('amsterdam','kite','{spot}', hi8_today('amsterdam') + {off}, '{start}','{end}','all',6,'cs','11:45','{host}@example.com', {mn}) returning id").split('\n')[0]
    sql(f"insert into crew_members (crew_id, email, level, getting, seats) values ('{cid}', '{host}@example.com', 'ripper', '{'drive' if seats else 'own'}', {seats})")
    return sql(f"select code from crews where id = '{cid}'")
# A: Saturday-style crew two days out. Bo drives 2 seats (Ana, Cy), Di own way, Eve has no seat. Bo's car costs EUR 24.
A = crew(2, 'bo', 2)
for n, g in (('ana', 'seat'), ('cy', 'seat'), ('di', 'own'), ('eve', 'seat')): rpc('hi8_join_crew', {'p_key': K[n], 'p_code': A, 'p_level': 'regular', 'p_getting': g, 'p_seats': 0})
sql(f"update crew_members set trip_cost = 24 where email = 'bo@example.com' and crew_id = (select id from crews where code = '{A}')")
# T: today, a little later than now. Gil drives, Hu has a seat.
T = sql("""insert into crews (city,sport,spot,day,start_time,end_time,levels,max_riders,meet_hub,meet_time,host_email,min_riders)
  select 'amsterdam','kite','wijk-aan-zee', hi8_today('amsterdam'), least(t + interval '2 hours', time '21:00'), least(t + interval '5 hours', time '23:59'), 'regular', 6, 'cs', least(t + interval '1 hour', time '20:00'), 'gil@example.com', 2
  from (select date_trunc('hour', hi8_city_now('amsterdam'))::time as t) x returning code""").split('\n')[0]
sql(f"insert into crew_members (crew_id,email,level,getting,seats) select id,'gil@example.com','ripper','drive',2 from crews where code='{T}'")
rpc('hi8_join_crew', {'p_key': K['hu'], 'p_code': T, 'p_level': 'regular', 'p_getting': 'seat', 'p_seats': 0})
# C: a crew on a day its spot is closed (test note), Fay captains, Cy is in it
C = crew(5, 'fay', 3, 'ijmuiden', mn=2)
sql(f"insert into crew_members (crew_id, email, level, getting, seats) select id, 'cy@example.com', 'regular', 'own', 0 from crews where code = '{C}'")
sql("insert into spot_notes (city, spot, kind, body, from_day, to_day, source, checked_on) values ('amsterdam', 'ijmuiden', 'closed', 'Test note: beach closed for an event', hi8_today('amsterdam') + 5, hi8_today('amsterdam') + 5, 'TEST DATA', current_date)")
# a kept crew (Jo, Bo, Cy, Di) with riders up for days ahead; Jo has no session booked
sq = sql("insert into squads (code, name, city, sport, created_by) values ('PRIOQ', 'Wijk regulars', 'amsterdam', 'kite', 'jo@example.com') returning id").split('\n')[0]
for n in ('jo', 'bo', 'cy', 'di'): sql(f"insert into squad_members (squad_id, email) values ('{sq}', '{n}@example.com')")
P = crew(-6, 'bo', 3); sql(f"update crews set squad = '{sq}' where code = '{P}'")
for n, days in (('bo', range(1, 7)), ('cy', range(2, 7)), ('di', (3, 4, 5))):
    for d in days: sql(f"insert into ride_asks (email, city, sport, day) values ('{n}@example.com', 'amsterdam', 'kite', hi8_today('amsterdam') + {d})")

with sync_playwright() as pw:
    br = pw.chromium.launch()
    def page(key):
        c = br.new_context(**{**pw.devices['iPhone 13']}, timezone_id='Europe/Amsterdam')
        pg = c.new_page(); errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(BASE + '/'); pg.evaluate("() => localStorage.clear()")
        pg.evaluate("k => { localStorage.setItem('hi8.me', JSON.stringify({key: k})); localStorage.setItem('hi8.lv.kite', '\"regular\"'); }", key)
        return pg, errs
    def crewpage(who, code):
        pg, errs = page(K[who]); pg.goto(BASE + f'/?c={code}'); pg.wait_for_selector('#sheet.on .pass'); pg.wait_for_timeout(2200)
        return pg, errs
    txt = lambda pg, sel: pg.locator(sel).first.inner_text() if pg.locator(sel).count() else ''
    foot = lambda pg: pg.locator('#sheet.on .sh-foot').first
    def sticky(pg):   # the sticky button's action, or 'wa' / 'nav' for the two links
        f = foot(pg)
        if f.locator('[data-act]').count(): return f.locator('[data-act]').first.get_attribute('data-act')
        if f.locator('a.wa').count(): return 'wa'
        if f.locator('a.navl').count(): return 'nav'
        return ''
    TARGET = {'tofx': '#fxAnchor', 'toplanb': '#sheet.on .pb', 'toedit': '#editAnchor', 'tocall': '#callBox'}
    def lands(pg):   # a sticky that scrolls somewhere must have somewhere to go
        a = sticky(pg); return a not in TARGET or pg.locator(TARGET[a]).count() > 0
    stamp = lambda pg: pg.locator('#sheet.on .pass .pass-stamp.ok').count()
    warn = lambda pg: pg.locator('#sheet.on .pass .pass-now.warn').count()

    # 7 · nothing pending, not the day: ALL SET, and sharing is the right sticky
    pg, errs = crewpage('ana', A)
    check(stamp(pg) == 1 and not warn(pg) and sticky(pg) == 'wa', 'nothing open, two days out: ALL SET stamp, sticky SHARE TO WHATSAPP')
    body = txt(pg, '#sheet.on')
    check('A SEAT, SPLIT' not in body and '€8.00' in body and '2.50' not in body, 'one price on the page: the €8.00 share from Bo\'s car, no seat estimate beside it')
    check(not errs, 'no script errors')

    # 6 · your own lift missing (j5d): the sticky asks the crew, not SHARE
    pg, errs = crewpage('eve', A)
    check("YOUR LIFT ISN'T SORTED YET" in txt(pg, '#sheet.on .pass-now') and sticky(pg) == 'askdriver' and stamp(pg) == 0, "no seat for Eve: headline says so, sticky is ASK THE CREW FOR A LIFT, no ALL SET")

    # 3 · J10A: the recheck went against the session on the day
    sql(f"update crews set checked_at = now(), checked_ok = false, checked_note = '8 kt SW at the start, too light' where code = '{T}'")
    pg, errs = crewpage('hu', T)
    now = txt(pg, '#sheet.on .pass-now')
    check(warn(pg) == 1 and stamp(pg) == 0 and 'RECHECK SAYS DOUBTFUL' in now, 'J10A: the forecast warning is the headline, styled as a warning, and there is no ALL SET')
    check(sticky(pg) == 'tofx' and lands(pg) and 'BE AT' not in now, 'J10A: the rider\'s sticky points to the forecast, not to departure')
    pg, errs = crewpage('gil', T)
    check(sticky(pg) in ('tocall', 'toedit') and lands(pg) and warn(pg) == 1, 'J10A, captain: the sticky is the call (move it, call it off or keep it on)')
    pg.locator('#sheet.on [data-act=keepon]').first.click() if pg.locator('#sheet.on [data-act=keepon]').count() else None
    pg.wait_for_timeout(800)
    check(warn(pg) == 0, 'the captain keeps it on: the warning stops leading (the forecast stays visible further down)')
    sql(f"update crews set checked_at = null, checked_ok = null, checked_note = null where code = '{T}'")
    # a warning leads, but your own open item still shows, one step down
    sql(f"update crews set checked_at = now(), checked_ok = false, checked_note = 'Too light at the start' where code = '{A}'")
    pg, errs = crewpage('eve', A)
    check(warn(pg) == 1 and "YOUR LIFT ISN'T SORTED YET" in txt(pg, '#sheet.on .pass-then') and pg.locator('#sheet.on .pass-then [data-act=askdriver]').count() == 1 and sticky(pg) == 'tofx',
          "warning first, then Eve's own open item with its button: nothing she has to do disappears")
    sql(f"update crews set checked_at = null, checked_ok = null, checked_note = null where code = '{A}'")

    # 7 · on the day, before pick-up, nothing in the way: directions are the sticky
    pg, errs = crewpage('hu', T)
    # the local test forecast moves with the clock: when it warns for T's hours, the warning rightly comes first (rule 1)
    if warn(pg): check(sticky(pg) == 'tofx', 'on the day, with the forecast warning at this hour: the warning comes first (SEE THE FORECAST)')
    else: check(sticky(pg) == 'nav' and 'GOOGLE MAPS' in foot(pg).inner_text(), 'on the day: the sticky is GOOGLE MAPS to the pick-up')
    check(pg.locator('#sheet.on .pass .pass-act').count() == 0, 'and the pass itself holds no second copy of the main button')

    # 1 · closed: the closure beats everything
    pg, errs = crewpage('cy', C)
    check(warn(pg) == 1 and 'CLOSED THAT DAY' in txt(pg, '#sheet.on .pass-now') and sticky(pg) == 'toplanb' and lands(pg) and stamp(pg) == 0, 'closed day, rider: CLOSED THAT DAY, sticky SEE PLAN B')
    pg, errs = crewpage('fay', C)
    check(sticky(pg) == 'toedit' and lands(pg), 'closed day, captain: sticky MOVE OR CALL IT OFF')

    # 4 · moved: the rider has to say they're still in
    rpc('hi8_move_crew', {'p_key': K['bo'], 'p_code': A, 'p_day': sql("select (hi8_today('amsterdam')+4)::text"), 'p_start': '14:00', 'p_end': '17:00'})
    pg, errs = crewpage('ana', A)
    check('STILL IN?' in txt(pg, '#sheet.on .pass-now') and sticky(pg) == 'stillin' and stamp(pg) == 0, 'moved: STILL IN? leads and the sticky is I\'M STILL IN')
    rpc('hi8_still_in', {'p_key': K['ana'], 'p_code': A})

    # 5 · captain handover: the asked rider sees the question first
    rpc('hi8_step_down', {'p_key': K['bo'], 'p_code': A})
    asked = sql(f"select split_part(host_email, '@', 1) from crews where code = '{A}'")
    if asked != 'bo':
        pg, errs = crewpage(asked, A)
        check('WILL YOU CAPTAIN?' in txt(pg, '#sheet.on .pass-now') and sticky(pg) == 'captain', f'captain handover: {asked.title()} is asked first, sticky KEEP IT ON')
    else:
        check(False, 'step down hands the crew to someone else')

    # J9A · the home dock: Jo has no session; the kept crew's proposal wins over another session
    pg, errs = page(K['jo']); pg.goto(BASE + '/'); pg.wait_for_timeout(4500)
    d = pg.locator('#dockGo')
    check(d.count() == 1 and d.get_attribute('data-act') == 'propose' and 'PROPOSE' in d.inner_text(), 'J9A: the dock proposes the kept crew\'s day: ' + d.inner_text().replace('\n', ' '))
    check(not errs, 'no script errors on the home page')
    br.close()
print(f'\n{ok} checks passed')
