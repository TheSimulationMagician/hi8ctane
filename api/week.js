// GET /api/week?city=ams|bcn → the next four days rated per sport. Cached at Vercel's edge for 30 minutes.
import { env } from './_lib/env.js';
import { json } from './_lib/http.js';
import { getWeek } from './_lib/forecast.js';

export async function GET(request) {
  const cfg = env();
  const city = new URL(request.url).searchParams.get('city') === 'bcn' ? 'bcn' : 'ams';
  if (cfg.forecastOff) return json({ ok: false, reason: 'off' }, 200, { 'cache-control': 'public, s-maxage=300' });
  try {
    const week = await getWeek(cfg, city);
    return json(week, 200, { 'cache-control': 'public, max-age=60, s-maxage=1800, stale-while-revalidate=3600' });
  } catch (e) {
    console.error('week', city, e && e.message);
    return json({ ok: false, reason: 'unavailable' }, 200, { 'cache-control': 'public, s-maxage=120' });
  }
}
