# Hi8ctane

Same-day crews for kite, wing, surf, SUP, MTB and MX. Everything for hi8ctane.com lives in this repo.

| Folder | What it is | How it runs |
| --- | --- | --- |
| `/` (root: `public/`, `api/`, `supabase/`) | **The day-zero site** that goes live at hi8ctane.com: landing, the week ahead, founding plates, city waitlists, Founding Night RSVP | Vercel, from this repo; deploy steps below |
| `site/` | **The live site, version 1**: the 2.7 website and app screens exactly as designed, plus the partner page for schools and rental shops | GitHub Pages via `.github/workflows/pages.yml`, or any static host with `site` as root |
| `design/2.6/` | The 2.6 website and app, clickable exactly as designed (sample data) | Any static host with `design/2.6` as root |
| `design/2.7/` | The 2.7 round as on the canvas (matching, safety, Founding Night, new cities), clickable exactly as designed | Any static host with `design/2.7` as root |
| `dev-packs/2.4/`, `dev-packs/2.5/` | The app's database schema, migrations, Plan B booking rules and tests, analytics, payments notes | Reference for building the app |

Suggested hosting: hi8ctane.com → the day-zero site (Vercel project, repo root). demo.hi8ctane.com → `design/2.6` or `design/2.7` (second Vercel project, Root Directory set to that folder, framework "Other", no build command). The domain stays at Squarespace; add the DNS records Vercel shows under Squarespace → Domains → hi8ctane.com → DNS.

---

# The day-zero site

What goes live at hi8ctane.com today, before the app exists:

- `/` the landing: start point, sports, today's call and **the week ahead** (live Open-Meteo forecast, rated per sport), how it works, trust, the fuel split, **founding plates** (the first 100 per city).
- `/night` the **Founding Night** RSVP (session, pickup hub, waiver, photo consent).
- `/city/lisbon`, `/city/tarifa`, `/city/berlin` (also `/lisbon` …): **Start Hi8 in your city** waitlists with "I'll captain".
- `/privacy`, `/terms`: plain-language drafts. Francisco checks them; a lawyer reviews before the app launches.

Static HTML/CSS/JS in `public/`, five Vercel Functions in `api/`, one SQL migration. **No dependencies, no build step**: nothing to install, nothing to break.

## Deploy (about an hour)

1. **Supabase** (EU, Ireland): SQL Editor → paste and run `supabase/migrations/0001_day_zero.sql`. Then Settings → API Keys → copy the project URL and a **secret** key (`sb_secret_…`).
2. **GitHub**: push this folder to `TheSimulationMagician/hi8ctane` (a `day-zero` branch first, then `main`).
3. **Vercel**: Add New → Project → import the repo. Framework preset **Other**, no build command, output directory `public` (already in `vercel.json`).
4. **Environment variables** (Production + Preview), from `.env.example`: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SITE_URL`; optional `OPEN_METEO_API_KEY`, `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_REPLY_TO`. Redeploy after adding them.
5. **Check the preview URL**: `/api/health` should say `"database": true`. Sign up once, RSVP once, then look in Supabase → Table Editor → `signups` / `night_rsvps`.
6. **Domains**: Project → Settings → Domains → add `hi8ctane.com` and `www.hi8ctane.com` (redirect www → apex), and `hi-8.live` (redirect → hi8ctane.com). Add the DNS records Vercel shows at the registrar. HTTPS is automatic.
7. **Smoke test on hi8ctane.com** (the deploy-day doc has the list), then tell people.

Rollback: Vercel → Deployments → the last good one → Promote to Production. The database keeps every sign-up.

## Run it locally

```
cp .env.example .env        # fill in, or leave empty: pages work, forms answer "not configured"
npm run dev                 # http://localhost:3000, same routes as Vercel
npm test                    # 23 tests: the meter, validation, every endpoint with fake Supabase/Open-Meteo/Resend
PGHOST=/tmp PGPORT=5432 PGUSER=postgres npm run test:sql   # the migration + its checks on a local Postgres 16
```

`test/e2e/fake-services.mjs` stands in for Supabase (backed by a local Postgres) and Open-Meteo, for clicking through offline.

## How it fits together

| Piece | File | Notes |
| --- | --- | --- |
| Sign-up + plate | `api/signup.js` → `join_waitlist()` | Upsert per city + email; plates 1–100 handed out under a per-city lock |
| RSVP | `api/rsvp.js` → `rsvp_night()` | Waiver required (also enforced in SQL) |
| Counters | `api/counts.js` → `public_counts()` | Only numbers, cached 30 s at the edge |
| The week | `api/week.js`, `api/_lib/forecast.js`, `api/_lib/meter.js` | One Open-Meteo call per city, cached 30 min at the edge; commercial endpoints when `OPEN_METEO_API_KEY` is set |
| Email | `api/_lib/mail.js` | Resend, optional; never blocks a sign-up |
| Spots | `api/_lib/spots.js` | Wind ranges per beach; Barcelona values are first estimates |

Security: the browser never sees a key. Tables have row-level security on and no policies; the functions can only be called with the secret key (checked in `test/sql`). Forms have a honeypot field and refuse posts from other sites. If spam shows up, add a Vercel WAF rate-limit rule on `/api/signup`.

## Before the app launches

- `npm run fonts` once, commit `public/fonts/` + `public/css/fonts.css`, then remove `fonts.googleapis.com` and `fonts.gstatic.com` from the CSP in `vercel.json` (no visitor IPs to Google).
- Open-Meteo API Standard key in place (the free API is non-commercial only).
- Dutch and Spanish copy.
- The app itself replaces `/` and reuses these tables: `signups` becomes the riders list, plates carry over.
