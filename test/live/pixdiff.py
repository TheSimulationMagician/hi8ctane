# TEST ONLY. Screenshots every screen from two servers and compares them pixel for pixel.
# Usage: python3 pixdiff.py <portA> <portB> <outdir> [screen ...]
import sys, os, io, glob
SITE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'site')
from playwright.sync_api import sync_playwright
from PIL import Image, ImageChops

a, b, out = sys.argv[1], sys.argv[2], sys.argv[3]
names = sys.argv[4:] or sorted(os.path.basename(f)[:-8] for f in glob.glob(os.path.join(SITE, 'B27-*.dc.html')))
os.makedirs(out, exist_ok=True)
FREEZE = "*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}"

def shot(page, port, name):
    page.goto(f'http://localhost:{port}/{name}.dc.html', wait_until='load')
    page.add_style_tag(content=FREEZE)
    page.wait_for_timeout(600)
    return Image.open(io.BytesIO(page.screenshot(full_page=True))).convert('RGB')

bad = 0
with sync_playwright() as p:
    br = p.chromium.launch()
    for n in names:
        w = 1280 if n == 'B27-Web' else 390
        ims = []
        for port in (a, b):
            ctx = br.new_context(viewport={'width': w, 'height': 844}, device_scale_factor=1)
            pg = ctx.new_page()
            errs = []
            pg.on('pageerror', lambda e: errs.append(str(e)))
            ims.append(shot(pg, port, n))
            if errs: print('  page errors on', port, n, errs[:2])
            ctx.close()
        A, B = ims
        if A.size != B.size:
            print(f'{n}: SIZE {A.size} vs {B.size}'); bad += 1
            A.save(f'{out}/{n}-a.png'); B.save(f'{out}/{n}-b.png'); continue
        d = ImageChops.difference(A, B)
        box = d.getbbox()
        if box:
            px = sum(1 for v in d.convert('L').getdata() if v > 0)
            print(f'{n}: {px} px differ in {box}'); bad += 1
            A.crop(box).save(f'{out}/{n}-a.png'); B.crop(box).save(f'{out}/{n}-b.png')
        else:
            print(f'{n}: identical {A.size}')
    br.close()
print('DIFFERENT:', bad)
