# Cartoons in the browser (2.18): Me -> a selfie -> the consent box -> DRAW ME -> the cartoon on the plate and in the crew.
# Runs against serve.mjs in live mode (8801), which runs the real cartoon function with a fake OpenAI and Storage in memory.
import json, os, re, subprocess, sys, urllib.request
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8801'
ok = 0
def check(c, what):
    global ok
    if not c: print('FAIL: ' + what); sys.exit(1)
    ok += 1; print('  ok ·', what)
def sql(q): return subprocess.check_output(['psql', '-h', os.environ.get('PGHOST', '127.0.0.1'), '-p', '5440', '-U', 'postgres', '-d', 'hi8', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', q]).decode().strip()
def rpc(fn, args):
    r = urllib.request.Request(BASE + '/rest/v1/rpc/' + fn, data=json.dumps(args).encode(), headers={'apikey': 'sb_publishable_test', 'content-type': 'application/json', 'x-test-ip': '10.7.7.' + str(len(args))})
    return json.loads(urllib.request.urlopen(r).read() or 'null')
def log0(): return json.loads(urllib.request.urlopen(BASE + '/__cartoon').read())
C0 = len(log0()['calls'])  # the server keeps its log between runs: count from here
def log(): l = log0(); l['calls'] = l['calls'][C0:]; return l

sql("truncate public.signups, public.rider_keys, public.rate_hits, public.rider_avatars, public.avatar_trash, public.cartoon_log, public.crews cascade")
sql("update public.app_settings set value = 'true' where key = 'cartoons_on'")
lu = rpc('hi8_join', {'p_email': 'lu@example.com', 'p_city': 'amsterdam'})
kai = rpc('hi8_join', {'p_email': 'kai@example.com', 'p_city': 'amsterdam'})
sql("insert into crews (city, sport, spot, day, start_time, levels, host_email, code) values ('amsterdam','kite','zandvoort', hi8_today('amsterdam')+1, '10:00', 'regular', 'kai@example.com', 'TOON01')")
sql("insert into crew_members (crew_id, email, level, getting) select id, e, 'regular', 'own' from crews, (values ('kai@example.com'), ('lu@example.com')) v(e) where code = 'TOON01'")

# a selfie: a 1600x1200 photo made on the spot (a face-ish drawing), saved as JPEG
SELFIE = '/tmp/hi8-selfie.jpg'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=os.environ.get('CHROME', '/usr/bin/google-chrome'), args=['--no-sandbox'])
    pg = b.new_page(viewport={'width': 1600, 'height': 1200})
    pg.set_content('<body style="margin:0;background:#d8c7a8"><div style="position:absolute;left:600px;top:250px;width:400px;height:520px;border-radius:50%;background:#e0a879"></div><div style="position:absolute;left:560px;top:200px;width:480px;height:200px;border-radius:50% 50% 10% 10%;background:#e7c14a"></div></body>')
    pg.screenshot(path=SELFIE, type='jpeg', quality=85); pg.close()

    def rider(key, plates):
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        ctx.route(re.compile(r'https://fonts\.(googleapis|gstatic)\.com/.*'), lambda r: r.abort())
        ctx.add_init_script("localStorage.setItem('hi8.me', JSON.stringify(%s)); localStorage.setItem('hi8.city28', JSON.stringify('amsterdam'));" % json.dumps({'key': key, 'city': 'amsterdam', 'plates': plates}))
        pg = ctx.new_page(); pg.errs = []; pg.on('pageerror', lambda e: pg.errs.append(str(e))); return pg

    print('making a cartoon')
    L = rider(lu['key'], {'amsterdam': lu.get('plate', 1)})
    L.goto(BASE + '/#me'); L.wait_for_selector('#sheet.on'); L.wait_for_timeout(1500)
    box = L.locator('#sheet .box.ct')
    check(box.count() == 1 and 'YOUR CARTOON' in box.inner_text() and 'TAKE A SELFIE' in box.inner_text() and 'PICK A PHOTO' in box.inner_text(), 'Me: YOUR CARTOON, take a selfie or pick a photo')
    check(L.locator('#sheet input[type=file][capture=user]').count() == 1, 'TAKE A SELFIE opens the front camera on a phone')
    L.locator('#sheet input[type=file]:not([capture])').set_input_files(SELFIE); L.wait_for_selector('#sheet .ctframe img'); L.wait_for_timeout(300)
    src = L.locator('#sheet .ctframe img').get_attribute('src')
    dims = L.evaluate("(s) => new Promise(r => { const i = new Image(); i.onload = () => r([i.width, i.height]); i.src = s; })", src)
    check(src.startswith('data:image/jpeg') and dims == [1024, 1024] and len(src) < 400000, 'the photo is squared to 1024 px and shrunk to %d KB before anything is sent' % (len(src) * 3 // 4 // 1024))
    check(L.locator('[data-act=ctdraw]').is_disabled() and 'OpenAI' in box.inner_text() and 'never the photo' in box.inner_text(), 'DRAW ME waits for the consent box, which says where the photo goes')
    check(log()['calls'] == [], 'nothing sent yet')
    L.locator('#sheet input[data-change=ctconsent]').check(); L.wait_for_timeout(100)
    L.locator('[data-act=ctdraw]').click()
    check('Drawing you' in L.locator('#sheet .box.ct').inner_text(), 'drawing: the photo greys out, a status line says what is happening')
    L.wait_for_selector('#sheet .ctframe.done img', timeout=15000); L.wait_for_timeout(800)
    files = log()['files']
    check(len(log()['calls']) == 1 and len(files) == 1 and sql("select path from rider_avatars where email = 'lu@example.com'") == files[0], 'one drawing, stored, recorded as her cartoon')
    check(L.locator('#plate img.tbav').count() == 1 and L.locator('#sheet img.meav').count() == 1, 'it shows on her plate in the top bar and next to her name')
    check(L.evaluate("[...document.querySelectorAll('#plate img, #sheet img.meav')].every(i => i.complete && i.naturalWidth > 0)"), 'and the images load')
    L.screenshot(path='/tmp/hi8-cartoon-me.png')

    print('in the crew, and on public cards')
    K = rider(kai['key'], {'amsterdam': kai.get('plate', 2)})
    K.goto(BASE + '/?c=TOON01'); K.wait_for_selector('#sheet.on'); K.wait_for_timeout(1800)
    check(K.locator('#sheet .who .av.img img').count() == 1, "Kai, in the crew, sees Lu's cartoon in WHO'S GOING")
    O = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    O.goto(BASE + '/?c=TOON01'); O.wait_for_selector('#sheet.on'); O.wait_for_timeout(1800)
    # 2.24: the rider cards carry the cartoon (not the name) for riders deciding to join; WHO'S GOING stays the crew's
    check(O.locator('#sheet .rc img[src*="/avatars/"]').count() == 0, 'before she chooses who sees her card, outsiders do not see her cartoon')
    sql("update public.signups set card_public = true where email = 'lu@example.com'")   # she picks: riders deciding to join
    O.goto(BASE + '/?c=TOON01'); O.wait_for_selector('#sheet.on'); O.wait_for_timeout(1800)
    check(O.locator('#sheet .rc img[src*="/avatars/"]').count() == 1 and O.locator('#sheet .who').count() == 0 and 'Lu' not in O.locator('#sheet .rcbox').inner_text(),
          'someone outside the crew sees her cartoon on her rider card, not her name')
    O.goto(BASE + '/'); O.wait_for_timeout(1800)
    check(O.locator('img[src*="/avatars/"]').count() == 0, 'and the public crew cards keep initials')

    print('limits, errors, removing')
    for i in range(2):
        L.locator('#sheet input[type=file]:not([capture])').set_input_files(SELFIE); L.wait_for_selector('#sheet input[data-change=ctconsent]')
        L.locator('#sheet input[data-change=ctconsent]').check(); L.locator('[data-act=ctdraw]').click(); L.wait_for_selector('#sheet .ctframe.done img', timeout=15000); L.wait_for_timeout(400)
    check(len(log()['files']) == 1, 'a new cartoon replaces the old file (one file per rider)')
    L.locator('#sheet input[type=file]:not([capture])').set_input_files(SELFIE); L.wait_for_selector('#sheet input[data-change=ctconsent]')
    L.locator('#sheet input[data-change=ctconsent]').check(); L.locator('[data-act=ctdraw]').click(); L.wait_for_selector('#sheet .ct .err', timeout=15000)
    check('3 cartoons today' in L.locator('#sheet .ct .err').inner_text() and len(log()['calls']) == 3, 'the 4th of the day: "That\'s 3 cartoons today", and OpenAI is not called')
    L.locator('[data-act=ctcancel]').click(); L.wait_for_timeout(200)
    L.locator('[data-act=ctremove]').click(); L.wait_for_timeout(200)
    check('Tap again' in L.locator('[data-act=ctremove]').inner_text(), 'Remove asks for a second tap')
    L.locator('[data-act=ctremove]').click(); L.wait_for_timeout(1200)
    check(L.locator('#plate img').count() == 0 and log()['files'] == [] and sql("select count(*) from rider_avatars") == '0', 'removed: gone from the plate, the database and Storage')
    small = '/tmp/hi8-tiny.jpg'
    tp = b.new_page(viewport={'width': 120, 'height': 120}); tp.set_content('<body style="background:#e0a879">'); tp.screenshot(path=small, type='jpeg'); tp.close()
    L.locator('#sheet input[type=file]:not([capture])').set_input_files(small); L.wait_for_timeout(800)
    check('too small' in L.locator('#sheet .ct').inner_text(), 'a tiny photo: "too small, try a closer selfie"')
    check(not L.errs and not K.errs, 'no script errors')
    b.close()
print(f'\nALL {ok} CARTOON BROWSER CHECKS PASSED')
