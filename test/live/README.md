# Tests for the live sign-ups (`site/live.js` + `supabase/migrations/0002_live_signups.sql`)

They run the real thing locally: Postgres 16 with both migrations, PostgREST (the same REST server Supabase uses) in front of it, and a headless Chromium clicking through the screens.

- `e2e.py`: 66 checks. Landing → Get In → onboarding; the Founding Night RSVP without an account (Get In, then straight back); "I'm in" and "I'll captain" for a new city; the schools form; a sign-up made offline that goes out on the next page; the email-link sign-in; and that the website can't read tables, call internal functions, skip the waiver or flood the list.
- `crews_api.py`: 42 checks on the crews functions in 0003: captains only, seats and cars, full crews, leaving, calling off, chat for members only, erase.
- `core_api.py`: 49 checks on 0004: captains in any city, the one-go join, settling up and payment links, every email the outbox queues, sending through Resend (pg_net stubbed), error reports, access.
- `crews_e2e.py`: 53 checks in a browser: no sample people or numbers on any screen with an empty database; the forecast is real or says it's missing; a captain posts a crew; a rider finds it, signs up, joins with a seat; chat; home and Me; leave and call off.
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

# PostgREST 12 (static binary from github.com/PostgREST/postgrest/releases)
postgrest test/live/postgrest.conf &

# the site, with Supabase switched on (8801) and as it ships with an empty config.js (8802)
node test/live/serve.mjs site 8801 live &
node test/live/serve.mjs site 8802 off &

pip install playwright pillow && playwright install chromium
python3 test/live/e2e.py                      # wipes the test database's tables first
python3 test/live/crews_api.py && python3 test/live/core_api.py && python3 test/live/crews_e2e.py   # serve.mjs also stands in for Open-Meteo
python3 test/live/pixdiff.py 8802 <port of another copy of the site> out/
```
