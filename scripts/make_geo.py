# Builds site/geo.js (the live map outlines) from Natural Earth 10m GeoJSON (public domain):
#   git clone --depth 1 --filter=blob:none --sparse https://github.com/nvkelso/natural-earth-vector
#   (sparse-checkout the ne_10m land, minor_islands, lakes, admin_0_boundary_lines_land, rivers_lake_centerlines files)
#   python3 scripts/make_geo.py natural-earth-vector/geojson site/geo.js
# Builds site/geo.js: land, lakes, borders, rivers and towns for the map, from Natural Earth 10m (public domain).
import json
import sys
NE = (sys.argv[1] if len(sys.argv) > 1 else 'natural-earth-vector/geojson').rstrip('/') + '/'
REGIONS = {
  'barcelona': dict(bbox=(-0.8, 39.8, 4.4, 43.4), towns=[
    ('Barcelona', 41.3874, 2.1686, 1), ('Girona', 41.9794, 2.8214, 2), ('Tarragona', 41.1189, 1.2445, 2), ('Lleida', 41.6176, 0.6200, 2),
    ('Figueres', 42.2667, 2.9617, 3), ('Sitges', 41.2370, 1.8059, 3), ('Castelldefels', 41.2800, 1.9767, 3), ('Mataró', 41.5381, 2.4447, 3),
    ('Terrassa', 41.5610, 2.0089, 3), ('Sabadell', 41.5433, 2.1094, 3), ('Manresa', 41.7251, 1.8266, 3), ('Vic', 41.9301, 2.2549, 3),
    ('Granollers', 41.6083, 2.2875, 3), ('Reus', 41.1561, 1.1069, 3), ('Tortosa', 40.8125, 0.5216, 3), ('Amposta', 40.7130, 0.5810, 4),
    ('L\'Escala', 42.1250, 3.1310, 4), ('Roses', 42.2620, 3.1760, 4), ('Blanes', 41.6740, 2.7926, 4), ('Vilanova', 41.2241, 1.7252, 4),
    ('Igualada', 41.5791, 1.6172, 4), ('Montserrat', 41.5933, 1.8375, 4), ('Andorra', 42.5063, 1.5218, 3), ('Perpignan', 42.6986, 2.8956, 2),
    ('Sant Carles de la Ràpita', 40.6186, 0.5925, 4), ('Deltebre', 40.7194, 0.7106, 4), ('Sant Celoni', 41.6893, 2.4959, 4), ('Begues', 41.3333, 1.9333, 4)]),
  'amsterdam': dict(bbox=(3.2, 51.6, 6.8, 53.6), towns=[
    ('Amsterdam', 52.3676, 4.9041, 1), ('Haarlem', 52.3874, 4.6462, 2), ('Rotterdam', 51.9244, 4.4777, 2), ('Den Haag', 52.0705, 4.3007, 2),
    ('Utrecht', 52.0907, 5.1214, 2), ('Leiden', 52.1601, 4.4970, 3), ('Alkmaar', 52.6324, 4.7534, 3), ('Almere', 52.3508, 5.2647, 3),
    ('Lelystad', 52.5185, 5.4714, 3), ('Zaandam', 52.4389, 4.8258, 4), ('IJmuiden', 52.4583, 4.6194, 4), ('Den Helder', 52.9563, 4.7601, 3),
    ('Hoorn', 52.6424, 5.0597, 4), ('Amersfoort', 52.1561, 5.3878, 3)]),
}
def clip_poly(pts, b):
    W, S, E, N = b
    def clip(pts, inside, inter):
        out = []
        for i in range(len(pts)):
            cur, prev = pts[i], pts[i - 1]
            if inside(cur):
                if not inside(prev): out.append(inter(prev, cur))
                out.append(cur)
            elif inside(prev): out.append(inter(prev, cur))
        return out
    def ix(x0):
        return lambda p, q: (x0, p[1] + (q[1] - p[1]) * (x0 - p[0]) / (q[0] - p[0]))
    def iy(y0):
        return lambda p, q: (p[0] + (q[0] - p[0]) * (y0 - p[1]) / (q[1] - p[1]), y0)
    for inside, inter in ((lambda p: p[0] >= W, ix(W)), (lambda p: p[0] <= E, ix(E)), (lambda p: p[1] >= S, iy(S)), (lambda p: p[1] <= N, iy(N))):
        pts = clip(pts, inside, inter)
        if not pts: return []
    return pts
def clip_line(pts, b):
    W, S, E, N = b
    out, cur = [], []
    for p in pts:
        if W <= p[0] <= E and S <= p[1] <= N: cur.append(p)
        else:
            if len(cur) > 1: out.append(cur)
            cur = []
    if len(cur) > 1: out.append(cur)
    return out
def feats(f):
    for ft in json.load(open(NE + f))['features']:
        g = ft['geometry']
        if not g: continue
        if g['type'] in ('Polygon', 'LineString'): yield ft['properties'], [g['coordinates']] if g['type'] == 'Polygon' else [g['coordinates']]
        else: yield ft['properties'], g['coordinates']
def r(p): return [round(p[0], 3), round(p[1], 3)]
def dedupe(pts):
    out = []
    for p in pts:
        q = r(p)
        if not out or out[-1] != q: out.append(q)
    return out
out = {}
for name, R in REGIONS.items():
    b = R['bbox']
    land, lakes, borders, rivers = [], [], [], []
    for f in ('ne_10m_land.geojson', 'ne_10m_minor_islands.geojson'):
        for p, polys in feats(f):
            for poly in polys:
                ring = clip_poly([tuple(c) for c in poly[0]], b)
                if len(ring) >= 3: land.append(dedupe(ring))
    for p, polys in feats('ne_10m_lakes.geojson'):
        for poly in polys:
            ring = clip_poly([tuple(c) for c in poly[0]], b)
            if len(ring) >= 3: lakes.append(dedupe(ring))
    for p, lines in feats('ne_10m_admin_0_boundary_lines_land.geojson'):
        for ln in lines:
            for seg in clip_line(ln, b): borders.append(dedupe(seg))
    for p, lines in feats('ne_10m_rivers_lake_centerlines.geojson'):
        if (p.get('scalerank') or 99) > 9: continue
        for ln in lines:
            for seg in clip_line(ln, b): rivers.append(dedupe(seg))
    out[name] = dict(bbox=list(b), land=land, lakes=lakes, borders=borders, rivers=rivers,
                     towns=[[t[0], t[1], t[2], t[3]] for t in R['towns']])
    print(name, 'land rings', len(land), 'pts', sum(len(x) for x in land), 'lakes', len(lakes), 'borders', len(borders), 'rivers', len(rivers))
js = ('/* Map outlines for the live map (map.js): land, lakes, borders, rivers. Made with Natural Earth 10m\n'
      ' * (public domain, naturalearthdata.com), clipped to each city\'s region. Towns: their usual coordinates. */\n'
      'window.HI8_GEO = ' + json.dumps(out, separators=(',', ':'), ensure_ascii=False) + ';\n')
open(sys.argv[2] if len(sys.argv) > 2 else 'site/geo.js', 'w').write(js)
print('geo.js bytes', len(js.encode()))
