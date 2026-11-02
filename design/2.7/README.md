# Hi8ctane 2.7 · matching, new cities, Founding Night

The newest design round of the Hi8ctane website and app: 18 screens and the launch kit, exactly as on the design canvas page "2.7 · matching, new cities, Founding Night" (29 October 2026). It adds matching by level and start point, safety tools, "Keep this crew", the Founding Night RSVP and "Start Hi8 in your city".

## Run it

Same as 2.6: this folder is a website as it stands. Put it on any static host with `design/2.7` as the root, no build step.

- `index.html` opens the web page on a computer and the phone app on a phone (`?menu` shows the start page instead).
- `screens.html` lists every screen, to open live or as an image.
- `prototype/` holds the 19 screen files exactly as they are on the canvas, plus `support.js`, the same player as in 2.6. Every screen was checked pixel for pixel against the design tool.
- Sample data throughout: nothing anyone taps or types is saved.
- `screens/`: every screen as a PNG, rendered with stand-in fonts.

Colours, sport colours and sport badges are the same as 2.6: see `design/2.6/tokens.css` and `design/2.6/icons/`.

## Screens

| # / name | Prototype | What it shows |
|---|---|---|
| 00 WEB | `prototype/B27-Web.dc.html` | where you start from, crews by travel time, trust up front, Founding Night, new cities |
| 01 Landing (phone web) | `prototype/B27-Landing.dc.html` | start point, crews near you, the week, trust, the night |
| 02 Get in | `prototype/B27-Join.dc.html` | plate #038, Google or a link |
| 03 Onboarding in 2 steps | `prototype/B27-Onboard.dc.html` | level by what you can do, start point + how far |
| 04 Home | `prototype/B27-Home.dc.html` | matched for you with the reasons, your crews, open windows, Founding Night |
| 05 Spot forecast | `prototype/B27-Spot.dc.html` | + a plain "first time?" line |
| 06 Live map | `prototype/B27-Map.dc.html` | badge pins, wind arrows, drag the hour |
| 07 Start a crew | `prototype/B27-Start.dc.html` | your sport picked, the forecast table |
| 08 Invite | `prototype/B27-Invite.dc.html` | a friend's link, I'M IN |
| 09 Getting there | `prototype/B27-Ride.dc.html` | seat, car or own way, the split |
| 10 Crew day | `prototype/B27-Crew.dc.html` | + share my session, 112, report or block |
| 11 Crew chat | `prototype/B27-Chat.dc.html` | + safety: mute, report, block, leave |
| 12 After the ride | `prototype/B27-After.dc.html` | + Keep this crew, the "rides at my level" kudo |
| 13 Founding Night | `prototype/B27-Night.dc.html` | free RSVP with the waiver, pick a session, seats from 3 hubs |
| 14 Start Hi8 in your city | `prototype/B27-City.dc.html` | 25 riders + 3 captains, the spots already found |
| 15 Try something new | `prototype/B27-Try.dc.html` | rookie crews, what to bring |
| 16 Me | `prototype/B27-Me.dc.html` | + how we match you, safety + privacy |
| 17 Hi8 Radio | `prototype/B27-Radio.dc.html` | 80s + 90s, auto vibe |
| LAUNCH KIT | `prototype/B27-Kit.dc.html` | the 9 launch tiles, three stories, the LinkedIn banner, the first 30 days |
