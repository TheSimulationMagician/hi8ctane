/*
 * Hi8ctane live map (2.8, smooth since 2.25). Drawn by us on a canvas: no map service, no keys, works offline once loaded.
 *
 *   var m = HI8Map(el, { geo: HI8_GEO.barcelona, onSpot: fn(slug) });
 *   m.setGrid(FX.gridData.barcelona); m.setHour(i); m.setLayer('wind' | 'rain');
 *   m.setSpots([{ slug, name, lat, lon, tone, big, small, crews, going, seats, here, live, sel, fav }]);
 *   m.setDrives([{ from: [lat, lon], to: [lat, lon], seats, label }]);   cars going: a dashed road with a car on it
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
    // 2.25: the land, the towns and the colour field are drawn once into "base" and only redrawn when the view, the
    // hour or the layer changes. While a finger moves the map, base is just shifted and scaled: smooth on any phone.
    // three layers, stacked: the base (land, towns, colour field), the wind flow, and the markers on top (and the
    // finger events). While the map moves, the base is only moved by the browser (a CSS transform): nothing redraws.
    var base = document.createElement('canvas'), bctx = base.getContext('2d');
    base.className = 'map-layer map-base'; trail.className = 'map-layer map-flow';
    cv.className = 'map-canvas'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', opts.label || 'Live wind map with spots and crews');
    host.appendChild(base); host.appendChild(trail); host.appendChild(cv);
    var topDirty = true;
    var hint = document.createElement('div'); hint.className = 'map-hint'; hint.setAttribute('aria-hidden', 'true'); hint.textContent = 'TWO FINGERS TO MOVE THE MAP'; host.appendChild(hint);
    var W = 0, H = 0, z = 7.6, cx = 0, cy = 0, geo = opts.geo, grid = null, hour = 0, layer = 'wind', spots = [], hits = [], keepOut = [], drives = [];
    var parts = [], raf = 0, visible = true, still = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || !!opts.still;
    var t0 = Date.now(), bv = null, baseDirty = true, moving = false, vec = null, vw = 0, vh = 0, anim = null, lay = null, layKey = '';
    // cooperative gestures (phones, where the map sits in the page): one finger scrolls the page, two move the map
    var coop = !!opts.coop;
    var VS = 6; // the colour field and the wind vectors: one cell per 6 px

    function size() {
      var r = host.getBoundingClientRect();
      W = Math.max(50, Math.round(r.width)); H = Math.max(50, Math.round(r.height));
      [cv, base].forEach(function (c) { c.width = W * dpr; c.height = H * dpr; c.style.width = W + 'px'; c.style.height = H + 'px'; });
      trail.width = W; trail.height = H; trail.style.width = W + 'px'; trail.style.height = H + 'px'; // the flow is soft anyway: 1 pixel per pixel is plenty
      clamp(); topDirty = true;
      baseDirty = true; seed();
    }
    function setCoop(b) { coop = !!b; cv.style.touchAction = coop ? 'pan-y' : 'none'; }
    // Never look past the region we have outlines for: the land would just end. Zoom and pan stop at its box.
    function clamp() {
      var B = geo && geo.bbox; if (!B) return;
      for (var i = 0; i < 80 && (lonX(B[2], z) - lonX(B[0], z) < W || latY(B[1], z) - latY(B[3], z) < H); i++) z += 0.05;
      var x0 = lonX(B[0], z) + W / 2, x1 = lonX(B[2], z) - W / 2, y0 = latY(B[3], z) + H / 2, y1 = latY(B[1], z) - H / 2;
      cx = x1 < x0 ? (x0 + x1) / 2 : Math.max(x0, Math.min(x1, cx)); cy = y1 < y0 ? (y0 + y1) / 2 : Math.max(y0, Math.min(y1, cy));
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

    // ---------------------------------------------------------------- the base: field, land, towns (drawn once per view)
    function path(c, ring) {
      c.beginPath();
      ring.forEach(function (p, i) { var q = px(p[1], p[0]); if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]); });
    }
    function drawField() {
      // the colour field at 1/6 resolution (smoothed when scaled up), and the wind vectors the particles follow
      var fw = Math.ceil(W / VS), fh = Math.ceil(H / VS);
      field.width = fw; field.height = fh; vw = fw; vh = fh;
      vec = grid ? new Float32Array(fw * fh * 2) : null;
      if (!grid) return;
      var img = fctx.createImageData(fw, fh), D = img.data;
      for (var y = 0; y < fh; y++) for (var x = 0; x < fw; x++) {
        var g = ll(x * VS + VS / 2, y * VS + VS / 2), wv = windAt(g[0], g[1], hour), k = (y * fw + x) * 4;
        if (!wv) continue;
        vec[(y * fw + x) * 2] = wv.u; vec[(y * fw + x) * 2 + 1] = wv.v;
        if (layer === 'rain') {
          var c = ramp(RAIN, wv.rain), bs = ramp(STOPS, 4), a = c[3] || 0;
          D[k] = (bs[0] * (1 - a) + c[0] * a) * DIM; D[k + 1] = (bs[1] * (1 - a) + c[1] * a) * DIM; D[k + 2] = (bs[2] * (1 - a) + c[2] * a) * DIM; D[k + 3] = 255;
        } else {
          var cc = ramp(STOPS, wv.w); D[k] = cc[0] * DIM; D[k + 1] = cc[1] * DIM; D[k + 2] = cc[2] * DIM; D[k + 3] = 255;
        }
      }
      fctx.putImageData(img, 0, 0);
    }
    function renderBase() {
      var c = bctx;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.fillStyle = '#16263d'; c.fillRect(0, 0, W, H);
      drawField();
      if (grid) { c.imageSmoothingEnabled = true; c.globalAlpha = 0.92; c.drawImage(field, 0, 0, field.width * VS, field.height * VS); c.globalAlpha = 1; }
      if (geo) {
        // land: a dark veil over the field, so the coast reads; lakes back to water
        c.fillStyle = grid ? 'rgba(10,14,20,0.42)' : '#2a3442';
        geo.land.forEach(function (r) { path(c, r); c.closePath(); c.fill(); });
        c.fillStyle = grid ? 'rgba(22,38,61,0.35)' : '#16263d';
        (geo.lakes || []).forEach(function (r) { path(c, r); c.closePath(); c.fill(); });
        c.lineJoin = 'round';
        c.strokeStyle = 'rgba(8,10,14,0.85)'; c.lineWidth = 1.6;
        geo.land.forEach(function (r) { path(c, r); c.closePath(); c.stroke(); });
        c.strokeStyle = 'rgba(243,239,227,0.35)'; c.lineWidth = 0.6;
        geo.land.forEach(function (r) { path(c, r); c.closePath(); c.stroke(); });
        c.strokeStyle = 'rgba(160,200,255,0.35)'; c.lineWidth = 1;
        (geo.rivers || []).forEach(function (r) { path(c, r); c.stroke(); });
        c.setLineDash([4, 3]); c.strokeStyle = 'rgba(243,239,227,0.45)'; c.lineWidth = 1;
        (geo.borders || []).forEach(function (r) { path(c, r); c.stroke(); });
        c.setLineDash([]);
        // towns: the bigger ones first, more as you zoom in; never on top of a spot or another town
        var minRank = z < 6.8 ? 1 : z < 7.5 ? 2 : z < 8.2 ? 3 : 4, taken = [];
        var spotBoxes = layout().map(function (o) { return [Math.min(o.x - 16, o.box[0]) - 4, o.y - 16, Math.max(o.x + 16, o.box[2]) + 4, o.y + 16]; });
        c.font = '600 10px "Space Mono", ui-monospace, monospace'; c.textBaseline = 'middle';
        (geo.towns || []).slice().sort(function (a, b) { return a[3] - b[3]; }).forEach(function (t) {
          if (t[3] > minRank) return;
          var q = px(t[1], t[2]);
          if (q[0] < -40 || q[0] > W + 40 || q[1] < -20 || q[1] > H + 20) return;
          var label = t[0].toUpperCase(), bw = c.measureText(label).width, box = [q[0] - 3, q[1] - 7, q[0] + 7 + bw, q[1] + 7];
          if (box[0] < 0 || box[2] > W) return;
          if (taken.concat(keepOut, spotBoxes).some(function (o) { return box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1]; })) return;
          taken.push(box);
          c.fillStyle = 'rgba(243,239,227,0.9)'; c.beginPath(); c.arc(q[0], q[1], t[3] === 1 ? 2.6 : 1.8, 0, 7); c.fill();
          c.lineWidth = 3; c.strokeStyle = 'rgba(10,14,20,0.75)'; c.strokeText(label, q[0] + 5, q[1]);
          c.fillStyle = 'rgba(243,239,227,0.82)'; c.fillText(label, q[0] + 5, q[1]);
        });
      }
      bv = { z: z, cx: cx, cy: cy }; baseDirty = false; base.style.transform = '';
    }
    // the base as it was drawn, moved by the browser to where the view is now (a shift and a scale, no redraw)
    function placeBase() {
      var k = Math.pow(2, z - bv.z), ox = W / 2 - cx + k * (bv.cx - W / 2), oy = H / 2 - cy + k * (bv.cy - H / 2);
      base.style.transform = Math.abs(k - 1) < 1e-6 && Math.abs(ox) < 0.01 && Math.abs(oy) < 0.01 ? '' : 'matrix(' + k + ',0,0,' + k + ',' + ox + ',' + oy + ')';
    }
    function layout() {
      var key = z.toFixed(4) + ',' + cx.toFixed(1) + ',' + cy.toFixed(1) + ',' + W + ',' + H + ',' + spots.length;
      if (lay && layKey === key) return lay;
      layKey = key; lay = layoutSpots(); return lay;
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
    function drawDrives(now) {
      if (!drives.length) return;
      drives.forEach(function (d, i) {
        var a = px(d.from[0], d.from[1]), b = px(d.to[0], d.to[1]);
        var mx = (a[0] + b[0]) / 2 - (b[1] - a[1]) * 0.18, my = (a[1] + b[1]) / 2 + (b[0] - a[0]) * 0.18; // a gentle curve
        ctx.save();
        ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(17,17,17,.75)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(mx, my, b[0], b[1]); ctx.stroke();
        ctx.strokeStyle = '#FF2D78'; ctx.lineWidth = 2.5; ctx.setLineDash([7, 6]); ctx.lineDashOffset = -((now - t0) / 60) % 13;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.quadraticCurveTo(mx, my, b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
        // the car: it drives the road in 6 s, again and again
        var t = ((now - t0) / 6000 + i * 0.37) % 1, u = 1 - t;
        var cx2 = u * u * a[0] + 2 * u * t * mx + t * t * b[0], cy2 = u * u * a[1] + 2 * u * t * my + t * t * b[1];
        var dx = 2 * u * (mx - a[0]) + 2 * t * (b[0] - mx), dy = 2 * u * (my - a[1]) + 2 * t * (b[1] - my);
        ctx.translate(cx2, cy2); ctx.rotate(Math.atan2(dy, dx));
        ctx.fillStyle = '#111111'; ctx.fillRect(-8, -5, 17, 11); ctx.fillStyle = '#FF2D78'; ctx.fillRect(-7, -4, 15, 9); ctx.fillStyle = '#F3EFE3'; ctx.fillRect(1, -3, 4, 7);
        ctx.restore();
        // the start: a dot and the seats left
        ctx.fillStyle = '#111111'; ctx.beginPath(); ctx.arc(a[0], a[1], 5.5, 0, 7); ctx.fill(); ctx.fillStyle = '#FF2D78'; ctx.beginPath(); ctx.arc(a[0], a[1], 3.5, 0, 7); ctx.fill();
        if (d.label) {
          ctx.font = '700 9.5px "Space Mono", ui-monospace, monospace'; var lw = ctx.measureText(d.label).width + 10;
          ctx.fillStyle = '#111111'; ctx.fillRect(a[0] - lw / 2, a[1] + 8, lw, 15); ctx.fillStyle = '#F3EFE3'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(d.label, a[0], a[1] + 16); ctx.textAlign = 'left';
        }
      });
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
        if (s.fav) { ctx.save(); ctx.shadowColor = '#C8FF3D'; ctx.shadowBlur = 14; ctx.strokeStyle = '#C8FF3D'; ctx.lineWidth = 2.5; ctx.strokeRect(x - r - 5, y - r - 5, r * 2 + 10, r * 2 + 10); ctx.restore(); }
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
        var ty = 0;
        if (s.crews) { // who's going: "3 GOING · 1 SEAT" under the marker, pink when there's a seat to take
          var seat = s.seats > 0, tag = (s.going || 0) + ' GOING' + (seat ? ' · ' + s.seats + ' SEAT' + (s.seats > 1 ? 'S' : '') : '');
          ctx.font = '700 9.5px "Space Mono", ui-monospace, monospace';
          var tw2 = ctx.measureText(tag).width + 10, tx = x - tw2 / 2; ty = y + r + 5;
          ctx.fillStyle = '#111111'; ctx.fillRect(tx + 2, ty + 2, tw2, 15);
          ctx.fillStyle = seat ? '#FF2D78' : '#FFE14D'; ctx.fillRect(tx, ty, tw2, 15);
          ctx.strokeStyle = '#111111'; ctx.lineWidth = 1.5; ctx.strokeRect(tx, ty, tw2, 15);
          ctx.fillStyle = seat ? '#FFFFFF' : '#111111'; ctx.textAlign = 'center'; ctx.fillText(tag, x, ty + 8); ctx.textAlign = 'left';
          if (s.crews > 1) { // and how many crews, in the corner
            var bx = x + r - 1, by = y - r - 1;
            ctx.fillStyle = '#111111'; ctx.fillRect(bx - 8, by - 8, 17, 17);
            ctx.fillStyle = '#FFE14D'; ctx.fillRect(bx - 6.5, by - 6.5, 14, 14);
            ctx.fillStyle = '#111111'; ctx.font = '400 11px Anton, Impact, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(s.crews), bx + 0.5, by + 1); ctx.textAlign = 'left';
          }
        }
        hits.push({ slug: s.slug, x: x, y: y + (ty ? 8 : 0), r: r + 10 + (ty ? 8 : 0), lx: o.lx, w: o.tw });
      });
    }

    // ---------------------------------------------------------------- particles (they follow the vectors of the field)
    function seed() {
      var n = still ? 0 : Math.round(Math.min(320, W * H / 2200));
      parts = [];
      for (var i = 0; i < n; i++) parts.push({ x: Math.random() * W, y: Math.random() * H, a: Math.floor(Math.random() * 160) });
      tctx.setTransform(1, 0, 0, 1, 0, 0); tctx.clearRect(0, 0, trail.width, trail.height);
    }
    function stepParticles() {
      tctx.setTransform(1, 0, 0, 1, 0, 0);
      tctx.globalCompositeOperation = 'destination-in'; tctx.fillStyle = 'rgba(0,0,0,0.955)'; tctx.fillRect(0, 0, W, H);
      tctx.globalCompositeOperation = 'source-over';
      if (!vec) return;
      var k = 0.022 * Math.pow(2, z - 7.6) * 1.3; // speed on screen grows with zoom: the flow looks the same at every scale
      tctx.lineWidth = 1.2; tctx.strokeStyle = layer === 'rain' ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.45)';
      tctx.beginPath();
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i], ix = (p.x / VS) | 0, iy = (p.y / VS) | 0, j = (iy * vw + ix) * 2;
        if (ix < 0 || iy < 0 || ix >= vw || iy >= vh || p.a++ > 170 || (vec[j] === 0 && vec[j + 1] === 0)) { p.x = Math.random() * W; p.y = Math.random() * H; p.a = 0; continue; }
        var nx = p.x + vec[j] * k, ny = p.y - vec[j + 1] * k;
        tctx.moveTo(p.x, p.y); tctx.lineTo(nx, ny);
        p.x = nx; p.y = ny;
      }
      tctx.stroke();
    }
    function frame() {
      raf = 0;
      if (!visible) return;
      var now = Date.now(), wasLay = layKey;
      if (anim) stepAnim(now);
      var busy = moving || !!anim;
      if ((baseDirty && !busy) || !bv) { renderBase(); seed(); topDirty = true; }
      placeBase();
      trail.style.opacity = busy || baseDirty ? '0' : '1';
      if (!still && !busy && !baseDirty) stepParticles();
      var live = drives.length || spots.some(function (s) { return s.live || s.here; });
      if (busy || topDirty || live || layout() && layKey !== wasLay) {
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawDrives(now); drawSpots(now, layout()); topDirty = false;
      }
      if (anim || (moving && baseDirty) || !still || live) raf = requestAnimationFrame(frame);
    }
    function kick() { if (!raf) raf = requestAnimationFrame(frame); }

    // ---------------------------------------------------------------- moving around
    var pointers = {}, drag = null, moved = false, lastTap = null, vel = null, hintT = 0;
    function zoomAt(nz, sx, sy) {
      nz = Math.max(6.4, Math.min(11.5, nz));
      var g = ll(sx, sy);
      z = nz;
      var q = px(g[0], g[1]); cx += q[0] - sx; cy += q[1] - sy; clamp();
      baseDirty = true; kick();
    }
    // smooth: zoom to nz around a point, or glide after a fling, in a few frames; base is redrawn once at the end
    function animateZoom(nz, sx, sy) { anim = { kind: 'zoom', from: z, to: Math.max(6.4, Math.min(11.5, nz)), sx: sx, sy: sy, t: Date.now(), d: 240 }; kick(); }
    function stepAnim(now) {
      var a = anim, t = Math.min(1, (now - a.t) / a.d), e = 1 - Math.pow(1 - t, 3);
      if (a.pan) { cx = a.pan[0][0] + (a.pan[1][0] - a.pan[0][0]) * e; cy = a.pan[0][1] + (a.pan[1][1] - a.pan[0][1]) * e; clamp(); baseDirty = true; }
      else if (a.kind === 'zoom') zoomAt(a.from + (a.to - a.from) * e, a.sx, a.sy);
      else { var f = Math.pow(0.9, (now - a.last) / 16); a.vx *= f; a.vy *= f; a.last = now; cx -= a.vx * 16; cy -= a.vy * 16; clamp(); baseDirty = true; if (Math.hypot(a.vx, a.vy) < 0.02) t = 1; }
      if (t >= 1) { anim = null; baseDirty = true; }
    }
    function showHint() { hint.classList.add('on'); clearTimeout(hintT); hintT = setTimeout(function () { hint.classList.remove('on'); }, 1400); }
    function pos(e) { var r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
    cv.addEventListener('pointerdown', function (e) {
      var p = pos(e);
      pointers[e.pointerId] = p;
      anim = null; moved = false; vel = null;
      var ids = Object.keys(pointers);
      if (ids.length === 1) drag = { x: p.x, y: p.y, cx: cx, cy: cy, t: Date.now(), touch: e.pointerType === 'touch' };
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        drag = { pinch: Math.hypot(a.x - b.x, a.y - b.y), z: z, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: cx, cy: cy };
        try { cv.setPointerCapture(e.pointerId); } catch (x) {}
      } else if (!(coop && e.pointerType === 'touch')) { try { cv.setPointerCapture(e.pointerId); } catch (x) {} }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!pointers[e.pointerId]) {
        if (e.pointerType === 'mouse') { var q0 = pos(e); cv.style.cursor = hitAt(q0.x, q0.y) ? 'pointer' : 'grab'; }
        return;
      }
      var p = pos(e); pointers[e.pointerId] = p;
      var ids = Object.keys(pointers);
      if (drag && drag.pinch && ids.length === 2) {
        e.preventDefault();
        var a = pointers[ids[0]], b = pointers[ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        // two fingers: pan with their middle, zoom with their spread
        cx = drag.cx - (mx - drag.mx); cy = drag.cy - (my - drag.my); clamp();
        zoomAt(drag.z + Math.log2(d / drag.pinch), mx, my);
        drag.cx = cx; drag.cy = cy; drag.mx = mx; drag.my = my; drag.z = z; drag.pinch = d;
        moved = true; moving = true;
      } else if (drag && !drag.pinch) {
        var dx = p.x - drag.x, dy = p.y - drag.y;
        if (Math.hypot(dx, dy) > (e.pointerType === 'mouse' ? 4 : 12)) moved = true; // a finger wobbles on a tap: only a real drag counts
        if (!moved) return;
        if (coop && drag.touch) { if (Math.abs(dx) > Math.abs(dy)) showHint(); return; } // one finger on a phone: the page scrolls
        var now = Date.now(), ncx = drag.cx - dx, ncy = drag.cy - dy;
        if (drag.lt) vel = { vx: (cx - ncx) / Math.max(1, now - drag.lt) * -1, vy: (cy - ncy) / Math.max(1, now - drag.lt) * -1 };
        drag.lt = now; cx = ncx; cy = ncy; clamp(); baseDirty = true; moving = true; kick();
      }
    });
    function up(e) {
      var wasDrag = moved, p = pos(e);
      delete pointers[e.pointerId];
      if (Object.keys(pointers).length) { var id = Object.keys(pointers)[0]; drag = { x: pointers[id].x, y: pointers[id].y, cx: cx, cy: cy, touch: e.pointerType === 'touch', after: true }; return; }
      var was = drag; drag = null; moving = false;
      if (wasDrag) {
        // a fling with the mouse (or two fingers) glides a little further
        if (vel && !coop && Math.hypot(vel.vx, vel.vy) > 0.15) anim = { kind: 'glide', vx: -vel.vx, vy: -vel.vy, last: Date.now(), t: Date.now(), d: 1e9 };
        baseDirty = true; kick(); return;
      }
      if (e.type !== 'pointerup' || (was && was.after)) return;
      var hit = hitAt(p.x, p.y), now = Date.now();
      if (hit) { lastTap = null; if (opts.onSpot) opts.onSpot(hit.slug); return; }
      // double tap on the sea or the land: zoom in there
      if (lastTap && now - lastTap.t < 320 && Math.hypot(lastTap.x - p.x, lastTap.y - p.y) < 30) { lastTap = null; animateZoom(z + 1, p.x, p.y); return; }
      lastTap = { t: now, x: p.x, y: p.y };
      if (opts.onEmpty) opts.onEmpty();
    }
    function hitAt(x, y) {
      return hits.filter(function (h) { return Math.hypot(h.x - x, h.y - y) < h.r || (x > h.lx && x < h.lx + h.w && Math.abs(y - h.y) < 13); })[0] || null;
    }
    cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', function (e) { moved = true; up(e); });
    cv.addEventListener('wheel', function (e) {
      if (coop && !e.ctrlKey) return; // in the page: the wheel scrolls the page (a trackpad pinch still zooms)
      e.preventDefault(); var p = pos(e); zoomAt(z - e.deltaY * (e.ctrlKey ? 0.01 : 0.0022), p.x, p.y); moving = true;
      clearTimeout(cv._wt); cv._wt = setTimeout(function () { moving = false; baseDirty = true; kick(); }, 140);
    }, { passive: false });
    cv.addEventListener('dblclick', function (e) { e.preventDefault(); var p = pos(e); animateZoom(z + 1, p.x, p.y); });
    var ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(function () { var w = W, h = H; size(); if (w && (w !== W || h !== H)) kick(); }) : null;
    if (ro) ro.observe(host);
    var io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(function (es) { visible = es[0].isIntersecting && !document.hidden; if (visible) kick(); }) : null;
    if (io) io.observe(cv);
    function vis() { visible = !document.hidden; if (visible) kick(); }
    document.addEventListener('visibilitychange', vis);

    setCoop(coop);
    size();
    var api = {
      canvas: cv,
      setGrid: function (g) { grid = g || null; baseDirty = true; kick(); },
      setHour: function (i) { if (i !== hour) { hour = i; baseDirty = true; kick(); } },
      setLayer: function (l) { if (l !== layer) { layer = l; baseDirty = true; kick(); } },
      setSpots: function (s) { spots = s || []; lay = null; baseDirty = true; topDirty = true; kick(); },
      setDrives: function (d) { drives = d || []; topDirty = true; kick(); },
      setKeepOut: function (r) { keepOut = r || []; lay = null; baseDirty = true; kick(); },
      setStill: function (b) { still = !!b; seed(); kick(); },
      setCoop: setCoop,
      // pad: pixels to keep free on each side ({ t, r, b, l }), for the buttons and the time bar
      fit: function (pts, pad) {
        size();
        if (typeof pad !== 'object' || !pad) pad = { t: pad || 40, r: pad || 40, b: pad || 40, l: pad || 40 };
        if (!pts.length) return;
        var la = pts.map(function (p) { return p[0]; }), lo = pts.map(function (p) { return p[1]; });
        var s = Math.min(Math.max.apply(null, la), 85), n = Math.max(Math.min.apply(null, la), -85), w0 = Math.min.apply(null, lo), e0 = Math.max.apply(null, lo);
        var lab = W < 600 ? 70 : 110, aw = W - pad.l - pad.r - lab, ah = H - pad.t - pad.b;
        for (var zz = 11; zz >= 5; zz -= 0.05) {
          var w = lonX(e0, zz) - lonX(w0, zz), h = latY(n, zz) - latY(s, zz);
          if (w <= aw && h <= ah) { z = zz; break; }
        }
        z = Math.min(z, 10.5);
        var bx = (lonX(w0, z) + lonX(e0, z)) / 2, by = (latY(s, z) + latY(n, z)) / 2;
        cx = bx + (pad.r + lab - pad.l) / 2; cy = by + (pad.b - pad.t) / 2; clamp();
        lay = null; baseDirty = true; seed(); kick();
      },
      // glide the view so this spot sits at (sx, sy) on the map (used when a spot is picked)
      center: function (lat, lon, sx, sy) {
        var q = px(lat, lon), tx = sx == null ? W / 2 : sx, ty = sy == null ? H / 2 : sy, ox = q[0] - tx, oy = q[1] - ty;
        if (Math.hypot(ox, oy) < 4) return;
        anim = { kind: 'zoom', from: z, to: z, sx: W / 2, sy: H / 2, t: Date.now(), d: 320, pan: [[cx, cy], [cx + ox, cy + oy]] };
        kick();
      },
      zoom: function (d) { animateZoom(z + d, W / 2, H / 2); },
      at: function (lat, lon) { return px(lat, lon); },
      windAt: function (lat, lon) { return windAt(lat, lon, hour); },
      redraw: function () { baseDirty = true; kick(); },
      frame: function () { frame(); },
      destroy: function () { if (raf) cancelAnimationFrame(raf); if (ro) ro.disconnect(); if (io) io.disconnect(); document.removeEventListener('visibilitychange', vis); cv.remove(); base.remove(); trail.remove(); hint.remove(); }
    };
    return api;
  };
})();
