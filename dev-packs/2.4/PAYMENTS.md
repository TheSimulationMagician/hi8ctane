# Payments · what ships now, what waits (Hi8ctane 2.4)

**Day one: no money moves through the app.** The split is shown before joining, frozen at the cut-off, and after the ride each rider sees what they owe and to whom. The driver sends a payment request (bank app or Tikkie) or takes cash, then ticks PAID (`mark_paid`). The 2.4 crew page already says "no money in the app"; keep the "pay after, in one tap" copy on the landing heroes for later.

Why: joining stays possible without an account or a card (the guest invite flow), there are no driver payouts to set up, and the app never handles the drivers' money.

## Rules that hold either way

- **Cost-sharing only.** Under the Wet personenvervoer 2000 (art. 2), car transport is outside the taxi rules when all payments for the trip stay within the car's costs plus extra trip costs and it isn't done as a business (car costs: depreciation, insurance, road tax, fuel, maintenance and repairs, Besluit personenvervoer 2000 art. 3). The ILT counts all payments for the trip, whoever pays them. Our split is fuel at €0.13/km plus parking, under that ceiling. Source: taxiregels.nl/overige-faq-page. Have a lawyer confirm before adding any Hi8ctane fee per ride (below).
- **Drivers never set a price**, only seats, pickup, km and parking; €/km is capped at €0.25 in the database.
- **Total collected per car ≤ trip cost**, enforced by `split_shares` (riders round down, the driver covers the cents).

## Later: pay after in the app (decision for Francisco)

| Option | How | Cost per payment (NL) | Notes |
|---|---|---|---|
| A. Keep it outside the app | Payment request + PAID tick | €0 | Works for months; no-shows can't be charged |
| B. Collect shares in the app, pay drivers out | Payment provider with marketplace payouts; riders pay by iDEAL or card after the ride | Mollie: iDEAL / Wero €0.32 per payment; EEA consumer cards 1.80% + €0.25 (mollie.com pricing) | Drivers must onboard (ID checks) to get paid out. A €4.08 share loses €0.32 (8%) to iDEAL |
| C. Like B, but batched | Riders keep a card or iDEAL mandate on file; shares are charged weekly | one fee per rider per week | Cheapest; lets you charge no-show shares; asking for a card at join breaks the no-account invite, so ask after the first ride |

**A Hi8ctane fee per ride** only makes sense inside an in-app payment (B or C): €0.50 charged on its own would lose €0.32 of it to iDEAL. Inside a €4.08 share it adds 12%, and it should be checked against the cost-sharing ceiling above. A subscription (one payment a month or a year) avoids both problems.

iDEAL is turning into iDEAL | Wero; plan for "iDEAL | Wero" on the checkout (Stripe expects the switch to finish by 2028).

## Schema already in place

`crew_members.share_eur` (frozen share), `seat_debts` (late cancels and switches, cleared when the seat is refilled), `paid_at` on both, `pay_after` notifications, `metrics.weekly.shared_eur` / `settled_eur`, and `fee_at_50c_eur` (what a 50-cent fee per paid seat would have made, for the pricing decision).
