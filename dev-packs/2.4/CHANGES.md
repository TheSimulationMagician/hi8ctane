# What changed since 2.2

2.3 and 2.4 were design rounds on the canvas; this pack is the first developer pack since 2.2. Screen numbers follow the canvas page "2.4 · grand opening" (the 2.2 pack numbered them in a different order).

## Screens

| # | Screen | Change since 2.2 |
|---|---|---|
| 00 | Landing | "Who's out today?" opener with the finder (I want to [sport] near [town] [day]); the hero is a slot for one of the three shortlisted heroes (`screens/landing-hero-shortlist/`). Today's call, the week ahead, stop checking three apps, bring your crew, how it works stay |
| 01 | Home | Was "next crew + out now". Now: the finder, SURPRISE ME / START MY OWN, PICKED FOR YOU with the reasons (your wind range, friends going, your level, a seat left), your next crew with a countdown, open crews and good windows in one list, NEVER TRIED IT? sport tiles, BUDDY UP (pair with a stranger + a captain), Hi8 Radio button |
| 02 | Crew | Before / at the beach / after tabs; meeting point card; THE ROAD TRIP: each car as a row of seats, tap an empty seat, fuel + parking per person, I'M DRIVING TOO and NO SEAT FITS?; own-way riders listed; THE RIDE BACK (same car, staying later, own way); chat preview; bottom bar CHAT · SEND IT · I'M HERE. Plan B adds the card states and the driver view |
| 03 | Crew chat | Unchanged; Plan B writes system lines (late, cancels, the call, merges) |
| 04 | Invite | Unchanged path (first name + WhatsApp + level, no account) |
| 05 | I'm in · getting there | Unchanged; Plan B adds pickup time, max wait (5/10/15) and parking to I HAVE A CAR |
| 06–07 | Get in, Onboarding | Unchanged |
| 08 | Spot forecast | Unchanged, plus a sticky best-window bar with JOIN THE CREW |
| 09 | Live map | Unchanged, plus a FIND MY CREW bar ("4 crews going out today") |
| 10 | Start a crew | Unchanged on the canvas; build it with the rules panel from B24-H25b (call, wait, free cancel, waitlist, merge) |
| 11 | Try | Unchanged |
| 12–13 | Rent & Learn, Market | Coming soon, collect emails (partner names are placeholders until signed) |
| 14 | Me | Unchanged, plus a next-crew bar (OPEN MY CREW); points now come from Plan B |
| — | Next drop | Route map, host calls it, Lift Karma, watch alerts. 2.4 already does the call automatically; the "host calls it" screen becomes the host override |

## Database (breaking for 2.2 code)
- Joining, leaving and state changes go through RPCs (`join_crew`, `cancel_booking`, …). Direct `insert`/`update`/`delete` on `crew_members` is revoked, except `update` of `pickup_town` and `one_way`. Crews are created with `start_crew()`; hosts can still `update` notes, level, rookies, max riders and the rules.
- `crew_members.state` (2.2) is kept in sync for old reads; use `booking`.
- Seats moved from `crew_members.seats_offered` to the `cars` table; `crew_seats` keeps its 2.2 columns.
- New: `cars`, `seat_debts`, `reliability_events`, `notifications`, views `car_seats` and `reliability`, schema `planb` (internal), schema `metrics` (KPIs).

## Copy that changes for launch
- "Pay after the ride, in one tap" → "settle up after the ride" until in-app payments exist (PAYMENTS.md).
- Morning sessions: call at 20:00, free cancel till 21:00 the evening before (PLAN-B.md, "Prototype vs this spec").
