# Hi8ctane 2.6 · web + app ("the push")

The 2.6 design round of the Hi8ctane website and app: 16 screens and the sport logo sheet, exactly as on the design canvas page "2.6 · web + app · the push" (26 October 2026).

It runs as a clickable website with sample data; it is not the production app. The newer round is 2.7 (matching by level and location, new cities, Founding Night), on the canvas page "2.7 · matching, new cities, Founding Night". The site that goes live is the day-zero code (`hi8ctane-day0`).

## Run it

This folder is a website as it stands: put it on any static host (Vercel, GitHub Pages, Netlify) with `design/2.6` as the root, no build step.

- `index.html` opens the web page on a computer and the phone app on a phone (`?menu` shows the start page instead).
- `screens.html` lists every screen, to open live or as an image.
- `prototype/` holds the 17 screen files exactly as they are on the canvas, plus `support.js`, a small player (our own code, no dependencies) that runs them outside the design tool: the same layout, fonts, taps, typing and links between screens. Every screen and its main tap states were checked pixel for pixel against the design tool.
- Sample data throughout: nothing anyone taps or types is saved.
- `.github/workflows/pages.yml` (repo root) publishes this folder to GitHub Pages on every change on main.

## Also in this folder

- `screens/`: every screen as a PNG, full length (phone 390 px wide, web 1280 px). Rendered with stand-in fonts.
- `tokens.css`: the colours, sport colours, borders, shadows and fonts used in 2.6.
- `icons/sports/`: the 2.6 sport badges as SVG, framed and flat, for kite, wing, surf, SUP, MTB and MX.

## Screens

| # | Screen | Image | Prototype | What it shows |
|---|---|---|---|---|
| 00 | Web | `screens/00-web.png` | `prototype/B26-Web.dc.html` | hi8ctane.com on a laptop: find, compare, join, the week ahead |
| 01 | Landing (phone web) | `screens/01-landing.png` | `prototype/B26-Landing.dc.html` | 3 taps, live crews, the split |
| 02 | Get in | `screens/02-get-in.png` | `prototype/B26-Join.dc.html` | plate #038, Google or a link |
| 03 | Onboarding | `screens/03-onboarding.png` | `prototype/B26-Onboard.dc.html` | name, sports (badges) + level, alerts |
| 04 | Home (app) | `screens/04-home.png` | `prototype/B26-Home.dc.html` | today's call, picked for you, open crews |
| 05 | Spot forecast | `screens/05-spot-forecast.png` | `prototype/B26-Spot.dc.html` | the meter, hour table, tide, best window |
| 06 | Live map | `screens/06-live-map.png` | `prototype/B26-Map.dc.html` | badge pins, wind arrows, drag the hour |
| 07 | Start a crew | `screens/07-start-a-crew.png` | `prototype/B26-Start.dc.html` | your sport picked, the forecast table |
| 08 | Invite | `screens/08-invite.png` | `prototype/B26-Invite.dc.html` | a friend's link, I'M IN |
| 09 | Getting there | `screens/09-getting-there.png` | `prototype/B26-Ride.dc.html` | seat, car or own way, the split |
| 10 | Crew day | `screens/10-crew-day.png` | `prototype/B26-Crew.dc.html` | before, at the beach, after |
| 11 | Crew chat | `screens/11-crew-chat.png` | `prototype/B26-Chat.dc.html` | the crew's chat with quick replies |
| 12 | After the ride | `screens/12-after-the-ride.png` | `prototype/B26-After.dc.html` | session cover, stamp, settle, kudos |
| 13 | Try something new | `screens/13-try-something-new.png` | `prototype/B26-Try.dc.html` | rookie crews, what to bring |
| 14 | Me | `screens/14-me.png` | `prototype/B26-Me.dc.html` | passport, your sports, alerts |
| 15 | Hi8 Radio | `screens/15-hi8-radio.png` | `prototype/B26-Radio.dc.html` | 80s + 90s, auto vibe |
| — | Sport logos | `screens/sport-logos.png` | `prototype/B26-Marks.dc.html` | the badge + the hybrid sport cards |

## Left out on purpose

The Hi8 Pass, rentals and lessons, and the second-hand market stay private for now, so 2.6 has no screens for them.

## Fonts

Archivo Black for headings, Anton for numbers and Space Mono for body text. The wordmark letters also use Bowlby One, Yellowtail, Permanent Marker, Special Elite, VT323 and Shrikhand. All are on Google Fonts.
