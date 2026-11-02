# The live site (version 1)

What goes live at hi8ctane.com: the 2.7 website and app screens, exactly as designed, plus the partner page for schools and rental shops. GitHub Pages publishes this folder on every change on main (`.github/workflows/pages.yml`).

- `index.html` opens the web page on a computer and the phone site on a phone.
- `B27-*.dc.html` are the 2.7 screens from the canvas, run by `support.js` (the same player as in `design/`). The launch kit is left out: it's for us, not for riders.
- `B27-Schools.dc.html` is the partner page for schools and rental shops: what they get, how it works, and a short form that opens an email to hello@hi8ctane.com with the details filled in (and, with Supabase on, saves it too).
- `privacy/`, `terms/`: plain-language drafts, linked from the footers. Francisco checks them; a lawyer reviews them before the app launches.
- Short links: `hi8ctane.com/join`, `/night`, `/schools`, `/city`, `/lisbon`, `/tarifa`, `/berlin` open the right screen and keep `?ref=` and `?utm_…` (use them in ads, bios and influencer links).

## Real sign-ups (Supabase)

`live.js` makes the sign-up screens real without changing how they look. It reads `config.js`; with the Supabase URL and publishable key filled in:

| Screen | What gets saved |
| --- | --- |
| Get In | Email and city; the real next founding plate shows on the sticker. Enter submits. If Supabase can't be reached, the sign-up waits in the browser and goes out on the next page |
| Onboarding | Rider name, sports and levels (on NEXT), hub, how far and getting there (before leaving). Starts blank, with the hub and sport picked on the landing already on. "Use my location" finds the real nearest hub |
| Founding Night | The RSVP (session, hub, waiver time, photo consent, which now starts unticked). Without an account it goes through Get In and straight back. Real counts, a real calendar file, a real share link |
| A new city | "I'm in" (with that city's founding plate) and "I'll captain" (sport and days). Real counts; the share link works |
| Schools + rental shops | The form, as well as the email. Asks for the name and contact before opening the email |
| Landing, web page | Remember the hub and sport picked, for onboarding |

The rest of the app screens (home, crews, chat, map) are still sample data.

Without a URL and key in `config.js`, `live.js` does nothing and the site is the sample, exactly as before.

### Switch it on

1. Supabase → SQL Editor: run `supabase/migrations/0001_day_zero.sql`, then `0002_live_signups.sql`.
2. Project Settings → API Keys: copy the project URL and the **publishable** key into `config.js`. Never the secret key.
3. Push to main. Sign up once on hi8ctane.com and look in Table Editor → `signups`.

### Make "EMAIL ME A LINK" and "CONTINUE WITH GOOGLE" real

Until these are on, sign-ups are saved but no email is sent, and the Google button points people to the email field.

- **Email link**: Authentication → Emails → SMTP settings: connect an email provider (Resend works well; verify hi8ctane.com there first). Authentication → URL Configuration: Site URL `https://hi8ctane.com`, redirect URL `https://hi8ctane.com/**`. Then `emailLink: true` in `config.js`.
- **Google**: create an OAuth client in Google Cloud, add it under Authentication → Sign In / Providers → Google, same URL settings. Then `google: true`.

The link and Google sign-in land on onboarding, where `live.js` swaps the sign-in for this browser's key (`hi8_claim`) and marks the email as verified.

### How it stays safe with a public key

The tables are locked (row-level security, no policies, no table rights for the public key). The browser can only call the `hi8_*` functions, which check every value, never return names or emails, and are rate-limited (20 sign-ups per visitor per 10 minutes, counted by a salted hash of the IP). Signing up gives the browser a random key that only changes its own sign-up. Details in the migration.

Tests: `test/live/` (62 end-to-end checks against Postgres + PostgREST, and a pixel-for-pixel comparison of every screen).

The same screens are on the design canvas as the page "2.7.1 · live site: schools + rental shops".
