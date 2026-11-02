# Hi8ctane 2.4 · developer pack (day-one build + Plan B)

Same-day crews for kite, wing, surf, SUP and MTB in Noord-Holland. Web app (PWA) at hi8ctane.com.
Read the deploy pack doc first (Francisco sends the link): access, screens, design system, data model, forecast, deploy steps, launch checklist; its "2.4 · Plan B" tab is the short version of PLAN-B.md.

## New in 2.4
- **Plan B**: running late, can't go (free till the cut-off), waitlist with automatic seats, check-in, no-shows, driver drops out, the go/no-go call, merging lonely crews, the cost split with a cut-off freeze, reliability points, pay after the ride (settled outside the app on day one). Rules and flows: `PLAN-B.md`. Money: `PAYMENTS.md`.
- **Cars and seats** on the crew page (the road trip), the ride back, Home "picked for you", buddy up, Hi8 Radio. Screen-by-screen: `CHANGES.md`.
- **The duotone crew card**: one card for Home, the landing deck and the crew page header (`tokens.css`).
- **Month-1 measurement**: `analytics/EVENTS.md` (events + scorecard) and `analytics/metrics.sql` (weekly KPIs straight from the database).

## In this folder
- `screens/` — the 15 day-one screens (00–14, flow order, 390 px, full length). `next-drop/` — 4 screens for 2–4 weeks after launch, don't build for launch. `landing-hero-shortlist/` — the three high-end landing heroes; one goes in the landing's hero slot. `plan-b/` — the crew card state by state, the what-if timelines, and each state on its own (2x).
- `prototype/` — the design prototype markup for every screen (B24-*.dc.html). Read it for spacing, colours and copy; it needs the design tool's runtime to click, so use the canvas page "2.4 · grand opening" for that.
- `schema.sql` — full Supabase schema for a fresh project (2.2 + Plan B). Already running 2.2? Run `migrations/002_plan_b.sql` instead; both give the identical schema (checked with pg_dump).
- `plan-b/booking.ts` — the same rules for the app: call and cut-off times (Amsterdam time), the split in cents, the crew card reducer (tap → next state + which RPC to call) and its copy. Tests: `plan-b/booking.test.ts`.
- `test/` — runs the schema and a replayed Saturday on a local Postgres 16 (60+ checks: waitlist, late, cancels, freeze, no-show, driver drop, call, merge, security, metrics).
- `analytics/` — `EVENTS.md`, `metrics.sql`.
- `tokens.css`, `icons/` (sport, signs, trail plates), `spots.json`, `.env.example` (now with VAPID keys for web push).

Screens and state images are rendered with stand-in fonts; the prototype files load the real ones (Archivo Black, Anton, Space Mono, Yellowtail and the display fonts).

## Build order
1. If the 2.2 day-one path isn't live yet, ship that first (crew link → Invite → car, ride or own way → Crew → Chat).
2. Run `migrations/002_plan_b.sql` (or `schema.sql` on a fresh project). Joins now go through `rpc('join_crew')`; direct inserts into `crew_members` and `crews` are revoked (see CHANGES.md).
3. Crew page: cars and seats (`car_seats`), tap a seat, NO SEAT FITS? → waitlist, I'M DRIVING TOO → `offer_car`.
4. The crew card with Plan B states (`plan-b/booking.ts`), realtime on `crew_members`, `cars`, `crews`.
5. The clock: `select cron.schedule('plan-b-tick', '* * * * *', 'select plan_b_tick()');` in Supabase Cron.
6. The notification worker: send `notifications` rows as web push, email fallback.
7. Driver view: ETA list, PICKED UP, NO-SHOW after the wait, CAN'T DRIVE, PAID ticks.
8. Events from `analytics/EVENTS.md`; a private admin page reading `metrics.weekly`.

**Fix from 2.2:** Vercel Hobby runs cron jobs at most once a day, so the hourly forecast job in the 2.2 doc would fail to deploy. Schedule it from Supabase Cron (pg_net calling `/api/cron/forecast` with `CRON_SECRET`) or move the project to Vercel Pro.

## Run the tests
```
# Postgres 16 running locally (no Supabase needed; test/supabase-stub.sql fakes auth and roles)
PGHOST=/tmp PGPORT=5432 PGUSER=postgres ./test/run.sh      # → PLAN B: ALL CHECKS PASSED, METRICS: ALL CHECKS PASSED
node --test "plan-b/*.test.ts"                              # Node 22.18+ → 14 tests pass
```

## Stack
Next.js (App Router) + TypeScript + Tailwind · Supabase (EU, Ireland; Postgres, Auth with anonymous sign-in, Realtime, Cron) · Vercel · Resend · Plausible or PostHog EU.
Repo: github.com/TheSimulationMagician/hi8ctane (private).
