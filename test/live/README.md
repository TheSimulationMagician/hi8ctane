# Tests for the live site (`site/` + `supabase/migrations/`)

They run the real thing locally: Postgres 16 with both migrations, PostgREST (the same REST server Supabase uses) in front of it, and a headless Chromium clicking through the screens.

- `app_e2e.py`: 107 checks on the app in a browser (2.13 home: the sessions first, four at a time, each with one button, I'M GOING; right now at the spots; how it works in three lines; the map, the week, safety and the split, plans, where next and the coming sports folded under MORE; one I'M GOING at the bottom on the next session; I'M GOING on a session with a crew opens the join form, how you get there first; on a session with nobody yet, one question and the post, with the choice remembered; the region from the rider's time zone): the 2.7 look (logo, headline, tiles), the live map, the week ahead and the best window, ride with a buddy, the savings with the 15% fee (free in the pilot), plans and "I'm in", the full START A CREW form and JOIN A CREW for people with no account, the WhatsApp message, the duplicate warning, the chat, settling up with Bizum, checking in and reporting, alerts and their stop link, Me, the 7-day spot tables, old links forwarding, the desktop layout, and Open-Meteo being down.
- `pilot_api.py`: 57 checks on 0005: open posting and its switch, rookie crews for captains only, coming-soon sports, duplicates, start-and-sign-up in one go, alerts (at most 3 a day, the stop link), Bizum only for your car, check-ins and reports, the live map feed without names, rate limits, erase.
- `plans_api.py`: 26 checks on 0006: the ride fee setting, the Martorelles MX spot, plans and their counts, "I'm in" with or without an account, updates not counted twice, the team email, switched-off plans, rate limits, erase.
- `starts_api.py`: 19 checks on 0007: regions, starting points riders add (validation, reuse within 1.5 km, about 100 m precision), hidden until a crew leaves from them, crews from them, the rate limit, the MX day at €180.
- `wallet_api.py`: 26 checks on 0008: the wallet off and on, only the service role credits it, paying a seat (held, twice refused, not enough money says how much), the fee (pilot, live, waived by the Pass), refunds (left, called off), release to the driver the day after (once), withdrawals (all out first, back on failure, from €5), erase keeps the books anonymised.
- `looks_api.py` (7 checks, 0014): who's looking now and today, per region, counted once per visitor, tables closed.
- `../unit/alerts_test.mjs` (45 checks, 0019 + `scripts/alerts.mjs`): wind alerts at each rider's own conditions, push subscriptions, watchers, "only if 3 of us", moving a crew, profiles, phones and no-shows, "how was it" the day after; then the worker against the stand-in forecast and a fake push service: one alert per rider and day (email with a stop link and List-Unsubscribe, push encrypted and VAPID-signed), "forecast dropped", "how was it?" by phone or email, gone phones forgotten, the web push keys made once, erase.
- `alerts_e2e.py` (19 checks, 2.23 in a browser): the alert sheet and its weekly preview, the push guide on Android and iPhone, one-tap I'M GOING for a returning rider, IF 2 MORE, the forecast dropping on a crew and moving it, "how was it" and the card stamp, the rider profile on the crew page.
- `cards_api.py` (20 checks, 0020, 2.24): rider cards and who sees what: outside the crew no names, cartoons or Instagram; signed in, how often you rode together; a closed card; no-shows don't count as rides; no emails.
- `mycrew_api.py` (21 checks, 0015): keep a crew, join it by link, call it for the next session (one email each, once), the rider card and log, starred spots and their emails, erasing a rider.
- `where_api.py` (14 checks, with the six Amsterdam kite spots of 0012): 13 checks on 0010: Tarifa open with pick-ups in Tarifa, Algeciras and Cádiz and its spot notes, starting from a nearby town, the Tatajuba list (email, key, twice is once, open regions and bad emails refused), trips back from every region and "I'm in" on a trip.
- `bcn_mtb_pilot.py`: the first Barcelona pilot start to finish: an MTB trail crew at Collserola from Sants, a seat, the chat, check-in and the trail report (8 checks).
- `routes_api.py`: 14 checks on 0009: only crew members set where they start, too far refused, kept to about 1 km, the best car for a rider who needs a seat, the best pick-up per rider, stops in order with times before the start, a Google Maps route, nobody's start leaks, paid seats stay put.
- `../unit/money_test.mjs`: 23 checks on the Stripe functions against the real database and a fake Stripe: signatures, top-up checkout and webhook (once), unpaid not credited, the €100 cap, the Pass subscription on and off, withdrawals through Connect.
- `../unit/fx_test.mjs`: 31 checks on the forecast engine (`site/fx.js`): kite, MTB and MX ratings, shore classes, kite size, windows, a week ahead, a day's numbers (rain chance, cloud, waves, water, light), model agreement, the map grid.
- `e2e.py`: 64 checks. hi8ctane.com/tarifa opens the app in Tarifa; The old landing link → Get In → onboarding; the Founding Night RSVP without an account (Get In, then straight back); "I'm in" and "I'll captain" for a new city (Lisbon); the schools form; a sign-up made offline that goes out on the next page; the email-link sign-in; and that the website can't read tables, call internal functions, skip the waiver or flood the list.
- `crews_api.py`: 42 checks on the crews functions in 0003: captains only, seats and cars, full crews, leaving, calling off, chat for members only, erase.
- `core_api.py`: 49 checks on 0004: captains in any city, the one-go join, settling up and payment links, every email the outbox queues, sending through Resend (pg_net stubbed), error reports, access.
- `security_api.py`: 25 checks as an attacker with only the publishable key: every table refused directly, row level security everywhere, no grants or usable sequences, pinned search paths, server-only functions closed, a stranger against a crew (chat, driver, paid, leave), no emails in public lists, SQL and HTML in fields (in a browser), a forged token, sign-up spam, and `supabase/security_check.sql` finds nothing.
- `cartoon_e2e.py`: 18 checks on cartoons (2.18) in a browser: Me → a selfie or a photo, squared and shrunk before sending, the consent box, drawing, the cartoon on the plate and in the crew (not on public cards), one file per rider, 3 a day, remove, a too-small photo. serve.mjs runs the real cartoon function with a fake OpenAI and Storage in memory.
- `../unit/cartoon_test.mjs`: 28 checks on the cartoon function against the real database: bad or huge images, no consent, no key, what goes to OpenAI, the selfie never stored, replace and delete, the per-rider and daily caps, OpenAI refusing or down, the switch, who can see a cartoon, remove and erase.
- `pixdiff.py`: screenshots every screen from two servers and compares them pixel for pixel. Used to prove the screens look exactly as designed with live.js in place.
- `serve.mjs`: serves `site/` like GitHub Pages and stands in for Supabase's gateway (`/rest/v1` → PostgREST, `/auth/v1` recorded). In `live` mode it serves a test `config.js`.
- `supabase_like.sql`: the roles and the bit of `auth.users` a fresh Supabase project has.

## Run them

```
# Postgres 16 on port 5440, a database "hi8" with the Supabase roles and both migrations
createdb -h 127.0.0.1 -p 5440 -U postgres hi8
psql -h 127.0.0.1 -p 5440 -U postgres -d hi8 -f test/live/supabase_like.sql
psql -h 127.0.0.1 -p 5440 -U postgres -d hi8 -f supabase/migrations/0001_day_zero.sql
psql -h 127.0.0.1 -p 5440 -U postgres -d hi8 -f supabase/migrations/0002_live_signups.sql
psql -h 127.0.0.1 -p 5440 -U postgres -d hi8 -f supabase/migrations/0003_crews.sql
psql -h 127.0.0.1 -p 5440 -U postgres -d hi8 -f supabase/migrations/0004_core_loop.sql
psql -h 127.0.0.1 -p 5440 -U postgres -d hi8 -f supabase/migrations/0005_pilot.sql
psql -h 127.0.0.1 -p 5440 -U postgres -d hi8 -f supabase/migrations/0006_plans.sql
psql -h 127.0.0.1 -p 5440 -U postgres -d hi8 -f supabase/migrations/0007_starts.sql
psql -h 127.0.0.1 -p 5440 -U postgres -d hi8 -f supabase/migrations/0008_wallet.sql

# PostgREST 12 (static binary from github.com/PostgREST/postgrest/releases)
postgrest test/live/postgrest.conf &

# the site, with Supabase switched on (8801) and as it ships with an empty config.js (8802)
node test/live/serve.mjs site 8801 live &
node test/live/serve.mjs site 8802 off &

pip install playwright pillow && playwright install chromium   # crews_api/core_api run in captains-only mode, pilot_api and app_e2e with open posting
python3 test/live/e2e.py                      # wipes the test database's tables first
python3 test/live/crews_api.py && python3 test/live/core_api.py && python3 test/live/pilot_api.py && python3 test/live/plans_api.py && python3 test/live/starts_api.py && python3 test/live/wallet_api.py && python3 test/live/routes_api.py && python3 test/live/where_api.py && node test/unit/money_test.mjs && node test/unit/cartoon_test.mjs && python3 test/live/cartoon_e2e.py && python3 test/live/security_api.py
python3 test/live/app_e2e.py                  # serve.mjs also stands in for Open-Meteo
node test/unit/fx_test.mjs                    # needs serve.mjs on 8801
python3 test/live/pixdiff.py 8802 <port of another copy of the site> out/
```
