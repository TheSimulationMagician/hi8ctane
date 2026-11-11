# Hi8ctane for iPhone

The App Store app is the website in a native shell (Capacitor), plus one thing the website can't do:
a home-screen widget that shows the next good session and who's going.

Status: started. The widget feed is written and tested. The Swift files are written but have never been
built: that needs a Mac with Xcode. Nothing here changes the live site.

## What's in the repo

| File | What it is | State |
| --- | --- | --- |
| `widget/feed.mjs` | Builds the widget's JSON from the site's own forecast engine and the crews | Tested: `node test/unit/widget_test.mjs` (11 checks) |
| `supabase/functions/widget/index.ts` | Serves that JSON, cached 15 minutes | Written, not deployed |
| `ios/Hi8Widget/Hi8Widget.swift` | The widget: a countdown to the next good session, the week as bars, who's going. Small, medium, large, and two lock-screen sizes | Written, not built |
| `ios/Hi8Widget/Hi8Bridge.swift` | Lets the app tell the widget your region, sport and weight | Written, not built |
| `capacitor.config.json` | The native shell's settings | Written |
| `site/app.js` (`?go=`) | A widget tap opens I'M GOING on that session | Live-tested in a browser |

## What you need

- A Mac with Xcode 15 or newer.
- An Apple Developer account (the yearly fee; see the real-numbers doc).
- The widget function deployed, and its URL pasted into `Hi8Shared.feedBase` in `Hi8Widget.swift`.

## First build, step by step

1. In the repo: `npm i @capacitor/core @capacitor/cli @capacitor/ios`, then `npx cap add ios`. This creates `ios/App`.
2. Open `ios/App/App.xcworkspace` in Xcode. Set your team under Signing for the App target.
3. File → New → Target → Widget Extension, named `Hi8Widget`. No configuration intent, no Live Activity.
4. Replace the generated Swift file with `ios/Hi8Widget/Hi8Widget.swift`.
5. Add `ios/Hi8Widget/Hi8Bridge.swift` to the **App** target (not the widget).
6. For both targets: Signing & Capabilities → + App Groups → `group.com.hi8ctane.app`.
7. Add `Anton-Regular.ttf` and `ArchivoBlack-Regular.ttf` to the widget target, and list them in its
   Info.plist under "Fonts provided by application".
8. Run on your phone, long-press the home screen, add the Hi8ctane widget.

## Still to do before the App Store

- Call `Hi8Bridge.set(...)` from the web app when the rider changes region, sport or weight.
- Open widget links inside the app (universal links for hi8ctane.com, or a `hi8ctane://` scheme).
- Push notifications for "it's on tomorrow, 3 going" (needs Apple's push key and a sender).
- Sign in with Apple if we keep email sign-in (Apple's review asks for it when other sign-ins are offered).
- App icon, screenshots, privacy labels, and the review notes.
- A commercial forecast plan: the app can't ship on the free non-commercial API.
- Android: the same shell; the widget is a separate, native build.
