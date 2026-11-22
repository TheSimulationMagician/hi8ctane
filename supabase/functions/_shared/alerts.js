// The alert worker (2.23, in Supabase since 2.27): one run, every 10 minutes. Shared by the Edge Function
// (supabase/functions/alerts, started by pg_cron) and by scripts/alerts.mjs (a manual run, and the tests).
//
//  0. The shared forecast (2.27): every 30 minutes, each region's forecast for all its spots and the map's wind grid,
//     fetched once here and published as fx/<city>.json and fx/grid-<city>.json in Storage. Every visitor reads that
//     file instead of calling Open-Meteo: faster pages, a fraction of the forecast calls, and the site and the
//     alerts look at the same forecast.
//  1. Wind alerts: for every rider's alert (wind_alerts), the forecast at their spots, checked with the same
//     engine as the site (site/fx.js) against THEIR conditions. One alert per rider, sport and day:
//     the evening before (18:00-22:00) or that morning (07:00-21:00, if the window hasn't started).
//  2. Forecast dropped: every crew today and tomorrow whose own window went NO GO gets one message.
//  3. How was it: the morning after a session (or 2 hours after it ended), one "how was it?" per rider.
//  4. Push: everything waiting in push_queue goes to the riders' phones.
//
// opts: { rpc(name, args), FX, site, vapid: { publicKey, privateKey } | null, upload(name, json) | null,
//         testHour, dry, log, fetch }
import { send, vapidKeys } from './webpush.js';

export async function runAlerts(opts) {
  const { rpc, FX } = opts;
  const SITE = (opts.site || 'https://hi8ctane.com').replace(/\/$/, '');
  const DRY = !!opts.dry;
  const log = opts.log || (() => {});
  const env = { TEST_HOUR: opts.testHour };
  let VAPID_PUB = opts.vapid && opts.vapid.publicKey || '', VAPID_PRIV = opts.vapid && opts.vapid.privateKey || '';
  const report = { cached: [], alerts: 0, alertsNew: 0, drops: 0, rates: 0, asks: 0, rechecks: 0, backOn: 0, captainsGone: 0, push: { waiting: 0, done: 0, delivered: 0, gone: 0, failed: 0 } };
  const SPORT = { kite: ['Kite', '🪁'], wing: ['Wing', '🪽'], windsurf: ['Windsurf', '🏄'], surf: ['Surf', '🏄'], sup: ['SUP', '🛶'], mtb: ['MTB', '🚵'], mx: ['MX', '🏍️'] };
  const WINDY = { kite: 1, wing: 1, windsurf: 1 };
  const pad = (n) => (n < 10 ? '0' : '') + n;
  const DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dayWord = (d, today) => d === today ? 'today' : d === FX.addDays(today, 1) ? 'tomorrow' : DAYN[new Date(d + 'T12:00:00Z').getUTCDay()];
  const shoreWord = (s) => ({ onshore: 'onshore', 'cross-on': 'cross-on', 'side-shore': 'side-shore', 'cross-off': 'cross-off: experts', lagoon: 'flat lagoon' }[s] || '');
  const hourOf = (t) => Number(String(t).slice(11, 13)) + Number(String(t).slice(14, 16)) / 60;
  const scoreOf = (w) => w.score * Math.sqrt(w.hours);

  const J = await rpc('hi8_worker_jobs');
  const city = Object.fromEntries((J.cities || []).map((c) => [c.slug, c]));
  const spot = Object.fromEntries((J.spots || []).map((s) => [s.slug, s]));
  // 0. the shared forecast: the regions that are due get all their spots fetched and published
  const D = {};
  if (opts.upload) {
    const due = (await rpc('hi8_fx_due')) || [];
    for (const d of due) {
      try {
        const sp = await FX.fetchCity(d.city, d.spots);
        const out = { v: FX.V, at: Date.now(), city: d.city, spots: sp };
        await opts.upload(d.city + '.json', out);
        let grid = null;
        try { grid = await FX.grid(d.city, true); if (grid) await opts.upload('grid-' + d.city + '.json', grid); } catch (e) { log('grid for', d.city, 'failed:', e.message); }
        if (!DRY) await rpc('hi8_fx_cached', { p_city: d.city, p_spots: Object.keys(sp).length, p_grid: !!grid });
        D[d.city] = sp; report.cached.push(d.city);
      } catch (e) { log('shared forecast for', d.city, 'failed:', e.message); }
    }
    if (report.cached.length) log('shared forecast published:', report.cached.join(', '));
  }
  // the forecast for the spots the alerts and crews need (from what was just fetched, or fetched now)
  for (const c of Object.keys(city)) {
    const list = (J.spots || []).filter((s) => s.city === c && !(D[c] && D[c][s.slug]));
    if (!list.length) continue;
    try { D[c] = Object.assign(D[c] || {}, await FX.fetchCity(c, list)); } catch (e) { log('forecast for', c, 'failed:', e.message); }
  }
  const fx = (slug) => { const s = spot[slug]; return s && D[s.city] ? D[s.city][slug] : null; };
  const items = [];

  // 1. wind alerts
  const watching = {};
  for (const r of J.rules || []) for (const s of r.spots) watching[s] = (watching[s] || 0) + 1;
  for (const r of J.rules || []) {
    const C = city[r.city]; if (!C || (!r.push && !r.mail)) continue;
    const nowH = env.TEST_HOUR ? Number(env.TEST_HOUR) : hourOf(C.now), today = C.today, dates = [];
    if (nowH >= 7 && nowH < 21) dates.push(today);
    if (nowH >= 18 && nowH < 22) dates.push(FX.addDays(today, 1));
    for (const date of dates) {
      const found = [];
      for (const slug of r.spots) {
        const sp = fx(slug), meta = spot[slug]; if (!sp || !meta) continue;
        let ws = FX.alertWindows(sp, date, r.sport, meta, r, { kg: r.kg || 75 });
        if (date === today) ws = ws.map((w) => Object.assign({}, w, { from: Math.max(w.from, Math.ceil(nowH + 1)) })).filter((w) => w.to - w.from >= (r.min_hours || 2)).map((w) => Object.assign(w, { hours: w.to - w.from }));
        if (ws[0]) found.push(Object.assign({ spot: meta }, ws[0]));
      }
      if (!found.length) continue;
      found.sort((a, b) => scoreOf(b) - scoreOf(a));
      const w = found[0], also = found.slice(1, 3).map((x) => x.spot.name);
      const crews = (J.crews || []).filter((c) => c.spot === w.spot.slug && c.day === date && c.sport === r.sport && c.status === 'on' && !c.past &&
        Number(c.start.slice(0, 2)) < w.to && Number(c.start.slice(0, 2)) + 3 > w.from);
      const cr = crews.sort((a, b) => (b.seats_free || 0) - (a.seats_free || 0) || b.going - a.going)[0];
      const [name, em] = SPORT[r.sport] || [r.sport, ''];
      const when = dayWord(date, today) + ' ' + pad(w.from) + '–' + pad(w.to);
      const cond = WINDY[r.sport] ? (w.wmin === w.wmax ? w.w : w.wmin + '–' + w.wmax) + ' kt ' + FX.compass(w.dir) + ', gusts ' + w.g + (w.shore ? ' · ' + shoreWord(w.shore) : '') + (w.kite ? ' · ' + w.kite + ' m kite' : '')
        : (w.ground ? w.ground + ' trails' : '') + ', ' + w.temp + '°C · ' + w.label;
      const others = Math.max(0, (watching[w.spot.slug] || 1) - 1);
      const who = cr ? (cr.host + '\'s crew: ' + cr.going + ' going' + (cr.seats_free > 0 ? ', ' + cr.seats_free + ' seat' + (cr.seats_free > 1 ? 's' : '') + ' free' + (cr.hub_name ? ' from ' + cr.hub_name : '') : '') + '.')
        : 'Nobody\'s going yet' + (others >= 2 ? ': ' + others + ' other riders watch this spot.' : '.') + ' Start it in one tap.';
      const title = em + ' On · ' + w.spot.name + ' ' + when;
      const body = cond + '. ' + who;
      const rule = (r.min_kt != null ? r.min_kt + (r.max_kt != null ? '–' + r.max_kt : '+') + ' kt' : WINDY[r.sport] ? 'any good wind' : 'rated ' + (r.min_score >= 9 ? 'epic' : 'good') + ' or better') +
        (r.gust_max != null ? ', gusts under ' + r.gust_max : '') + (r.days !== 'any' ? ', ' + r.days + 's' : '') + ', ' + pad(r.from_h) + ':00–' + pad(r.to_h) + ':00, ' + (r.min_hours || 2) + ' h or more';
      items.push({ key: 'wind:' + r.email + ':' + r.sport + ':' + date, email: r.email, kind: 'wind', title, body, url: SITE + '/#spot/' + w.spot.slug + '/' + date,
        push: r.push, mail: r.mail, subject: name + ' is on ' + when + ' · ' + w.spot.name, token: r.token,
        mailbody: name + ' at ' + w.spot.name + ', ' + when + ':\n' + cond + '.\n' + who + (also.length ? '\nAlso good: ' + also.join(', ') + '.' : '') + '\n\nYour alert: ' + r.spots.map((s) => (spot[s] || {}).name || s).join(', ') + ' · ' + rule + '.\nSee the hours, join or start a crew:' });
    }
  }
  const sent = items.length ? (DRY ? 0 : await rpc('hi8_alert_enqueue', { p_items: items })) : 0;
  report.alerts = items.length; report.alertsNew = sent;
  log('wind alerts:', items.length, 'matched,', sent, 'new');

  // 2. forecast dropped / 3. how was it
  let drops = 0, rates = 0;
  for (const c of J.crews || []) {
    const C = city[c.city]; if (!C) continue;
    const nowH = env.TEST_HOUR ? Number(env.TEST_HOUR) : hourOf(C.now), today = C.today, startH = Number(c.start.slice(0, 2)), endH = c.end ? Number(c.end.slice(0, 2)) : startH + 3;
    const meta = spot[c.spot], sp = fx(c.spot);
    const upcoming = (c.day === today && startH > nowH + 0.5) || c.day === FX.addDays(today, 1);
    const s = upcoming && sp && meta ? FX.span(sp, c.day, startH, Math.max(startH + 1, endH), c.sport, meta, { kg: 75 }) : null;
    // 2.30: recheck each coming crew's own window every 3 hours (or straight away when it flips), stamped on the crew
    if (s) {
      const okNow = s.score >= 4, age = c.checked_at ? Date.now() - Date.parse(c.checked_at) : Infinity;
      if (age > 3 * 3600e3 - 60e3 || c.checked_ok !== okNow) {
        const note = (WINDY[c.sport] ? s.w + ' kt ' + FX.compass(s.dir) : (s.ground || 'ok') + ', ' + s.temp + '°C') + ' at ' + c.start + ', ' + s.label;
        if (!DRY) report.rechecks += 1, report.backOn += Number(await rpc('hi8_recheck', { p_code: c.code, p_ok: okNow, p_kt: WINDY[c.sport] ? Math.round(s.w) : null, p_note: note })) || 0;
      }
    }
    if (upcoming && !c.fx_flag && c.min_met !== false && sp && meta) {
      if (s && s.score < 4) {
        const line = (WINDY[c.sport] ? s.w + ' kt ' + FX.compass(s.dir) : (s.ground || 'bad') + ', ' + s.temp + '°C') + ' at ' + c.start + ' ' + dayWord(c.day, today) + ', ' + s.label;
        let next = null;
        for (let i = 0; i < 4 && !next; i++) {
          const d = FX.addDays(today, i), w = FX.windows(sp, d, c.sport, meta, { kg: 75 })
            .map((x) => (d === today ? Object.assign({}, x, { from: Math.max(x.from, Math.ceil(nowH + 1)) }) : x)) // today: what's still ahead
            .filter((x) => x.score >= 6 && x.to - x.from >= 2)[0];
          if (w) next = dayWord(d, today) + ' ' + pad(w.from) + '–' + pad(w.to) + (WINDY[c.sport] ? ', ' + w.w + ' kt' : '') + ', ' + w.label;
        }
        if (!DRY) drops += await rpc('hi8_fx_drop', { p_code: c.code, p_line: line, p_next: next });
        log('forecast dropped:', c.code, line, next ? '· next ' + next : '');
      }
    }
    const ended = c.day < today ? nowH >= 9 : c.day === today && nowH >= endH + 2;
    if (ended && nowH < 21 && !c.rated && c.status === 'on') { if (!DRY) rates += await rpc('hi8_rate_prompt', { p_code: c.code }); }
  }
  report.drops = drops; report.rates = rates;
  if (report.rechecks) log('crews rechecked:', report.rechecks, report.backOn ? '· told back on: ' + report.backOn : '');
  // a captain who stepped down and nobody said yes by the deadline: called off (everyone is told by the crew trigger)
  report.captainsGone = DRY ? 0 : Number(await rpc('hi8_captain_expire', {}).catch((e) => { log('captain expiry failed:', e.message || e); return 0; })) || 0;
  if (report.captainsGone) log('called off, nobody took over as captain:', report.captainsGone);
  log('forecast drops told:', drops, '· how-was-it asked:', rates);

  // 3b. "I'm looking": tell riders about a crew that fits (once per day they asked for)
  report.asks = DRY ? 0 : Number(await rpc('hi8_ask_match', {}).catch((e) => { log('matching failed:', e.message || e); return 0; })) || 0;
  if (report.asks) log('riders told about a crew that fits:', report.asks);

  // 4. push. The key pair lives in the database: made here on the first run (the site reads the public half).
  if (!VAPID_PRIV || !VAPID_PUB) {
    let v = await rpc('hi8_vapid');
    if (!v.private || !v.public) { const k = await vapidKeys(); v = await rpc('hi8_vapid', { p_public: k.publicKey, p_private: k.privateKey }); log('made the web push keys'); }
    VAPID_PUB = v.public; VAPID_PRIV = v.private;
  }
  const Q = await rpc('hi8_push_pending', { p_limit: 300 });
  const done = [], ok = [], gone = [], failed = [];
  for (const q of Q || []) {
    let any = false, allGone = q.subs.length > 0;
    for (const s of q.subs) {
      const st = DRY ? 201 : await send(s, { title: q.title, body: q.body, url: q.url || SITE, tag: q.tag || undefined }, { subject: 'mailto:hello@hi8ctane.com', publicKey: VAPID_PUB, privateKey: VAPID_PRIV, topic: q.tag, fetch: opts.fetch || fetch, debug: opts.debug });
      if (st >= 200 && st < 300) { any = true; allGone = false; ok.push(s.endpoint); }
      else if (st === 404 || st === 410) gone.push(s.endpoint);
      else { allGone = false; failed.push(s.endpoint); }
    }
    if (any || allGone || !q.subs.length) done.push(q.id);
  }
  if ((Q || []).length && !DRY) await rpc('hi8_push_done', { p_sent: done, p_ok: ok, p_gone: gone, p_failed: failed });
  report.push = { waiting: (Q || []).length, done: done.length, delivered: ok.length, gone: gone.length, failed: failed.length };
  log('push:', (Q || []).length, 'waiting,', done.length, 'done,', ok.length, 'delivered,', gone.length, 'gone,', failed.length, 'failed');
  return report;
}

