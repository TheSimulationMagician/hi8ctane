// The good-day meter, day-zero version: every hour from 09:00 to 17:00 gets a 0-10 score per sport,
// a day's score is its best two hours in a row. Same labels as the app: EPIC 9+, GOOD 6+, OK 4+, else NO GO.
const clamp = (x) => Math.max(0, Math.min(10, Math.round(x)));
export const label = (s) => (s >= 9 ? 'EPIC' : s >= 6 ? 'GOOD' : s >= 4 ? 'OK' : 'NO GO');
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compass = (deg) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

// Is a "from" direction inside [from, to] going clockwise (the range may cross north)? Returns degrees outside, 0 inside.
export function outside(deg, from, to) {
  const d = ((deg % 360) + 360) % 360;
  const inside = from <= to ? d >= from && d <= to : d >= from || d <= to;
  if (inside) return 0;
  const dist = (a, b) => { const x = Math.abs(a - b) % 360; return Math.min(x, 360 - x); };
  return Math.min(dist(d, from), dist(d, to));
}

const rainPenalty = (p) => (p >= 70 ? 2 : p >= 40 ? 1 : 0);

// h = { w, g, dir, rainP, rain, temp, wave, period }   (knots, degrees, %, mm, °C, m, s)
export function hourScore(sport, h, spot = {}) {
  if (sport === 'kite' || sport === 'wing') {
    const lo = sport === 'kite' ? 15 : 12, hi = 25, w = h.w;
    let s;
    if (w < (sport === 'kite' ? 11 : 9)) s = Math.max(0, w - 6) / 2;
    else if (w < lo) s = 5;
    else if (w <= hi) s = w >= lo + 2 && w <= hi - 2 ? 9 : 8;
    else if (w <= 30) s = 6;
    else s = 2;
    const gd = h.g - h.w; s -= gd > 10 ? 3 : gd > 7 ? 2 : gd > 5 ? 1 : 0;
    s -= rainPenalty(h.rainP);
    if (!spot.lake && spot.good_from != null) {
      const off = outside(h.dir, spot.good_from, spot.good_to);
      if (off > 30) s = Math.min(s, 1);            // offshore or side-offshore: no go
      else if (off > 0) s -= 2;                    // on the edge of safe
    }
    return clamp(s);
  }
  if (sport === 'sup') {
    let s = h.w <= 5 ? 9 : h.w <= 8 ? 7 : h.w <= 12 ? 4 : h.w <= 16 ? 2 : 0;
    if (h.w <= 3 && h.rainP < 30) s = 10;
    s -= rainPenalty(h.rainP); if (h.temp != null && h.temp < 5) s -= 1;
    return clamp(s);
  }
  if (sport === 'surf') {
    const wave = h.wave ?? 0, per = h.period ?? 0;
    let s = wave < 0.4 ? 1 : wave < 0.7 ? 3 : wave < 1 ? 5 : wave < 2 ? 7 : wave < 3 ? 6 : 4;
    s += per >= 10 ? 2 : per >= 8 ? 1 : per && per < 5 ? -1 : 0;
    if (h.w <= 6) s += 1;
    else if (spot.good_from != null) {
      const onshore = outside(h.dir, spot.good_from, spot.good_to) === 0;
      if (onshore) s -= h.w > 18 ? 3 : h.w > 12 ? 2 : 0; else if (h.w <= 15) s += 1;
    }
    if (wave < 0.4) s = Math.min(s, 2);
    return clamp(s);
  }
  if (sport === 'mtb') {
    let s = h.rainP < 30 && (h.rain ?? 0) < 0.2 ? 8 : h.rainP < 60 ? 5 : 2;
    if ((h.wetBefore ?? 0) > 5) s -= 2; else if ((h.wetBefore ?? 0) < 1 && s >= 8) s += 1;
    if (h.temp != null && h.temp < 2) s -= 1; if (h.w > 30) s -= 1;
    return clamp(s);
  }
  return 0;
}

// hours = [{ hour: 9..17, ...h }] for one day. Returns the best two-hour window.
export function dayScore(sport, hours, spot = {}) {
  const hs = hours.filter((x) => x.hour >= 9 && x.hour <= 17).sort((a, b) => a.hour - b.hour);
  if (!hs.length) return null;
  const sc = hs.map((h) => hourScore(sport, h, spot));
  let best = 0, at = 0;
  for (let i = 0; i < sc.length; i++) { const v = i + 1 < sc.length ? (sc[i] + sc[i + 1]) / 2 : sc[i]; if (v > best) { best = v; at = i; } }
  const score = clamp(best), h = hs[at];
  const end = Math.min(18, h.hour + 2);
  let key;
  if (sport === 'surf') key = `${(h.wave ?? 0).toFixed(1)} M · ${Math.round(h.period ?? 0)} S`;
  else if (sport === 'mtb') key = (h.rainP < 30 ? 'DRY' : `RAIN ${Math.round(h.rainP)}%`) + (h.temp != null ? ` · ${Math.round(h.temp)}°` : '');
  else key = `${Math.round(h.w)} KT ${compass(h.dir)}`;
  return { score, label: label(score), key, window: score >= 4 ? `${String(h.hour).padStart(2, '0')}–${String(end).padStart(2, '0')}` : null };
}
