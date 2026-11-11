// TEST ONLY. The widget feed (widget/feed.mjs) against the stand-in Open-Meteo (test/live/serve.mjs on 8801).
// Run: node test/unit/widget_test.mjs
globalThis.HI8_CONFIG = { forecastApi: 'http://localhost:8801', marineApi: 'http://localhost:8801' };
await import('../../site/fx.js');
const FX = globalThis.FX;
const { widgetFeed, localNow } = await import('../../widget/feed.mjs');
let ok = 0;
const check = (c, what) => { if (!c) { console.error('FAIL: ' + what); process.exit(1); } ok++; console.log('  ok ·', what); };
const spots = [
  { slug: 'ijmuiden', name: 'IJmuiden', city: 'amsterdam', sports: ['kite'], lat: 52.456, lng: 4.553, face: 280, good_from: 200, good_to: 340, lake: false },
  { slug: 'wijk-aan-zee', name: 'Wijk aan Zee', city: 'amsterdam', sports: ['kite'], lat: 52.496, lng: 4.582, face: 285, good_from: 200, good_to: 340, lake: false },
  { slug: 'schoorl', name: 'Schoorl', city: 'amsterdam', sports: ['mtb'], lat: 52.70, lng: 4.69 }
];
const now = new Date();
const t = localNow('amsterdam', now);
check(/^\d{4}-\d\d-\d\d$/.test(t.date) && t.h >= 0 && t.h < 24, 'the local date and hour of the region');
const out = await widgetFeed({ FX, spots, city: 'amsterdam', sport: 'kite', now });
console.log(JSON.stringify(out.next), JSON.stringify(out.week.map((d) => d.day + ':' + d.label + ':' + d.kt)));
check(out.v === 1 && out.week.length === 7 && out.week[0].date === t.date, 'seven days, starting today');
check(out.week.every((d) => ['EPIC', 'GOOD', 'OK', 'NO GO'].includes(d.label)), 'each day carries the site\'s own rating');
check(out.next === null || (out.next.label === 'EPIC' || out.next.label === 'GOOD'), 'the next session is a GOOD or EPIC one, or there is none');
if (out.next) {
  check(out.next.going === 0 && out.next.crew === null && out.next.url.includes('go=' + out.next.date), 'nobody going yet: the link opens I\'M GOING on that window');
  const crews = [{ code: 'KAI1', city: 'amsterdam', sport: 'kite', status: 'on', day: out.next.date, spot: out.next.slug, going: 3, seats_free: 2 }, { code: 'OLD', city: 'amsterdam', sport: 'kite', status: 'off', day: out.next.date, spot: out.next.slug, going: 9 }];
  const w2 = await widgetFeed({ FX, spots, crews, city: 'amsterdam', sport: 'kite', now });
  check(w2.next.going === 3 && w2.next.seats === 2 && w2.next.crew === 'KAI1' && w2.next.url.endsWith('?c=KAI1'), 'a crew at that spot and day: who\'s going, the seats, and a link to the crew');
  check(w2.week.find((d) => d.date === out.next.date).going === 3, 'the week strip counts riders going, cancelled crews left out');
  check(out.next.start === out.next.date + 'T' + String(out.next.from).padStart(2, '0') + ':00' && out.tz === 'Europe/Amsterdam' && out.week[out.next.at].date === out.next.date, 'the session\'s local start time and time zone for the countdown, and which bar it is');
  check(out.week.every((d) => typeof d.score === 'number' && d.score >= 0 && d.score <= 10), 'each day carries its score for the bar height');
  check(out.next.kite == null || typeof out.next.kite === 'number' || typeof out.next.kite === 'string', 'kite size for the rider\'s weight');
}
const none = await widgetFeed({ FX, spots: [], city: 'amsterdam', sport: 'kite', now });
check(none.next === null && none.week.length === 7 && none.week.every((d) => d.label === 'NO GO'), 'no spots: no session, a week of NO GO');
console.log('ALL ' + ok + ' WIDGET FEED CHECKS PASSED');
