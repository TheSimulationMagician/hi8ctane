# The live site (2.9: the 2.7 look, crews first)

What runs at hi8ctane.com. Two things to do: **JOIN A CREW** or **START A CREW**. Everything else on the page makes the case for riding together: the forecast, what a seat saves, why a buddy beats riding alone, and days out with others. Nothing is made up: every crew, rider, plan and count comes from Supabase, every forecast from Open-Meteo, and when there's nothing to show, the page says so. GitHub Pages publishes this folder on every change on main (`.github/workflows/pages.yml`).

## The look

The 2.7 identity, kept on purpose: surf mag meets 90s music TV. Cream paper, 3px ink outlines, hard offset shadows (black, pink on the dark blocks), square corners, halftone steel blues, lime and hot pink. Anton for headlines, Archivo Black for labels, Space Mono for data. The ransom-note wordmark cuts one letter each from Archivo Black, Anton, Bowlby One, Special Elite, Shrikhand and Permanent Marker. Verdicts: EPIC pink, GOOD lime, OK yellow, NO GO sand. Buttons are the clipped-corner `.jn` stickers; crews are the `.sc` cards (sport tile, the spot on its halftone, chips, who's going, the seat price).

## The app (`index.html`)

- `index.html` + `app.css` + `app.js`: one responsive page. Phone, top to bottom: the hero (the headline, the sport tiles, JOIN / START), **crews near you** (a swipe rail), live reports, **the live map**, **the week ahead** (kite, MTB and MX x 7 days at the best spot each day), **the best window** (with wind, gusts, kite size, waves, water, rain chance, light and how many models agree), **ride with a buddy** (safer, more fun), **fill the car** (what a seat costs solo vs shared, with the Hi8 fee), **plans**, how we keep it good, Founding Night, other cities, schools, and "see you out there". JOIN / START stay docked at the bottom. Computer: the map fills the left, the page scrolls on the right.
- `map.js`: the live map, drawn by us on a canvas (no map service, no keys). The wind as a colour field and particles flowing with it, hour by hour with a time slider and play; spots as square stickers in the verdict colours, a yellow tag with the crews coming up there, a pulse where a crew is on now. MTB and MX open on the rain layer. Pan, pinch, zoom.
- `geo.js`: coastlines, lakes, borders and rivers from Natural Earth (public domain), clipped to each city's region, plus town names. Rebuild it with `scripts/make_geo.py` if a region changes.
- `fx.js`: the forecast engine. Per spot, hour by hour for **7 days**: Météo-France AROME for Barcelona for the first two days (KNMI HARMONIE for Amsterdam, ICON-D2 for Berlin), then the best global model, with ECMWF, ICON and GFS side by side all week (wind and rain); waves, wave period and water temperature for sea spots; rain chance, cloud, temperatures, sunrise and sunset. Each hour is rated per sport:
  - **kite**: 15-25 kt is the sweet spot; gusts and the wind direction against the beach (onshore, cross-on, side-shore, cross-offshore, offshore = no go; lagoons work in any direction); the kite size for your weight (2.2 x kg / kt, set on Me);
  - **MTB**: rain now, mud from the last 24 hours of rain, heat, cold, storm gusts;
  - **MX**: a little rain before = tacky (the best), lots = mud, dry = hard-pack, dust on hot days.
  The good stretches of each day become windows (up to 4 hours for kite, 5 for MTB and MX). For each window, `FX.agreement` counts how many of ECMWF, ICON and GFS see the same (kite: average wind within 4 kt; MTB/MX: rain or no rain): SURE, LIKELY or UNSURE.
- **The money** (`seatMath` in `app.js`): fuel for the round trip (6.5 L/100 km at €1.95, roads 30% longer than the crow flies) split by the people in the car. Riders add the Hi8 fee on top of their share (`ride_fee_pct`, 15); the driver always gets the full share. While `fee_live` is false (the pilot) the fee is shown crossed out, "free during the pilot", and nothing is charged.
- `fonts/`: Anton, Archivo Black, Space Mono, Bowlby One, Shrikhand (SIL Open Font License), Special Elite and Permanent Marker (Apache 2.0), self-hosted, cut to what's used (`scripts/make_fonts.sh`). No calls to Google Fonts from the app.
- `og.jpg`: the picture WhatsApp and Instagram show when a link is shared.
- Links: `/?c=CODE` a crew (`#chat` scrolls to its chat), `/#join`, `/#start` (`?spot=…&sport=…` preselects), `/#spot/<slug>` a spot's hourly forecast, `/#plan/<slug>` a plan, `/#me`, `/?city=amsterdam`, `/?sport=mtb`, `/?stop=TOKEN` (the stop link in alert emails).
- The 2.7 app screens (`B27-Landing`, `Web`, `Home`, `Map`, `Spot`, `Start`, `Crew`, `Chat`, `Me`) forward to the app, so old links in emails and chats keep working. Founding Night, Schools, City, Get In and onboarding are the 2.7 screens as before. **The radio is off for now**: `B27-Radio` forwards to the app and the radio button is gone from the other screens. `hi8ctane.com/join` opens JOIN A CREW.

## Payments: the wallet and the Hi8 Pass (`supabase/migrations/0008_wallet.sql`, `supabase/functions/`)

- **The wallet:** riders top up €10, €20 or €50 through Stripe Checkout and pay their seats from it, so a €4 seat doesn't carry a card fee of its own (one iDEAL top-up is about €0.29). The wallet holds at most €100.
- **A seat paid in the app** is held until the crew has ridden. Three hours after the crew ends, it moves to the driver's wallet (every hour, `hi8_release_seats`). If the crew is called off, the rider leaves, or the rider changes cars, the money goes straight back.
- **Drivers withdraw** from €5, through Stripe Connect Express: Stripe asks for and keeps their bank details, never us.
- **The Hi8 fee** (`ride_fee_pct`, minimum `fee_min_cents`) is added only when `fee_live` is true, and never for Hi8 Pass members.
- **The Hi8 Pass:** €3.99 a month or €39 a year, a Stripe subscription (SEPA direct debit or card). It's on sale only once the fee is live.
- **Off until you switch it on** (`payments_live` false): the app shows "paying in the app opens soon", and Bizum or payment links work as before.

### Switch payments on

1. Create a Stripe account for the business. In Settings → Payment methods, turn on iDEAL, Bancontact, cards and SEPA Direct Debit, plus Bizum or Wero if Stripe offers them on your account. Turn on Connect (Express) for withdrawals.
2. **Before charging anyone:** confirm with Stripe (or a payments lawyer) that holding riders' top-ups and paying drivers through Connect fits your account. Holding money for others can need a licence. Stripe's marketplace setup is designed for this, but check it for a wallet.
3. In GitHub, Settings → Secrets and variables → Actions, add `SUPABASE_ACCESS_TOKEN`, `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` (start with Stripe's test keys). The "Deploy the Stripe functions" workflow then deploys `stripe-checkout` and `stripe-webhook` and stores the keys in Supabase. The keys never go in `config.js`.
4. Stripe → Developers → Webhooks → Add endpoint `https://ttpryqrjkhlthftdkhju.supabase.co/functions/v1/stripe-webhook`, with the events `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted` and `account.updated`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
5. Supabase → SQL Editor: `update public.app_settings set value = 'true' where key = 'payments_live';`. When the fee should be charged: `… where key = 'fee_live';`.
6. The money, any time: `select email, sum(cents) / 100.0 from public.wallet_ledger group by 1;` and `select status, count(*), sum(fee_cents) / 100.0 as fees from public.seat_payments group by 1;`

## Where you start (`supabase/migrations/0007_starts.sql`)

- No more cities opening at 25 riders. A **region** (the Netherlands, Catalonia) has its spots; **crews leave from wherever riders live**.
- A rider sets where they start (their location, rounded to about 1 km, or a town or station from the list). It stays in their browser only. Crews from within about 35 km (or own-way crews within 120 km) show first under CREWS NEAR YOU, and the savings count from there.
- The first crew posted from a new place adds it as a starting point (`hi8_add_start`: within 160 km of the region's spots, kept to about 100 m, reused when one exists within 1.5 km, at most 10 new places an hour per phone). From then on it's on the list for everyone. Places nobody has started a crew from stay hidden.
- The card that replaced "not in your city yet" shows where crews leave from and "start one from <your town>".
- Take a place down: `delete from public.hubs where kind = 'town' and slug = 't-…';` (when no crew uses it).

## Plans (`supabase/migrations/0006_plans.sql`)

- Days out that are better with others: an **MX day at Moto Club Martorelles** (€180 a rider, all in: bike, gear, track, insurance and fuel), a **wakeboard session at BCP Barcelona Cable Park** (Fòrum) and a **first time on a cable at Olimpic Cable Park** (Castelldefels). Prices only where the place publishes them.
- **Add or change a plan** in Supabase, Table Editor, `plans`: slug, city, kind (mx, mtb, kite, wake, other…), title, place, blurb, and optionally price_from, price_note, includes, hours, spot (then the plan gets "start a crew for it"), maps, url, badge, sort. Untick `active` to take one down.
- **"I'm in"**: a day (or any), how many of you and a note; with no account, just an email (a founding plate comes with it). It lands in `plan_leads`, and the team gets an email once emails are on (`team_email` in Vault, else hello@hi8ctane.com). Who's in: `select * from public.plan_leads order by created_at desc;`
- **The ride fee**: `update public.app_settings set value = '12' where key = 'ride_fee_pct';` changes what the page shows. `fee_live` stays false until payments go through Hi8ctane.

## The pilot rules (`supabase/migrations/0005_pilot.sql`)

- **Anyone with a founding plate starts a crew** (no approval). Crews with rookies stay with approved captains. Back to captains only: Supabase, SQL Editor, `update public.app_settings set value = 'false' where key = 'open_posting';`
- **Start and sign up in one go**: email, rider name and the crew, one screen, one tap. Same for joining from a crew link.
- **Duplicates**: the same sport, spot and day starting within 2 hours gets a warning with a JOIN IT button (or post it anyway).
- **Share**: after posting, a WhatsApp message with the spot, time, wind, seats and the link; riders join in one tap with no app to install.
- **At the spot**: on the crew's day, "I'm at the spot" and a quick report (ON / MEH / OFF, the kite you're on, or the ground). The crew sees names and notes; the map and everyone else see the report without names.
- **Alerts**: "email me when someone posts a kite crew in Barcelona" (at most 3 a day, every email has a one-click stop link). People with no account get one with a single email field (and a founding plate).
- **Settle up with Bizum**: drivers add what the car cost and their Bizum number (shown only to the riders in their car) or a payment link.
- **Barcelona spots**: kite at Castelldefels, Sant Pere Pescador, Trabucador and Riumar; MTB at Collserola, Garraf and Sant Llorenç del Munt; MX at Moto Club Martorelles, Rocco's Ranch (Montmeló), ParcMotor Vallgorguina and Bellpuig. Pick-up points: Sants, La Sagrera, Zona Universitària, Gràcia. Every spot has its rules and a place name for directions. Edit them in Table Editor (`spots`, `hubs`); the app has a built-in copy in `hi8.js` for when Supabase can't be reached.
- **Settings the app reads** (`hi8_settings`): `open_posting`, `pilot_city`, `live_sports` (kite, mtb, mx), `soon_sports` (wing, surf, sup show as "coming soon"), `ride_fee_pct` (15) and `fee_live` (false).

## The core loop (2.7.3, still in place)

- **Post in one tap:** a good-day link (`B27-Start.dc.html?spot=wijk-aan-zee&sp=kite`) opens a quick post with the forecast's best window and the captain's own defaults (level, drive or own way, hub). One tap posts it; "Another day, spot or time" opens the full form.
- **Join on one screen:** someone with no account types their email, rider name, level and how they get there on the crew page itself (`hi8_quick_join`): they get a founding plate and a place in the crew at once.
- **Settle up:** drivers add what the car cost and a payment link (Tikkie, Revolut, PayPal, bunq, Wise, Monzo, Rabobank, ING). Everyone in that car sees their share, a pay button and "I've paid"; the driver sees the ticks.
- **Emails** (queued in `outbox`, sent through Resend once its key is in Supabase Vault): to the captain when someone joins or leaves; to the rider "you're in"; called off; a chat digest (at most one per crew every 2 hours); the driver's payment request; a reminder the evening before; a welcome with the plate.
- **Captains:** `select public.approve_captain('their@email.com');` once, and they can start crews in any city.
- **Forecast:** KNMI HARMONIE-AROME 2 km for Amsterdam (the first 2.5 days, then ECMWF), Météo-France AROME for Barcelona, ICON-D2 for Berlin; best_match fills any gaps.
- **Errors** on riders' phones land in `client_errors` (no names or emails).

### Switch the emails on

1. resend.com: add the domain hi8ctane.com and put the DNS records it shows at Squarespace (Domains → hi8ctane.com → DNS). Wait for "Verified".
2. Resend → API Keys → create one ("Sending access").
3. Supabase → SQL Editor: `select vault.create_secret('re_…your key…', 'resend_api_key');`
4. Check: `select kind, to_email, subject, sent_at, error from public.outbox order by id desc limit 20;` Waiting emails from the last 2 days go out within a minute.
5. For the "email me a link" sign-in: Supabase → Authentication → SMTP: host `smtp.resend.com`, port 465, user `resend`, password = the same key, sender `crews@hi8ctane.com`. Authentication → URL Configuration: Site URL `https://hi8ctane.com`, redirect `https://hi8ctane.com/**`. Then `emailLink: true` in `config.js`.

## Crews (2.7.2)

- **Captains** start crews. Francisco approves them: Supabase, SQL Editor, `select public.approve_captain('their@email.com', 'amsterdam');` (or tick `captain_approved` on their row in `signups`). Riders ask from the start-a-crew page or Me.
- **Anyone with a plate** joins: their level, and how they get there (need a seat, driving with free seats, own way). "Any car" puts them in the car with the most room. The fuel split is an estimate from the hub-to-spot distance.
- **The crew page** shows the meeting point, who's in and the cars only to people in the crew. Everyone else sees the spot, time, level and how many are going.
- **Crew chat**: in the app, the crew only, nobody's phone number shared.
- **Leave** any time; the captain can call it off with a reason.
- **Spots and hubs** live in the `spots` and `hubs` tables (Table Editor); the site has a built-in copy if the database can't be reached.
- **Forecast**: Open-Meteo's free API is for non-commercial use. Once Hi8ctane earns money, take an API plan and add the key (see `hi8.js`, `meteoKey` in `config.js`).

## Real sign-ups (Supabase)

`live.js` makes the sign-up screens real without changing how they look. It reads `config.js`; with the Supabase URL and publishable key filled in:

| Screen | What gets saved |
| --- | --- |
| Get In | Email and city; the real next founding plate shows on the sticker and the header plate. Enter submits; "did you mean gmail.com?" catches typos. If Supabase can't be reached, the sign-up waits in the browser and goes out on the next page |
| Onboarding | Rider name, sports and levels (on NEXT), hub, how far and getting there (before leaving). Starts blank, with the hub and sport picked on the landing already on. "Use my location" finds the real nearest hub |
| Founding Night | The RSVP (session, hub, waiver time, photo consent, which now starts unticked). Without an account it goes through Get In and straight back. Real counts, a real calendar file, a real share link |
| A new city | "I'm in" (with that city's founding plate) and "I'll captain" (sport and days). Real counts; the share link works |
| Schools + rental shops | The form, as well as the email. Asks for the name and contact before opening the email |
| Landing, web page | Remember the hub, sport and how far, for onboarding |

Without a URL and key in `config.js`, `live.js` does nothing and the site is the sample, exactly as before.

### Switch it on

1. Supabase → SQL Editor: run `supabase/migrations/0001_day_zero.sql`, then `0002_live_signups.sql`, `0003_crews.sql`, `0004_core_loop.sql` and `0005_pilot.sql` (or the one-paste file with all five).
2. Project Settings → API Keys: copy the project URL and the **publishable** key into `config.js`. Never the secret key.
3. Push to main. Sign up once on hi8ctane.com and look in Table Editor → `signups`.

### Make "EMAIL ME A LINK" and "CONTINUE WITH GOOGLE" real

Until these are on, sign-ups are saved but no email is sent, and the Google button points people to the email field.

- **Email link**: Authentication → Emails → SMTP settings: connect an email provider (Resend works well; verify hi8ctane.com there first). Authentication → URL Configuration: Site URL `https://hi8ctane.com`, redirect URL `https://hi8ctane.com/**`. Then `emailLink: true` in `config.js`.
- **Google**: create an OAuth client in Google Cloud, add it under Authentication → Sign In / Providers → Google, same URL settings. Then `google: true`.

The link and Google sign-in land on onboarding, where `live.js` swaps the sign-in for this browser's key (`hi8_claim`) and marks the email as verified.

### How it stays safe with a public key

The tables are locked (row-level security, no policies, no table rights for the public key). The browser can only call the `hi8_*` functions, which check every value, never return names or emails, and are rate-limited (20 sign-ups per visitor per 10 minutes, counted by a salted hash of the IP). Signing up gives the browser a random key that only changes its own sign-up. Details in the migration.

Tests: `test/live/` (see its README): 55 app checks in a browser, 57 pilot API checks, 63 sign-up checks, 42 crews API checks, 49 core-loop API checks, and 26 forecast-engine checks in `test/unit/`, against Postgres + PostgREST and a stand-in Open-Meteo.

