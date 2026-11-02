# The live site (version 1, round 2.7.2)

What runs at hi8ctane.com: the 2.7 website and app screens, with nothing made up. Every crew, rider and count comes from Supabase; every forecast from Open-Meteo. When there's nothing to show, the screens say so. GitHub Pages publishes this folder on every change on main (`.github/workflows/pages.yml`).

- `index.html` opens the web page on a computer and the phone site on a phone.
- `B27-*.dc.html` are the screens, run by `support.js` (the same player as in `design/`). The design canvas has them as the page "2.7.2 · real crews, real forecast".
- `hi8.js` is the data layer every screen shares: Supabase calls with the publishable key, the browser key, the offline queue, crews, your rider profile, and the forecast (Open-Meteo weather, marine and three models, rated per sport by the good-day meter, cached 30 minutes).
- `live.js` extends the sign-up screens (Get In, onboarding, Founding Night, new city, schools form) without changing how they look.
- `config.js`: the Supabase URL and publishable key. Never the secret key.
- After the ride, Try something new, Invite and Getting there are off the live site until they have real data behind them; their old links forward to the crew page or home.
- `B27-Schools.dc.html`: the partner page for schools and rental shops. `privacy/`, `terms/`: plain-language drafts.
- Short links: `hi8ctane.com/join`, `/night`, `/schools`, `/city`, `/lisbon`, `/tarifa`, `/berlin`. They keep `?ref=` and `?utm_…`.

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

1. Supabase → SQL Editor: run `supabase/migrations/0001_day_zero.sql`, then `0002_live_signups.sql`, then `0003_crews.sql`.
2. Project Settings → API Keys: copy the project URL and the **publishable** key into `config.js`. Never the secret key.
3. Push to main. Sign up once on hi8ctane.com and look in Table Editor → `signups`.

### Make "EMAIL ME A LINK" and "CONTINUE WITH GOOGLE" real

Until these are on, sign-ups are saved but no email is sent, and the Google button points people to the email field.

- **Email link**: Authentication → Emails → SMTP settings: connect an email provider (Resend works well; verify hi8ctane.com there first). Authentication → URL Configuration: Site URL `https://hi8ctane.com`, redirect URL `https://hi8ctane.com/**`. Then `emailLink: true` in `config.js`.
- **Google**: create an OAuth client in Google Cloud, add it under Authentication → Sign In / Providers → Google, same URL settings. Then `google: true`.

The link and Google sign-in land on onboarding, where `live.js` swaps the sign-in for this browser's key (`hi8_claim`) and marks the email as verified.

### How it stays safe with a public key

The tables are locked (row-level security, no policies, no table rights for the public key). The browser can only call the `hi8_*` functions, which check every value, never return names or emails, and are rate-limited (20 sign-ups per visitor per 10 minutes, counted by a salted hash of the IP). Signing up gives the browser a random key that only changes its own sign-up. Details in the migration.

Tests: `test/live/`: 67 sign-up checks, 42 crews API checks and 40 crew-flow checks in a browser, against Postgres + PostgREST and a stand-in Open-Meteo.

