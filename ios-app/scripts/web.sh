#!/bin/sh
# The app's web part: a copy of the live site (shrunk like the deploy), plus the native bridge.
# Run from ios-app/. The site itself is not changed.
set -e
rm -rf www && mkdir www
cp -R ../site/. www/
rm -f www/*.dc.html                                  # design boards are not part of the app
sh ../scripts/build.sh www "${ESBUILD:-npx --yes esbuild@0.28.2}"
cp native/native.js www/native.js
# load the bridge after the app's code, only in the app's copy of the page
sed -i.bak 's#<script defer src="app.js"></script>#<script defer src="app.js"></script><script defer src="native.js"></script>#' www/index.html && rm www/index.html.bak   # one line: works with macOS sed too
grep -q 'native.js' www/index.html
echo "www ready: $(du -sh www | cut -f1)"
