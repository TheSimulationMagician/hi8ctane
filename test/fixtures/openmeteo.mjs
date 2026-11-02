// Synthetic Open-Meteo responses for tests and the local preview (no network needed).
// Day 0..4 from `start` (past_days=1 means the first day is yesterday). Shapes match the real API.
export function hourly(start, days, fn) {
  const time = [], cols = {};
  const d0 = new Date(start + 'T00:00:00Z');
  for (let d = 0; d < days; d++) for (let hr = 0; hr < 24; hr++) {
    const t = new Date(d0.getTime() + (d * 24 + hr) * 3600e3).toISOString().slice(0, 13) + ':00';
    time.push(t);
    for (const [k, v] of Object.entries(fn(d, hr))) (cols[k] ||= []).push(v);
  }
  return { time, ...cols };
}
// A west-coast autumn week: yesterday wet, today a SW 20-23 kt afternoon, tomorrow light + rain, then a big gusty W day, then glassy.
export function forecastFor(lat, start) {
  const plan = [
    { w: 14, gd: 6, dir: 240, p: 80, r: 1.2, t: 12 },
    { w: 21, gd: 5, dir: 230, p: 10, r: 0, t: 13 },
    { w: 7, gd: 3, dir: 270, p: 75, r: 0.8, t: 11 },
    { w: 26, gd: 10, dir: 280, p: 20, r: 0, t: 12 },
    { w: 4, gd: 2, dir: 90, p: 5, r: 0, t: 10 },
  ];
  const coast = lat < 45 ? -4 : 0;               // Barcelona: lighter
  return { latitude: lat, timezone: lat < 45 ? 'Europe/Madrid' : 'Europe/Amsterdam', hourly: hourly(start, 5, (d, hr) => {
    const P = plan[d], aft = hr >= 12 && hr <= 16 ? 2 : 0;
    return { wind_speed_10m: Math.max(0, P.w + aft + coast), wind_gusts_10m: Math.max(0, P.w + aft + coast + P.gd), wind_direction_10m: P.dir, precipitation_probability: P.p, precipitation: P.r, temperature_2m: P.t };
  }) };
}
export function marineFor(lat, start) {
  const waves = [[1.8, 7], [1.2, 9], [1.4, 10], [2.4, 7], [0.5, 6]];
  return { latitude: lat, hourly: hourly(start, 5, (d) => ({ wave_height: waves[d][0], wave_period: waves[d][1] })) };
}
