// Hi8ctane 2.4 · Plan B reference logic for the app (no dependencies, plain TypeScript).
// The database is the source of truth (schema.sql runs the same rules on the server);
// this file mirrors them on the client: the times a crew shows, the cost split, and the
// crew card's states and buttons, plus which RPC each tap calls. Copy it into the repo as-is.

export const TZ = 'Europe/Amsterdam';

// ── Times ──────────────────────────────────────────────────────────────────────────────────
function parts(d: Date, tz = TZ) {
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: g('year'), m: g('month'), d: g('day'), h: g('hour'), min: g('minute'), s: g('second') };
}

/** The UTC instant of a wall-clock time in Amsterdam (handles summer/winter time). */
export function amsterdam(y: number, m: number, d: number, h: number, min = 0): Date {
  let t = Date.UTC(y, m - 1, d, h, min);
  for (let i = 0; i < 2; i++) {
    const q = parts(new Date(t));
    const shown = Date.UTC(q.y, q.m - 1, q.d, q.h, q.min);
    t += Date.UTC(y, m - 1, d, h, min) - shown;
  }
  return new Date(t);
}

/** Go/no-go call 3 h before the start, free cancel until `cancelHours` before it (default 2).
 *  Sessions starting before 10:00 get both the evening before: call 20:00, cut-off 21:00. */
export function planBTimes(startsAt: Date, cancelHours: 1 | 2 | 3 = 2): { callAt: Date; cutoffAt: Date } {
  const l = parts(startsAt);
  if (l.h < 10) {
    const prev = new Date(Date.UTC(l.y, l.m - 1, l.d) - 86_400_000);
    const y = prev.getUTCFullYear(), m = prev.getUTCMonth() + 1, d = prev.getUTCDate();
    return { callAt: amsterdam(y, m, d, 20), cutoffAt: amsterdam(y, m, d, 21) };
  }
  return {
    callAt: new Date(startsAt.getTime() - 3 * 3_600_000),
    cutoffAt: new Date(startsAt.getTime() - cancelHours * 3_600_000),
  };
}

export const hhmm = (d: Date) => { const q = parts(d); return String(q.h).padStart(2, '0') + ':' + String(q.min).padStart(2, '0'); };

// ── Cost split (in cents, so the sums are exact) ───────────────────────────────────────────
export interface Car { roundTripKm: number; parkingEur: number; fuelEurPerKm?: number }
export interface Rider { id: string; oneWay?: boolean }

/** Fuel by weight (one-way riders 0.5) + parking equally across driver and riders.
 *  Riders round down to the cent; the driver covers the rounding, so the total never exceeds the trip cost. */
export function split(car: Car, riders: Rider[]): { totalCents: number; driverCents: number; riderCents: Record<string, number> } {
  const fuel = car.roundTripKm * (car.fuelEurPerKm ?? 0.13) * 100;
  const parking = car.parkingEur * 100;
  const total = Math.round(fuel + parking);
  const people = [{ id: '__driver', w: 1 }, ...riders.map((r) => ({ id: r.id, w: r.oneWay ? 0.5 : 1 }))];
  const sw = people.reduce((a, p) => a + p.w, 0);
  const riderCents: Record<string, number> = {};
  let paid = 0;
  for (const p of people.slice(1)) {
    const c = Math.floor((fuel * p.w) / sw + parking / people.length + 1e-9);
    riderCents[p.id] = c; paid += c;
  }
  return { totalCents: total, driverCents: total - paid, riderCents };
}

export const eur = (cents: number) => '€' + (cents / 100).toFixed(2);

/** After the cut-off a rider's price can only go down. */
export function priceAfterChange(frozenCents: number | null, newCents: number): number {
  return frozenCents == null ? newCents : Math.min(frozenCents, newCents);
}

// ── The crew card ──────────────────────────────────────────────────────────────────────────
// Stored states (crew_members.booking) + 'open' for "not joined". Prompts are UI-only.
export type Booking = 'open' | 'in' | 'late' | 'here' | 'cancelled' | 'waitlist' | 'no_show' | 'done' | 'called_off';
export type Prompt = null | 'late_pick' | 'too_late' | 'cancel_confirm';
export interface Card { booking: Booking; prompt: Prompt; lateMin?: number; cancelFree?: boolean; switched?: boolean }

export interface Ctx {
  now: Date;
  startsAt: Date;
  cutoffAt: Date;
  pickupAt: Date | null;          // your car's departure; null = own way
  maxWaitMin: 5 | 10 | 15;
  seatFree: boolean;              // a seat is free for you (join goes to the waitlist if not)
  altCar: string | null;          // next car with a free seat, for "too late"
  waitlistOn: boolean;
}

export type Event =
  | { type: 'JOIN' } | { type: 'RUNNING_LATE' } | { type: 'LATE'; minutes: number } | { type: 'LATE_MORE' }
  | { type: 'SWITCH' } | { type: 'MAKE_IT' } | { type: 'BACK' } | { type: 'CHECK_IN' } | { type: 'UNDO' }
  | { type: 'CANT_GO' } | { type: 'CONFIRM_CANCEL' } | { type: 'KEEP_SEAT' } | { type: 'JOIN_WAITLIST' } | { type: 'LEAVE_WAITLIST' }
  // pushed by the server (realtime on crew_members / crews)
  | { type: 'PROMOTED' } | { type: 'NO_SHOW' } | { type: 'CALLED'; call: 'go' | 'off' } | { type: 'DONE' };

export interface Rpc { name: string; args: Record<string, unknown> }
export interface Step { card: Card; rpc?: Rpc; error?: string }

const active = (b: Booking) => b === 'in' || b === 'late' || b === 'here';

export function checkInOpen(ctx: Ctx): boolean {
  const from = (ctx.pickupAt ?? ctx.startsAt).getTime() - 30 * 60_000;
  return ctx.now.getTime() >= from && ctx.now.getTime() <= ctx.startsAt.getTime() + 3 * 3_600_000;
}

/** One tap → the next card state and the RPC to call (supabase.rpc(name, args)). Optimistic: roll back on error. */
export function reduce(c: Card, e: Event, ctx: Ctx, crewId: string): Step {
  const k = { ...c, prompt: null as Prompt };
  switch (e.type) {
    case 'JOIN':
      if (c.booking !== 'open' && c.booking !== 'cancelled') return { card: c, error: 'already_in' };
      if (!ctx.seatFree) return ctx.waitlistOn
        ? { card: { ...k, booking: 'waitlist' }, rpc: { name: 'join_crew', args: { p_crew: crewId, p_ride: 'need' } } }
        : { card: c, error: 'full' };
      return { card: { ...k, booking: 'in', switched: false }, rpc: { name: 'join_crew', args: { p_crew: crewId, p_ride: 'need' } } };
    case 'RUNNING_LATE':
      return active(c.booking) && c.booking !== 'here' ? { card: { ...c, prompt: 'late_pick' } } : { card: c, error: 'not_in' };
    case 'LATE':
      if (c.prompt !== 'late_pick' && c.prompt !== 'too_late') return { card: c, error: 'no_prompt' };
      if (e.minutes > ctx.maxWaitMin) return { card: { ...c, prompt: 'too_late' } };
      return { card: { ...k, booking: 'late', lateMin: e.minutes }, rpc: { name: 'running_late', args: { p_crew: crewId, p_minutes: e.minutes } } };
    case 'LATE_MORE':
      return c.prompt === 'late_pick' ? { card: { ...c, prompt: 'too_late' } } : { card: c, error: 'no_prompt' };
    case 'MAKE_IT':   // "I'll make it": counts as late by the max wait
      return reduce({ ...c, prompt: 'late_pick' }, { type: 'LATE', minutes: ctx.maxWaitMin }, ctx, crewId);
    case 'SWITCH':
      if (c.prompt !== 'too_late' || !ctx.altCar) return { card: c, error: 'no_seat' };
      return { card: { ...k, booking: 'in', lateMin: undefined, switched: true }, rpc: { name: 'switch_car', args: { p_crew: crewId, p_car: ctx.altCar } } };
    case 'BACK':
    case 'KEEP_SEAT':
      return { card: k };
    case 'CHECK_IN':
      if (!active(c.booking)) return { card: c, error: 'not_in' };
      if (!checkInOpen(ctx)) return { card: c, error: 'not_now' };
      return { card: { ...k, booking: 'here' }, rpc: { name: 'check_in', args: { p_crew: crewId } } };
    case 'UNDO':
      return c.booking === 'here' ? { card: { ...k, booking: 'in' }, rpc: { name: 'undo_check_in', args: { p_crew: crewId } } } : { card: c, error: 'not_checked_in' };
    case 'CANT_GO':
      return active(c.booking) ? { card: { ...c, prompt: 'cancel_confirm' } } : { card: c, error: 'not_in' };
    case 'CONFIRM_CANCEL':
      if (c.prompt !== 'cancel_confirm') return { card: c, error: 'no_prompt' };
      return { card: { ...k, booking: 'cancelled', cancelFree: ctx.now < ctx.cutoffAt }, rpc: { name: 'cancel_booking', args: { p_crew: crewId } } };
    case 'JOIN_WAITLIST':
      return c.booking === 'cancelled' || c.booking === 'open'
        ? { card: { ...k, booking: 'waitlist' }, rpc: { name: 'join_waitlist', args: { p_crew: crewId } } } : { card: c, error: 'already_in' };
    case 'LEAVE_WAITLIST':
      return c.booking === 'waitlist' ? { card: { ...k, booking: 'open' }, rpc: { name: 'leave_waitlist', args: { p_crew: crewId } } } : { card: c, error: 'not_waiting' };
    case 'PROMOTED':
      return c.booking === 'waitlist' ? { card: { ...k, booking: 'in' } } : { card: c };
    case 'NO_SHOW':
      return { card: { ...k, booking: 'no_show' } };
    case 'CALLED':
      return e.call === 'off' && (active(c.booking) || c.booking === 'waitlist') ? { card: { ...k, booking: 'called_off' } } : { card: c };
    case 'DONE':
      return active(c.booking) ? { card: { ...k, booking: 'done' } } : { card: c };
  }
}

// ── What the card says (same copy as the prototype B24-H24b) ───────────────────────────────
export interface CardInfo { driver: string; pickupPlace: string; altCar: string; altPrice: string; waitlistFirst: string; price: string }
export interface View { message: string | null; question: string | null; buttons: string[] }

export function view(c: Card, ctx: Ctx, i: CardInfo): View {
  const pick = ctx.pickupAt ? hhmm(ctx.pickupAt) : hhmm(ctx.startsAt);
  const cut = hhmm(ctx.cutoffAt);
  if (c.prompt === 'late_pick') return { message: null, question: `How late? ${i.driver} sees it right away, no calls needed.`, buttons: ['5 MIN', '10 MIN', 'MORE', '‹ BACK'] };
  if (c.prompt === 'too_late') return { message: `${i.driver} WAITS ${ctx.maxWaitMin} MIN MAX. NEXT RIDE: ${i.altCar} · ${i.altPrice}`, question: null, buttons: ctx.altCar ? ['SWITCH RIDE', "I'LL MAKE IT"] : ["I'LL MAKE IT", "CAN'T GO"] };
  if (c.prompt === 'cancel_confirm') {
    const free = ctx.now < ctx.cutoffAt;
    return { message: null, question: free
      ? `Free to cancel till ${cut}. Your seat goes straight to ${i.waitlistFirst} on the waitlist, so nobody's left short.`
      : `It's past the ${cut} cut-off: your share (${i.price}) still counts unless someone takes your seat. We offer it to the waitlist right away.`,
      buttons: ['YES, CANCEL', 'KEEP MY SEAT'] };
  }
  switch (c.booking) {
    case 'open': return { message: null, question: null, buttons: [ctx.seatFree ? `JOIN · ${i.price}` : 'JOIN THE WAITLIST', 'SAVE ☆'] };
    case 'in': return { message: c.switched ? `✓ MOVED TO ${i.altCar} · ${i.altPrice}. ${i.driver} GETS YOUR SEAT BACK.` : `✓ YOU'RE IN · PICKUP ${pick} · ${i.pickupPlace}`, question: null,
      buttons: checkInOpen(ctx) ? ["I'M HERE ✓", 'RUNNING LATE', "CAN'T GO"] : ['RUNNING LATE', "CAN'T GO"] };
    case 'late': {
      const until = ctx.pickupAt ? hhmm(new Date(ctx.pickupAt.getTime() + (c.lateMin ?? 0) * 60_000)) : pick;
      return { message: `⏱ ${i.driver} KNOWS · WAITS TILL ${until} AT ${i.pickupPlace}`, question: null, buttons: ["I'M HERE ✓", "CAN'T GO"] };
    }
    case 'here': return { message: "✓ CHECKED IN · +15 PTS WHEN YOU'RE BACK. ENJOY IT.", question: null, buttons: ['‹ UNDO'] };
    case 'cancelled': return { message: c.cancelFree === false ? `CANCELLED AFTER THE CUT-OFF · ${i.price} COUNTS UNLESS YOUR SEAT IS TAKEN` : `CANCELLED · NO COST · ${i.waitlistFirst} HAS YOUR SEAT`, question: null, buttons: ['JOIN THE WAITLIST'] };
    case 'waitlist': return { message: 'ON THE WAITLIST · WE PING YOU IF A SEAT FREES UP', question: null, buttons: ['LEAVE WAITLIST'] };
    case 'no_show': return { message: `MARKED AS A NO-SHOW · ${i.price} COUNTS · WRONG? TELL US WITHIN 24 H`, question: null, buttons: ['DISPUTE'] };
    case 'called_off': return { message: 'CALLED OFF · NOBODY DRIVES, NOBODY PAYS', question: null, buttons: ['NEXT GOOD WINDOW'] };
    case 'done': return { message: null, question: null, buttons: ['PAY MY SHARE', 'RIDE AGAIN'] };
  }
}
