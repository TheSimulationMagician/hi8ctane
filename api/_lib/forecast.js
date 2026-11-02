// Fetches the hourly forecast for a city's launch spots from Open-Meteo and rates the next four days.
// With OPEN_METEO_API_KEY set it uses the commercial endpoints (customer-*.open-meteo.com + &apikey=).
import { CITIES, SPORT_ORDER } from './spots.js';
import { dayScore } from './meter.js';

const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export function endpoints(cfg) {
  const paid = Boolean(cfg.meteoKey);
  return {
    forecast: process.env.OPEN_METEO_BASE || (paid ? 'https://customer-api.open-meteo.com' : 'https://api.open-meteo.com'),
    marine: process.env.OPEN_METEO_MARINE_BASE || (paid ? 'https://customer-marine-api.open-meteo.com' : 'https://marine-api.open-meteo.com'),
    key: paid ? `&apikey=${encodeURIComponent(cfg.meteoKey)}` : '',
    licence: paid ? 'commercial' : 'free',
  };
}

const list = (a) => (Array.isArray(a) ? a : [a]);

export function localParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) };
}

const addDays = (day, n) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// Turns one location's Open-Meteo hourly block (+ optional marine block) into { 'YYYY-MM-DD': [hour rows] }.
export function byDay(wx, sea) {
  const H = wx.hourly, out = {};
  const seaAt = {};
  if (sea && sea.hourly) sea.hourly.time.forEach((t, i) => { seaAt[t] = { wave: sea.hourly.wave_height[i], period: sea.hourly.wave_period[i] }; });
  H.time.forEach((t, i) => {
    const day = t.slice(0, 10), hour = Number(t.slice(11, 13));
    (out[day] ||= []).push({ t, hour, w: H.wind_speed_10m[i] ?? 0, g: H.wind_gusts_10m[i] ?? H.wind_speed_10m[i] ?? 0, dir: H.wind_direction_10m[i] ?? 0,
      rainP: H.precipitation_probability ? H.precipitation_probability[i] ?? 0 : 0, rain: H.precipitation ? H.precipitation[i] ?? 0 : 0,
      temp: H.temperature_2m ? H.temperature_2m[i] : null, ...(seaAt[t] || {}) });
  });
  // rain in the 24 hours before 09:00, for the trails
  const all = Object.values(out).flat();
  for (const rows of Object.values(out)) {
    const nine = rows.find((r) => r.hour === 9);
    if (!nine) continue;
    const idx = all.indexOf(nine);
    const wet = all.slice(Math.max(0, idx - 24), idx).reduce((a, r) => a + (r.rain || 0), 0);
    rows.forEach((r) => { r.wetBefore = wet; });
  }
  return out;
}

export async function getWeek(cfg, cityKey = 'ams', { now = new Date(), fetchImpl = fetch } = {}) {
  const city = CITIES[cityKey];
  if (!city) throw new Error('unknown_city');
  const ep = endpoints(cfg), tz = encodeURIComponent(city.tz);
  const lat = city.spots.map((s) => s.lat).join(','), lon = city.spots.map((s) => s.lon).join(',');
  const surfSpots = city.spots.filter((s) => s.sports.includes('surf'));
  const wxUrl = `${ep.forecast}/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,precipitation_probability,precipitation,temperature_2m&wind_speed_unit=kn&timezone=${tz}&forecast_days=4&past_days=1${ep.key}`;
  const seaUrl = surfSpots.length ? `${ep.marine}/v1/marine?latitude=${surfSpots.map((s) => s.lat).join(',')}&longitude=${surfSpots.map((s) => s.lon).join(',')}&hourly=wave_height,wave_period&timezone=${tz}&forecast_days=4&past_days=1${ep.key}` : null;
  const get = async (u) => { const r = await fetchImpl(u, { signal: AbortSignal.timeout(7000) }); if (!r.ok) throw new Error('forecast_' + r.status); return r.json(); };
  const [wx, sea] = await Promise.all([get(wxUrl), seaUrl ? get(seaUrl).catch(() => null) : Promise.resolve(null)]);
  const wxL = list(wx), seaL = sea ? list(sea) : [];

  const perSpot = city.spots.map((s, i) => ({ spot: s, days: byDay(wxL[i], s.sports.includes('surf') ? seaL[surfSpots.indexOf(s)] : null) }));
  const here = localParts(now, city.tz);
  const dayKeys = [0, 1, 2, 3].map((n) => addDays(here.day, n));
  const days = dayKeys.map((d, n) => ({ date: d, label: n === 0 ? 'TODAY' : n === 1 ? 'TMRW' : WD[new Date(d + 'T12:00:00Z').getUTCDay()] }));

  const rows = SPORT_ORDER.filter((sp) => city.spots.some((s) => s.sports.includes(sp))).map((sp) => ({
    sport: sp,
    cells: dayKeys.map((d, n) => {
      let best = null;
      for (const { spot, days: byD } of perSpot) {
        if (!spot.sports.includes(sp)) continue;
        let hours = byD[d] || [];
        if (n === 0) hours = hours.filter((h) => h.hour >= here.hour);
        if (sp === 'surf' && !hours.some((h) => h.wave != null)) continue;
        const r = dayScore(sp, hours, spot);
        if (r && (!best || r.score > best.score)) best = { ...r, spot: spot.name };
      }
      return best || { score: null, label: n === 0 ? 'DONE' : 'NO DATA', key: n === 0 ? 'AFTER DARK' : '', spot: '', window: null };
    }),
  }));
  return { ok: true, city: cityKey, cityName: city.name, tz: city.tz, updated: now.toISOString(), licence: ep.licence, days, rows,
    source: 'Open-Meteo (KNMI, DWD, ECMWF and Météo-France models), CC BY 4.0' };
}
