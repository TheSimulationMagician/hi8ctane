// TEST ONLY. The 2.8 forecast engine (site/fx.js) against the stand-in Open-Meteo (test/live/serve.mjs on 8801)
// and a few hand-made hours. Run: node test/unit/fx_test.mjs
globalThis.HI8_CONFIG = { forecastApi: 'http://localhost:8801', marineApi: 'http://localhost:8801' };
await import('../../site/fx.js'); // a browser script: it sets globalThis.FX
const FX = globalThis.FX;
let ok = 0;
const check = (c, what) => { if (!c) { console.error('FAIL: ' + what); process.exit(1); } ok++; console.log('  ok ·', what); };

console.log('rating one hour');
const cdf = { slug: 'castelldefels', face: 160, good_from: 60, good_to: 250, lake: false };
const day = { sunrise: '07:48', sunset: '17:32' };
const hr = (o) => Object.assign({ h: 13, w: 18, g: 23, dir: 225, temp: 18, mm: 0, code: 1, r24: 0 }, o);
let r = FX.rate('kite', cdf, hr({}), day, { kg: 75 });
check(r.s >= 8.5 && r.label !== 'NO GO' && r.shore === 'cross-on' && r.kite === 9, '18 kt SW at Castelldefels: good, cross-on, a 9 m for 75 kg');
check(FX.rate('kite', cdf, hr({ dir: 340 }), day).s === 0 && FX.rate('kite', cdf, hr({ dir: 340 }), day).why.join().includes('offshore'), 'NNW is offshore there: no go');
check(FX.rate('kite', cdf, hr({ w: 8, g: 11 }), day).s === 0, '8 kt: too light');
check(FX.rate('kite', cdf, hr({ w: 22, g: 40 }), day).why.includes('very gusty'), 'gusts to 40: very gusty');
check(FX.rate('kite', { lake: true }, hr({ dir: 340 }), day).s >= 8.5, 'a lagoon works in any direction');
check(FX.rate('kite', cdf, hr({ h: 19 }), day).label === 'DARK', 'after sunset: dark');
check(FX.rate('kite', cdf, hr({ code: 95 }), day).s === 0, 'thunderstorm: stay off');
check(FX.kiteSize(18, 90) === 11 && FX.kiteSize(30, 60) === 5 && FX.kiteSize(8, 75) === null, 'kite size: 11 m for 90 kg in 18 kt, never under 5 m, none under 9 kt');
check(FX.rate('mtb', {}, hr({ r24: 12 }), day).ground === 'muddy' && FX.rate('mtb', {}, hr({ r24: 12 }), day).s <= 3, 'MTB after 12 mm of rain: muddy');
check(FX.rate('mtb', {}, hr({ r24: 0, temp: 16 }), day).s === 10, 'MTB dry and 16°C: epic');
check(FX.rate('mx', {}, hr({ r24: 3 }), day).ground === 'tacky' && FX.rate('mx', {}, hr({ r24: 3 }), day).label === 'EPIC', 'MX after a little rain: tacky, epic');
check(FX.rate('mx', {}, hr({ r24: 20 }), day).ground === 'muddy' && FX.rate('mx', {}, hr({ r24: 20 }), day).s <= 2, 'MX after 20 mm: mud');
check(FX.rate('mtb', {}, hr({ mm: 2 }), day).s <= 2, 'riding in the rain: no');
check(FX.shore(160, 160) === 'onshore' && FX.shore(160, 250) === 'side-shore' && FX.shore(160, 340) === 'offshore' && FX.shore(95, 0) === 'side-shore', 'shore classes');
check(FX.compass(225) === 'SW' && FX.compass(350) === 'N', 'compass');

console.log('from the (stand-in) API');
const spots = [Object.assign({ lat: 41.268, lon: 1.985 }, cdf), { slug: 'trabucador', lat: 40.62, lon: 0.733, lake: true, face: null },
  { slug: 'collserola', lat: 41.418, lon: 2.115, face: null, lake: false }, { slug: 'vallgorguina-mx', lat: 41.64, lon: 2.505, face: null, lake: false }];
const D = await FX.fetchCity('barcelona', spots);
const sp = D.castelldefels;
check(sp && sp.hours.length === 96 && sp.model === 'meteofrance_seamless', '4 days of hours (yesterday + 3), the sharp model');
const today = FX.localNow(sp.offset).slice(0, 10);
const noon = sp.hours.find((x) => x.t === today + 'T13:00');
check(noon.w === 18 && noon.m && noon.m.ecmwf_ifs025.w === 17 && noon.m.gfs_seamless.w === 15 && noon.wv === 1.2, 'merged: sharp model wind, three other models, waves');
check(noon.r24 === 5, 'rain in the last 24 hours (5 mm before dawn)');
check(sp.days[today].sunset === '17:32', 'sunset');
FX.data.barcelona = { spots: D };
const span = FX.span(sp, today, 12, 16, 'kite', spots[0], { kg: 75 });
check(span && span.w >= 17 && span.label !== 'NO GO' && span.agree === 'agree' && span.kite >= 8, 'a crew window: wind, label, the models agree, kite size');
const tm = FX.addDays(today, 1);
const spanT = FX.span(sp, tm, 12, 16, 'kite', spots[0], { kg: 75 });
check(spanT.label === 'NO GO' && spanT.agree === 'disagree', 'tomorrow: no go, and GFS disagrees');
const best = FX.bestDays('barcelona', spots.slice(0, 2), 'kite', { kg: 75 });
check(best.length === 3 && best[2].spot.slug === 'trabucador' && best[2].label === 'EPIC', 'best per day: in two days only the lagoon works, and it is epic');
const mtbDays = FX.bestDays('barcelona', [spots[2]], 'mtb', {});
check(mtbDays[1].none === true || mtbDays[1].label !== 'EPIC', 'MTB tomorrow: rain');
const mx = FX.windows(D['vallgorguina-mx'], FX.addDays(today, 0), 'mx', spots[3], {});
check(mx.length === 0 || mx[0].ground === 'tacky', 'MX today: tacky after the dawn rain');
const rank = FX.rankSpots('barcelona', spots.slice(0, 2), 'kite', FX.addDays(today, 2), 11, 15, { kg: 75 });
check(rank[0].spot.slug === 'trabucador' && rank[1].fx.score === 0, 'ranking spots for a window: the lagoon first, offshore last');
const G = await FX.grid('barcelona', true);
check(G && G.w.length === 48 && G.w[0].length === 72 && G.d[0].length === 72 && G.rows === 6 && G.cols === 8, 'the map grid: 48 points x 72 hours');
console.log(`\nALL ${ok} FORECAST CHECKS PASSED`);
