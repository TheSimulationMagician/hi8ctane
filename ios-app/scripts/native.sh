#!/bin/sh
# After "npx cap add ios": our iOS settings on the generated project. Run from ios-app/ on a Mac.
# VERSION (e.g. 1.0.0) and BUILD (a number that goes up with every upload) come from the workflow.
set -e
PL=ios/App/App/Info.plist
B=/usr/libexec/PlistBuddy
cp native/ios/AppDelegate.swift ios/App/App/AppDelegate.swift
set_key() { $B -c "Delete :$1" "$PL" >/dev/null 2>&1 || true; $B -c "Add :$1 $2 $3" "$PL"; }
set_key CFBundleDisplayName string "Hi8ctane"
set_key CFBundleShortVersionString string "${VERSION:-1.0.0}"
set_key CFBundleVersion string "${BUILD:-1}"
set_key NSLocationWhenInUseUsageDescription string "To check you are at the spot when you tell other riders how it is. Your location is only compared with the spot, never kept."
set_key ITSAppUsesNonExemptEncryption bool false
set_key UIViewControllerBasedStatusBarAppearance bool true
$B -c "Delete :UIBackgroundModes" "$PL" >/dev/null 2>&1 || true
$B -c "Add :UIBackgroundModes array" "$PL"
$B -c "Add :UIBackgroundModes:0 string remote-notification" "$PL"
# iPhone only, portrait
$B -c "Delete :UISupportedInterfaceOrientations" "$PL" >/dev/null 2>&1 || true
$B -c "Add :UISupportedInterfaceOrientations array" "$PL"
$B -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait" "$PL"
# push and the links that open the app (applinks needs the Team ID file on hi8ctane.com, see README)
cat > ios/App/App/App.entitlements <<'X'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>aps-environment</key><string>production</string>
  <key>com.apple.developer.associated-domains</key><array><string>applinks:hi8ctane.com</string></array>
</dict></plist>
X
# point the build at the entitlements, iPhone only
sed -i '' 's#INFOPLIST_FILE = App/Info.plist;#INFOPLIST_FILE = App/Info.plist; CODE_SIGN_ENTITLEMENTS = App/App.entitlements; TARGETED_DEVICE_FAMILY = 1;#g' ios/App/App.xcodeproj/project.pbxproj
# app icon: the 1024 px icon, iOS makes the rest
if [ -f native/ios/icon-1024.png ]; then cp native/ios/icon-1024.png ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png; fi
echo "native settings applied"
