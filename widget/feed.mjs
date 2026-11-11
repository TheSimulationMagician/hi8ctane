// The home-screen widget's feed: the next good session for one region and sport, and who's going.
// One small JSON a phone widget can fetch every half hour. It uses the same forecast engine and
// ratings as the site (site/fx.js), so the widget and the app never disagree.
//
//   widgetFeed({ FX, spots, crews, city, sport, kg, now }) -> { v, updated, city, sport, next, week }
//
// spots: the region's spots (site/hi8.js, HI8.spotsOf(city)). crews: rows of the hi8_crews call.
// Runs in Node (tests, a cron) and in Deno (supabase/functions/widget).

const TZ = { amsterdam: 'Europe/Amsterdam', barcelona: 'Europe/Madrid', tarifa: 'Europe/Madrid' };
const pad = (n) => String(n).padStart(2, '0');

export function localNow(city, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ[city] || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour), m: Number(p.minute) };
}

export async function widgetFeed({ FX, spots, crews = [], city, sport = 'kite', kg = 75, now = new Date() }) {
  const t = localNow(city, now);
  const mine = spots.filter((s) => !s.sports || s.sports.indexOf(sport) >= 0);
  const data = await FX.fetchCity(city, mine);
  const live = crews.filter((c) => c.city === city && c.sport === sport && c.status === 'on' && c.day >= t.date);
  const week = [], found = [];
  for (let i = 0; i < 7; i++) {
    const date = FX.addDays(t.date, i);
    let best = null;
    for (const spot of mine) {
      const sp = data[spot.slug]; if (!sp) continue;
      const w = FX.windows(sp, date, sport, spot, { kg })[0];
      if (!w) continue;
      if (i === 0 && t.h * 60 + t.m > w.to * 60 - 90) continue; // today: only if 90 minutes are left
      if (!best || w.score > best.w.score) best = { spot, w };
    }
    const going = live.filter((c) => c.day === date).reduce((n, c) => n + (c.going || 0), 0);
    week.push({ date, day: FX.dayShort(date), label: best ? FX.label(best.w.score) : 'NO GO', tone: best ? FX.tone(best.w.score) : 'no', kt: best && best.w.w != null ? Math.round(best.w.w) : null, going });
    if (best && best.w.score >= 6) found.push({ date, ...best });
  }
  const f = found[0];
  let next = null;
  if (f) {
    const w = f.w, c = live.filter((x) => x.day === f.date && x.spot === f.spot.slug).sort((a, b) => (b.going || 0) - (a.going || 0))[0] || null;
    next = {
      date: f.date, day: f.date === t.date ? 'TODAY' : f.date === FX.addDays(t.date, 1) ? 'TOMORROW' : FX.dayShort(f.date),
      from: w.from, to: w.to, time: `${pad(w.from)}–${pad(w.to)}`,
      spot: f.spot.name, slug: f.spot.slug, label: FX.label(w.score), tone: FX.tone(w.score),
      kt: w.w != null ? Math.round(w.w) : null, gust: w.g != null ? Math.round(w.g) : null, dir: w.dir != null ? Math.round(w.dir) : null, compass: w.dir != null ? FX.compass(w.dir) : null,
      kite: sport === 'kite' && w.w != null && FX.kiteSize ? FX.kiteSize(w.w, kg) : null,
      going: c ? c.going || 0 : 0, seats: c ? c.seats_free || 0 : 0, crew: c ? c.code : null,
      url: c ? `https://hi8ctane.com/?c=${encodeURIComponent(c.code)}` : `https://hi8ctane.com/?city=${city}&sport=${sport}&go=${f.date}.${w.from}.${w.to}.${f.spot.slug}`
    };
  }
  return { v: 1, updated: now.toISOString(), city, sport, next, week };
}
