# The Hi8ctane iPhone app

The site (`../site`), bundled, in a native shell (Capacitor 7). The same code as hi8ctane.com, so a fix ships to both;
the native parts are what makes it an app: notifications with buttons, the location check for spot reports, links that
open the app, and (v1.1) the widget. The screens, one by one: the design canvas, board "Round 4 · the iPhone app".

## Build
A Mac in the cloud builds it: GitHub > Actions > "iPhone app" > Run workflow (version, e.g. 1.0.0). It sends the build to
TestFlight. Needs four secrets, pasted by the founder (never through chat): `APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`,
`ASC_KEY_P8`. See the top of `.github/workflows/ios.yml`.

On a Mac with Xcode: `npm install`, `npm run web`, `npx cap add ios`, `sh scripts/native.sh`, `npx cap open ios`.

## Files
- `native/native.js`: the bridge (links, notifications, their buttons, location), loaded only in the app.
- `native/ios/AppDelegate.swift`: the notification buttons (crew: I'M IN · A SEAT / MEETING THERE / NOT NOW; recheck: STILL IN / I'M OUT; spot: ON / MEH / OFF).
- `scripts/web.sh`: the site, shrunk, into `www/`. `scripts/native.sh`: our iOS settings on the generated project.

## Still to do before TestFlight
- Migration 0031: phone tokens (`hi8_push_native`) and answers from the buttons (`hi8_push_answer`); the alert worker
  sending to Apple (APNs) with the category per message.
- The links that open the app: `/.well-known/apple-app-site-association` on hi8ctane.com, with the Team ID.
- The 1024 px app icon (`native/ios/icon-1024.png`).
