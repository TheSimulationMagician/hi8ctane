// Run: node --test plan-b/   (Node 22.18+ runs TypeScript directly; older Node: add --experimental-strip-types)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planBTimes, amsterdam, hhmm, split, priceAfterChange, reduce, view, type Card, type Ctx } from './booking.ts';

const iso = (d: Date) => d.toISOString().slice(0, 16);

test('afternoon session: call 3 h before, free cancel till 2 h before', () => {
  const t = planBTimes(amsterdam(2026, 10, 31, 14, 0));
  assert.equal(hhmm(t.callAt), '11:00');
  assert.equal(hhmm(t.cutoffAt), '12:00');
  assert.equal(hhmm(planBTimes(amsterdam(2026, 10, 31, 14, 0), 3).cutoffAt), '11:00');
});

test('morning session: call 20:00 and cut-off 21:00 the evening before', () => {
  const t = planBTimes(amsterdam(2026, 11, 1, 8, 30));
  assert.equal(iso(t.callAt), '2026-10-31T19:00');   // 20:00 winter time
  assert.equal(iso(t.cutoffAt), '2026-10-31T20:00');
});

test('the night the clocks go back (25 Oct 2026) keeps 20:00 local', () => {
  const t = planBTimes(amsterdam(2026, 10, 25, 8, 30));
  assert.equal(iso(t.callAt), '2026-10-24T18:00');   // 20:00 summer time = 18:00 UTC
  assert.equal(iso(amsterdam(2026, 10, 25, 8, 30)), '2026-10-25T07:30');
});

test('split: 64 km x 0.13 + 8 parking = 16.32, four people, 4.08 each', () => {
  const s = split({ roundTripKm: 64, parkingEur: 8 }, [{ id: 'sam' }, { id: 'lena' }, { id: 'you' }]);
  assert.equal(s.totalCents, 1632);
  assert.deepEqual(s.riderCents, { sam: 408, lena: 408, you: 408 });
  assert.equal(s.driverCents, 408);
});

test('split: five people, riders 3.26, the driver covers the rounding', () => {
  const s = split({ roundTripKm: 64, parkingEur: 8 }, ['a', 'b', 'c', 'd'].map((id) => ({ id })));
  assert.deepEqual(Object.values(s.riderCents), [326, 326, 326, 326]);
  assert.equal(s.driverCents, 328);
});

test('split: one-way riders pay half the fuel, the full parking share', () => {
  const s = split({ roundTripKm: 64, parkingEur: 8 }, [{ id: 'sam' }, { id: 'kim', oneWay: true }]);
  // fuel 832 by weight 1 : 1 : 0.5 → 332.8 / 166.4; parking 800 / 3 = 266.67
  assert.equal(s.riderCents.sam, 599);
  assert.equal(s.riderCents.kim, 433);
  assert.equal(s.driverCents + s.riderCents.sam + s.riderCents.kim, 1632);
});

test('split never charges more than the trip costs', () => {
  for (let km = 4; km <= 300; km += 7) for (let n = 0; n <= 7; n++) for (const p of [0, 2.5, 8, 13]) {
    const riders = Array.from({ length: n }, (_, i) => ({ id: 'r' + i, oneWay: i % 3 === 2 }));
    const s = split({ roundTripKm: km, parkingEur: p }, riders);
    const paid = Object.values(s.riderCents).reduce((a, b) => a + b, 0);
    assert.ok(paid <= s.totalCents && s.driverCents >= 0 && s.driverCents === s.totalCents - paid);
  }
});

test('after the cut-off a price only goes down', () => {
  assert.equal(priceAfterChange(408, 326), 326);
  assert.equal(priceAfterChange(326, 544), 326);
  assert.equal(priceAfterChange(null, 544), 544);
});

const start = amsterdam(2026, 10, 31, 14, 0);
const ctx = (now: Date, over: Partial<Ctx> = {}): Ctx => ({
  now, startsAt: start, cutoffAt: amsterdam(2026, 10, 31, 12, 0), pickupAt: amsterdam(2026, 10, 31, 12, 15),
  maxWaitMin: 10, seatFree: true, altCar: 'car-joost', waitlistOn: true, ...over,
});
const info = { driver: 'MARTA', pickupPlace: 'SLOTERDIJK P+R', altCar: 'JOOST · HAARLEM 12:40', altPrice: '€4.49', waitlistFirst: 'KIM', price: '€4.08' };
const open: Card = { booking: 'open', prompt: null };

test('join → running late 10 min → driver waits till 12:25', () => {
  const c0 = ctx(amsterdam(2026, 10, 31, 11, 50));
  let s = reduce(open, { type: 'JOIN' }, c0, 'crew-1');
  assert.equal(s.card.booking, 'in');
  assert.deepEqual(s.rpc, { name: 'join_crew', args: { p_crew: 'crew-1', p_ride: 'need' } });
  s = reduce(s.card, { type: 'RUNNING_LATE' }, c0, 'crew-1');
  assert.equal(s.card.prompt, 'late_pick');
  assert.deepEqual(view(s.card, c0, info).buttons, ['5 MIN', '10 MIN', 'MORE', '‹ BACK']);
  s = reduce(s.card, { type: 'LATE', minutes: 10 }, c0, 'crew-1');
  assert.equal(s.card.booking, 'late');
  assert.equal(s.rpc?.name, 'running_late');
  assert.equal(view(s.card, c0, info).message, '⏱ MARTA KNOWS · WAITS TILL 12:25 AT SLOTERDIJK P+R');
});

test('too late → switch ride, or "I\'ll make it" = late by the max wait', () => {
  const c0 = ctx(amsterdam(2026, 10, 31, 12, 5));
  const inCard: Card = { booking: 'in', prompt: null };
  let s = reduce(reduce(inCard, { type: 'RUNNING_LATE' }, c0, 'c').card, { type: 'LATE_MORE' }, c0, 'c');
  assert.equal(s.card.prompt, 'too_late');
  assert.deepEqual(view(s.card, c0, info).buttons, ['SWITCH RIDE', "I'LL MAKE IT"]);
  const sw = reduce(s.card, { type: 'SWITCH' }, c0, 'c');
  assert.deepEqual(sw.rpc, { name: 'switch_car', args: { p_crew: 'c', p_car: 'car-joost' } });
  assert.ok(view(sw.card, c0, info).message?.startsWith('✓ MOVED TO JOOST'));
  const mk = reduce(s.card, { type: 'MAKE_IT' }, c0, 'c');
  assert.equal(mk.card.lateMin, 10);
  const none = reduce(s.card, { type: 'SWITCH' }, ctx(c0.now, { altCar: null }), 'c');
  assert.equal(none.error, 'no_seat');
});

test("can't go: free before the cut-off, the share counts after it", () => {
  const before = ctx(amsterdam(2026, 10, 31, 11, 20));
  const after = ctx(amsterdam(2026, 10, 31, 12, 5));
  const ask = reduce({ booking: 'in', prompt: null }, { type: 'CANT_GO' }, before, 'c').card;
  assert.match(view(ask, before, info).question ?? '', /Free to cancel till 12:00/);
  assert.match(view(ask, after, info).question ?? '', /past the 12:00 cut-off/);
  const free = reduce(ask, { type: 'CONFIRM_CANCEL' }, before, 'c');
  assert.equal(free.card.cancelFree, true);
  assert.equal(view(free.card, before, info).message, 'CANCELLED · NO COST · KIM HAS YOUR SEAT');
  const late = reduce(ask, { type: 'CONFIRM_CANCEL' }, after, 'c');
  assert.equal(late.card.cancelFree, false);
  assert.equal(reduce(ask, { type: 'KEEP_SEAT' }, before, 'c').card.booking, 'in');
});

test('full crew → waitlist → promoted when a seat frees up', () => {
  const c0 = ctx(amsterdam(2026, 10, 31, 10, 0), { seatFree: false });
  const w = reduce(open, { type: 'JOIN' }, c0, 'c');
  assert.equal(w.card.booking, 'waitlist');
  assert.equal(reduce(w.card, { type: 'PROMOTED' }, c0, 'c').card.booking, 'in');
  assert.equal(reduce(open, { type: 'JOIN' }, ctx(c0.now, { seatFree: false, waitlistOn: false }), 'c').error, 'full');
});

test('check-in opens 30 min before pickup; undo works', () => {
  const early = reduce({ booking: 'in', prompt: null }, { type: 'CHECK_IN' }, ctx(amsterdam(2026, 10, 31, 11, 30)), 'c');
  assert.equal(early.error, 'not_now');
  const c0 = ctx(amsterdam(2026, 10, 31, 12, 10));
  assert.deepEqual(view({ booking: 'in', prompt: null }, c0, info).buttons, ["I'M HERE ✓", 'RUNNING LATE', "CAN'T GO"]);
  const here = reduce({ booking: 'late', prompt: null, lateMin: 5 }, { type: 'CHECK_IN' }, c0, 'c');
  assert.equal(here.card.booking, 'here');
  assert.equal(reduce(here.card, { type: 'UNDO' }, c0, 'c').card.booking, 'in');
});

test('called off: everyone in or waiting is released, nobody pays', () => {
  const c0 = ctx(amsterdam(2026, 10, 31, 11, 0));
  for (const b of ['in', 'late', 'waitlist'] as const) {
    const s = reduce({ booking: b, prompt: null }, { type: 'CALLED', call: 'off' }, c0, 'c');
    assert.equal(s.card.booking, 'called_off');
  }
  assert.equal(view({ booking: 'called_off', prompt: null }, c0, info).message, 'CALLED OFF · NOBODY DRIVES, NOBODY PAYS');
});
