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

## Notifications (server side, migration 0031)
- The app saves its phone's token with `hi8_push_native`; everything that goes out as web push also goes to the app.
- The alert worker sends to Apple (`supabase/functions/_shared/apns.js`) once these Edge Function secrets are set
  (Supabase > Edge Functions > Secrets, pasted by the founder): `APNS_KEY_P8` (the .p8 file's text), `APNS_KEY_ID`,
  `APPLE_TEAM_ID`, `APNS_TOPIC` = `com.hi8ctane.app`. Until then the iPhone part waits; nothing else changes.
- The buttons answer with `hi8_push_answer`: I'M IN · A SEAT / MEETING THERE / NOT NOW (a crew that fits), STILL IN /
  I'M OUT (forecast dropped), ON / MEH / OFF (how was it). If it can't be done from the lock screen, the app opens the crew.
- Tested end to end with a local HTTP/2 "Apple": `node test/unit/iphone_push_test.mjs` (30 checks).

## Still to do before TestFlight
- The links that open the app: `/.well-known/apple-app-site-association` on hi8ctane.com, with the Team ID.
- The 1024 px app icon (`native/ios/icon-1024.png`).
- The visual pass the founder asked for (27 Nov).
