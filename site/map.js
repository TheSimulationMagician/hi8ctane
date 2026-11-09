/*
 * Hi8ctane live map (2.8). Drawn by us on a canvas: no map service, no keys, works offline once loaded.
 *
 *   var m = HI8Map(el, { geo: HI8_GEO.barcelona, onSpot: fn(slug) });
 *   m.setGrid(FX.gridData.barcelona); m.setHour(i); m.setLayer('wind' | 'rain');
 *   m.setSpots([{ slug, name, lat, lon, tone, big, small, crews, here, live, sel }]);
 *   m.fit([[lat, lon], ...]); m.redraw(); m.destroy();
 *
 * Land, lakes, borders and rivers come from Natural Earth (public domain, geo.js). The wind is Open-Meteo's,
 * on a grid over the region (fx.js), shown as a colour field and particles flowing with it, hour by hour.
 */
(function () {
  'use strict';
  var TILE = 256;
  function lonX(lon, z) { return (lon + 180) / 360 * TILE * Math.pow(2, z); }
  function latY(lat, z) { var s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * Math.pow(2, z); }
  function xLon(x, z) { return x / (TILE * Math.pow(2, z)) * 360 - 180; }
  function yLat(y, z) { var n = Math.PI - 2 * Math.PI * y / (TILE * Math.pow(2, z)); return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); }

  // wind colours (knots): steel blue when calm, mint, lime for the sweet spot, yellow, then pink when it's wild
  var STOPS = [[0, 34, 58, 94], [5, 52, 86, 140], [9, 64, 128, 168], [13, 86, 186, 170], [16, 140, 226, 150], [19, 186, 248, 92],
    [24, 200, 255, 61], [28, 255, 225, 77], [33, 255, 152, 64], [38, 255, 45, 120], [48, 170, 30, 140]];
  var DIM = 0.7; // the field stays darker than the markers, so they pop
  var RAIN = [[0, 0, 0, 0, 0], [1, 120, 170, 255, 0.35], [5, 80, 130, 255, 0.55], [20, 60, 80, 230, 0.7], [60, 150, 60, 230, 0.8]];
  function ramp(stops, v) {
    if (v <= stops[0][0]) return stops[0].slice(1);
    for (var i = 1; i < stops.length; i++) if (v <= stops[i][0]) {
      var a = stops[i - 1], b = stops[i], t = (v - a[0]) / (b[0] - a[0]);
      return a.slice(1).map(function (x, k) { return x + (b[k + 1] - x) * t; });
    }
    return stops[stops.length - 1].slice(1);
  }
  window.HI8_WIND_COLOR = function (kt) { var c = ramp(STOPS, kt); return 'rgb(' + c.map(Math.round).join(',') + ')'; };

  window.HI8Map = function (host, opts) {
    opts = opts || {};
    var dpr = Math.min(2, window.devicePixelRatio || 1);
    var cv = document.createElement('canvas'), ctx = cv.getContext('2d');
    var trail = document.createElement('canvas'), tctx = trail.getContext('2d');
    var field = document.createElement('canvas'), fctx = field.getContext('2d');
    cv.className = 'map-canvas'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', opts.label || 'Live wind map with spots and crews');
    host.appendChild(cv);
    var W = 0, H = 0, z = 7.6, cx = 0, cy = 0, geo = opts.geo, grid = null, hour = 0, layer = 'wind', spots = [], hits = [], keepOut = [];
    var parts = [], raf = 0, visible = true, still = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || !!opts.still;
    var fieldDirty = true, t0 = Date.now();

    function size() {
      var r = host.getBoundingClientRect();
      W = Math.max(50, Math.round(r.width)); H = Math.max(50, Math.round(r.height));
      [cv, trail].forEach(function (c) { c.width = W * dpr; c.height = H * dpr; });
      cv.style.width = W + 'px'; cv.style.height = H + 'px';
      fieldDirty = true; seed();
    }
    function px(lat, lon) { return [lonX(lon, z) - cx + W / 2, latY(lat, z) - cy + H / 2]; }
    function ll(x, y) { return [yLat(y - H / 2 + cy, z), xLon(x - W / 2 + cx, z)]; }

    // ---------------------------------------------------------------- the wind at any point (bilinear on the grid)
    function windAt(lat, lon, hi) {
      if (!grid) return null;
      var B = grid.box, R = grid.rows, C = grid.cols;
      var fr = (lat - B[0]) / (B[2] - B[0]) * (R - 1), fc = (lon - B[1]) / (B[3] - B[1]) * (C - 1);
      fr = Math.max(0, Math.min(R - 1.001, fr)); fc = Math.max(0, Math.min(C - 1.001, fc));
      var r0 = Math.floor(fr), c0 = Math.floor(fc), tr = fr - r0, tc = fc - c0, u = 0, v = 0, rain = 0, n = 0;
      [[r0, c0, (1 - tr) * (1 - tc)], [r0, c0 + 1, (1 - tr) * tc], [r0 + 1, c0, tr * (1 - tc)], [r0 + 1, c0 + 1, tr * tc]].forEach(function (q) {
        var i = q[0] * C + q[1], w = grid.w[i] && grid.w[i][hi], d = grid.d[i] && grid.d[i][hi];
        if (w == null || d == null) return;
        var rad = d * Math.PI / 180;
        u += -w * Math.sin(rad) * q[2]; v += -w * Math.cos(rad) * q[2]; rain += ((grid.r[i] && grid.r[i][hi]) || 0) / 10 * q[2]; n += q[2];
      });
      if (!n) return null;
      u /= n; v /= n; rain /= n;
      return { u: u, v: v, w: Math.sqrt(u * u + v * v), rain: rain };
    }

    // ---------------------------------------------------------------- drawing
    function path(ring) {
      ctx.beginPath();
      ring.forEach(function (p, i) { var q = px(p[1], p[0]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
    }
    function drawField() {
      // the colour field, computed at 1/6 resolution and smoothed when scaled up
      var s = 6, fw = Math.ceil(W / s), fh = Math.ceil(H / s);
      field.width = fw; field.height = fh;
      if (!grid) { fieldDirty = false; return; }
      var img = fctx.createImageData(fw, fh), D = img.data;
      for (var y = 0; y < fh; y++) for (var x = 0; x < fw; x++) {
        var g = ll(x * s + s / 2, y * s + s / 2), wv = windAt(g[0], g[1], hour), k = (y * fw + x) * 4;
        if (!wv) continue;
        if (layer === 'rain') {
          var c = ramp(RAIN, wv.rain), base = ramp(STOPS, 4);
          var a = c[3] || 0;
          D[k] = (base[0] * (1 - a) + c[0] * a) * DIM; D[k + 1] = (base[1] * (1 - a) + c[1] * a) * DIM; D[k + 2] = (base[2] * (1 - a) + c[2] * a) * DIM; D[k + 3] = 255;
        } else {
          var cc = ramp(STOPS, wv.w); D[k] = cc[0] * DIM; D[k + 1] = cc[1] * DIM; D[k + 2] = cc[2] * DIM; D[k + 3] = 255;
        }
      }
      fctx.putImageData(img, 0, 0);
      fieldDirty = false;
    }
    function drawBase(lay) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#16263d'; ctx.fillRect(0, 0, W, H);
      if (fieldDirty) drawField();
      if (grid) {
        ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 0.92;
        ctx.drawImage(field, 0, 0, field.width * 6, field.height * 6);
        ctx.globalAlpha = 1;
      }
      if (!geo) return;
      // land: a dark veil over the field, so the coast reads; lakes back to water
      ctx.fillStyle = grid ? 'rgba(10,14,20,0.42)' : '#2a3442';
      geo.land.forEach(function (r) { path(r); ctx.closePath(); ctx.fill(); });
      ctx.fillStyle = grid ? 'rgba(22,38,61,0.35)' : '#16263d';
      (geo.lakes || []).forEach(function (r) { path(r); ctx.closePath(); ctx.fill(); });
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(8,10,14,0.85)'; ctx.lineWidth = 1.6;
      geo.land.forEach(function (r) { path(r); ctx.closePath(); ctx.stroke(); });
      ctx.strokeStyle = 'rgba(243,239,227,0.35)'; ctx.lineWidth = 0.6;
      geo.land.forEach(function (r) { path(r); ctx.closePath(); ctx.stroke(); });
      ctx.strokeStyle = 'rgba(160,200,255,0.35)'; ctx.lineWidth = 1;
      (geo.rivers || []).forEach(function (r) { path(r); ctx.stroke(); });
      ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(243,239,227,0.45)'; ctx.lineWidth = 1;
      (geo.borders || []).forEach(function (r) { path(r); ctx.stroke(); });
      ctx.setLineDash([]);
      // towns: the bigger ones first, more as you zoom in; never on top of a spot or another town
      var minRank = z < 6.8 ? 1 : z < 7.5 ? 2 : z < 8.2 ? 3 : 4, taken = [];
      var spotBoxes = (lay || []).map(function (o) { return [Math.min(o.x - 16, o.box[0]) - 4, o.y - 16, Math.max(o.x + 16, o.box[2]) + 4, o.y + 16]; });
      ctx.font = '600 10px "Space Mono", ui-monospace, monospace'; ctx.textBaseline = 'middle';
      (geo.towns || []).slice().sort(function (a, b) { return a[3] - b[3]; }).forEach(function (t) {
        if (t[3] > minRank) return;
        var q = px(t[1], t[2]);
        if (q[0] < -40 || q[0] > W + 40 || q[1] < -20 || q[1] > H + 20) return;
        var label = t[0].toUpperCase(), bw = ctx.measureText(label).width, box = [q[0] - 3, q[1] - 7, q[0] + 7 + bw, q[1] + 7];
        if (box[0] < 0 || box[2] > W) return;
        if (taken.concat(keepOut, spotBoxes).some(function (o) { return box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]; })) return;
        taken.push(box);
        ctx.fillStyle = 'rgba(243,239,227,0.9)'; ctx.beginPath(); ctx.arc(q[0], q[1], t[3] === 1 ? 2.6 : 1.8, 0, 7); ctx.fill();
        ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(10,14,20,0.75)'; ctx.strokeText(label, q[0] + 5, q[1]);
        ctx.fillStyle = 'rgba(243,239,227,0.82)'; ctx.fillText(label, q[0] + 5, q[1]);
      });
    }
    // the 2.7 verdict colours: EPIC pink, GOOD lime, OK yellow, NO GO sand
    var TONE = { epic: '#FF2D78', good: '#C8FF3D', ok: '#FFE14D', no: '#E7E2D4', none: '#C9C4B6', dark: '#5C6672' };
    var INK = { epic: '#FFFFFF' };
    // where each marker and its label go: markers that would overlap move apart a little; a label goes right of
    // its marker, or left, whichever is clear (and loses its second line when neither is)
    function layoutSpots() {
      var out = [], placed = [], done = [];
      ctx.font = '400 11px "Archivo Black", "Arial Black", sans-serif';
      spots.forEach(function (s) {
        var q = px(s.lat, s.lon), x = q[0], y = q[1];
        done.forEach(function (o) { var dx = x - o[0], dy = y - o[1], d = Math.hypot(dx, dy); if (d < 26) { var k = (26 - d) / (d || 1); x += (dx || 0.5) * k * 0.6; y += (dy || 1) * k; } });
        done.push([x, y]);
        placed.push([x - 14, y - 14, x + 14, y + 14]);
        out.push({ s: s, x: x, y: y, r: s.sel ? 15 : 13 });
      });
      out.forEach(function (o) {
        var s = o.s, nm = s.name.toUpperCase(), tw = Math.max(ctx.measureText(nm).width, s.small ? ctx.measureText(s.small).width * 0.92 : 0);
        var box = function (lx) { return [lx, o.y - 12, lx + tw, o.y + 13]; };
        var cost = function (b) {
          var c = (b[0] < 2 ? 50 + (2 - b[0]) : 0) + (b[2] > W - 2 ? 50 + (b[2] - W + 2) : 0);
          placed.concat(keepOut).forEach(function (q) { if (b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]) c += 10; });
          return c;
        };
        var R = box(o.x + o.r + 6), L = box(o.x - o.r - 6 - tw), cr = cost(R), cl = cost(L);
        var pick = cr <= cl ? R : L, c = Math.min(cr, cl);
        o.nm = nm; o.tw = tw; o.lx = pick[0]; o.small = c > 0 ? null : s.small; o.box = pick;
        placed.push(pick);
      });
      return out;
    }
    function drawSpots(now, lay) {
      hits = [];
      ctx.textBaseline = 'middle';
      lay.forEach(function (o) {
        var s = o.s, x = o.x, y = o.y, r = o.r;
        if (x < -30 || x > W + 30 || y < -30 || y > H + 30) return;
        var col = TONE[s.tone] || TONE.none;
        if (s.live || s.here) { // pulsing: a crew is there now
          var ph = ((now - t0) % 1600) / 1600;
          ctx.strokeStyle = 'rgba(255,45,120,' + (0.85 * (1 - ph)).toFixed(3) + ')'; ctx.lineWidth = 3;
          var e = r + 3 + ph * 14; ctx.strokeRect(x - e, y - e, e * 2, e * 2);
        }
        // a square sticker: hard black shadow, black border, the verdict colour, the number in Anton
        ctx.fillStyle = '#111111'; ctx.fillRect(x - r + 3, y - r + 3, r * 2, r * 2);
        ctx.fillRect(x - r - 1.5, y - r - 1.5, r * 2 + 3, r * 2 + 3);
        ctx.fillStyle = col; ctx.fillRect(x - r + 1, y - r + 1, r * 2 - 2, r * 2 - 2);
        if (s.sel) { ctx.strokeStyle = '#F3EFE3'; ctx.lineWidth = 2; ctx.strokeRect(x - r - 3.5, y - r - 3.5, r * 2 + 7, r * 2 + 7); }
        ctx.fillStyle = INK[s.tone] || '#111111'; ctx.font = '400 15px Anton, Impact, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(s.big == null ? '–' : String(s.big), x, y + 1);
        ctx.textAlign = 'left';
        ctx.font = '400 11px "Archivo Black", "Arial Black", sans-serif';
        ctx.fillStyle = '#111111'; ctx.fillText(o.nm, o.lx + 1.5, y - (o.small ? 5 : 0) + 1.5);
        ctx.fillStyle = '#FFFFFF'; ctx.fillText(o.nm, o.lx, y - (o.small ? 5 : 0));
        if (o.small) {
          ctx.font = '700 9.5px "Space Mono", ui-monospace, monospace';
          ctx.lineWidth = 3; ctx.strokeStyle = '#111111'; ctx.strokeText(o.small, o.lx, y + 8); ctx.fillStyle = col === TONE.no || col === TONE.none ? '#F3EFE3' : col; ctx.fillText(o.small, o.lx, y + 8);
        }
        if (s.crews) { // a yellow tag with the number of crews
          var bx = x + r - 1, by = y - r - 1, txt = String(s.crews);
          ctx.fillStyle = '#111111'; ctx.fillRect(bx - 8, by - 8, 17, 17);
          ctx.fillStyle = '#FFE14D'; ctx.fillRect(bx - 6.5, by - 6.5, 14, 14);
          ctx.fillStyle = '#111111'; ctx.font = '400 11px Anton, Impact, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(txt, bx + 0.5, by + 1); ctx.textAlign = 'left';
        }
        hits.push({ slug: s.slug, x: x, y: y, r: r + 10, lx: o.lx, w: o.tw });
      });
    }

    // ---------------------------------------------------------------- particles
    function seed() {
      var n = still ? 0 : Math.round(Math.min(2200, W * H / 260));
      parts = [];
      for (var i = 0; i < n; i++) parts.push({ x: Math.random() * W, y: Math.random() * H, a: Math.floor(Math.random() * 80) });
      tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, trail.width, trail.height);
    }
    function stepParticles() {
      tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      tctx.globalCompositeOperation = 'destination-in'; tctx.fillStyle = 'rgba(0,0,0,0.90)'; tctx.fillRect(0, 0, W, H);
      tctx.globalCompositeOperation = 'source-over';
      if (!grid) return;
      // speed on screen: grows with zoom, so the flow looks the same at every scale
      var k = 0.022 * Math.pow(2, z - 7.6);
      tctx.lineWidth = 1.1; tctx.strokeStyle = layer === 'rain' ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.8)';
      tctx.beginPath();
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i], g = ll(p.x, p.y), wv = windAt(g[0], g[1], hour);
        if (!wv || p.a++ > 90) { p.x = Math.random() * W; p.y = Math.random() * H; p.a = 0; continue; }
        var nx = p.x + wv.u * k * 3, ny = p.y - wv.v * k * 3;
        tctx.moveTo(p.x, p.y); tctx.lineTo(nx, ny);
        p.x = nx; p.y = ny;
        if (nx < 0 || nx > W || ny < 0 || ny > H) { p.x = Math.random() * W; p.y = Math.random() * H; p.a = 0; }
      }
      tctx.stroke();
    }
    function frame() {
      raf = 0;
      if (!visible) return;
      var now = Date.now();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var lay = layoutSpots();
      drawBase(lay);
      if (!still) { stepParticles(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(trail, 0, 0); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
      drawSpots(now, lay);
      if (!still || spots.some(function (s) { return s.live || s.here; })) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }

    // ---------------------------------------------------------------- moving around
    var pointers = {}, drag = null, moved = false;
    function zoomAt(nz, sx, sy) {
      nz = Math.max(6.4, Math.min(11.5, nz));
      var g = ll(sx, sy);
      z = nz;
      var q = px(g[0], g[1]); cx += q[0] - sx; cy += q[1] - sy;
      fieldDirty = true; seed(); kick();
    }
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', function (e) {
      cv.setPointerCapture(e.pointerId);
      pointers[e.pointerId] = { x: e.offsetX, y: e.offsetY };
      moved = false;
      var ids = Object.keys(pointers);
      drag = ids.length === 1 ? { x: e.offsetX, y: e.offsetY, cx: cx, cy: cy } : null;
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y), z: z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
      }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.offsetX, y: e.offsetY };
      var ids = Object.keys(pointers);
      if (drag && drag.pinch && ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
        zoomAt(drag.z + Math.log2(d / drag.pinch), drag.mx, drag.my); moved = true;
      } else if (drag && !drag.pinch) {
        var dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
        if (Math.hypot(dx, dy) > (e.pointerType === 'mouse' ? 4 : 12)) moved = true; // a finger wobbles on a tap: only a real drag pans
        if (moved) { cx = drag.cx - dx; cy = drag.cy - dy; fieldDirty = true; kick(); }
      }
    });
    function up(e) {
      var wasDrag = moved;
      delete pointers[e.pointerId];
      if (!Object.keys(pointers).length) { if (wasDrag) seed(); drag = null; }
      if (!wasDrag && e.type === 'pointerup') {
        var hit = hits.filter(function (h) { return (Math.hypot(h.x - e.offsetX, h.y - e.offsetY) < h.r) || (e.offsetX > h.lx && e.offsetX < h.lx + h.w && Math.abs(e.offsetY - h.y) < 12); })[0];
        if (hit && opts.onSpot) opts.onSpot(hit.slug);
      }
    }
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', function (e) { e.preventDefault(); zoomAt(z - e.deltaY * 0.0022, e.offsetX, e.offsetY); }, { passive: false });
    cv.addEventListener('pointermove', function (e) {
      if (Object.keys(pointers).length) return;
      var on = hits.some(function (h) { return Math.hypot(h.x - e.offsetX, h.y - e.offsetY) < h.r || (e.offsetX > h.lx && e.offsetX < h.lx + h.w && Math.abs(e.offsetY - h.y) < 12); });
      cv.style.cursor = on ? 'pointer' : 'grab';
    });
    var ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { var w = W, h = H; size(); if (w && (w !== W || h !== H)) kick(); }) : null;
    if (ro) ro.observe(host);
    var io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(function (es) { visible = es[0].isIntersecting && !document.hidden; if (visible) kick(); }) : null;
    if (io) io.observe(cv);
    function vis() { visible = !document.hidden; if (visible) kick(); }
    document.addEventListener('visibilitychange', vis);

    size();
    var api = {
      canvas: cv,
      setGrid: function (g) { grid = g || null; fieldDirty = true; kick(); },
      setHour: function (i) { if (i !== hour) { hour = i; fieldDirty = true; kick(); } },
      setLayer: function (l) { if (l !== layer) { layer = l; fieldDirty = true; kick(); } },
      setSpots: function (s) { spots = s || []; kick(); },
      setKeepOut: function (r) { keepOut = r || []; kick(); },
      setStill: function (b) { still = !!b; seed(); kick(); },
      // pad: pixels to keep free on each side ({ t, r, b, l }), for the buttons and the time bar
      fit: function (pts, pad) {
        size();
        if (typeof pad !== 'object' || !pad) pad = { t: pad || 40, r: pad || 40, b: pad || 40, l: pad || 40 };
        if (!pts.length) return;
        var la = pts.map(function (p) { return p[0]; }), lo = pts.map(function (p) { return p[1]; });
        var s = Math.min(Math.max.apply(null, la), 85), n = Math.max(Math.min.apply(null, la), -85), w0 = Math.min.apply(null, lo), e0 = Math.max.apply(null, lo);
        // the label sits right of each marker: leave it room
        var lab = W < 600 ? 70 : 110, aw = W - pad.l - pad.r - lab, ah = H - pad.t - pad.b;
        for (var zz = 11; zz >= 5; zz -= 0.05) {
          var w = lonX(e0, zz) - lonX(w0, zz), h = latY(n, zz) - latY(s, zz);
          if (w <= aw && h <= ah) { z = zz; break; }
        }
        z = Math.min(z, 10.5);
        // centre the box inside the free area
        var bx = (lonX(w0, z) + lonX(e0, z)) / 2, by = (latY(s, z) + latY(n, z)) / 2;
        cx = bx + (pad.r + lab - pad.l) / 2; cy = by + (pad.b - pad.t) / 2;
        fieldDirty = true; seed(); kick();
      },
      zoom: function (d) { zoomAt(z + d, W / 2, H / 2); },
      at: function (lat, lon) { return px(lat, lon); },
      windAt: function (lat, lon) { return windAt(lat, lon, hour); },
      redraw: function () { fieldDirty = true; kick(); },
      frame: function () { frame(); },
      destroy: function () { if (raf) cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (io) io.disconnect(); document.removeEventListener('visibilitychange', vis); cv.remove(); }
    };
    return api;
  };
})();
