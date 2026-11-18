#!/bin/sh
# Shrinks the site's code for publishing: the repo keeps the readable files, the live site gets the small ones.
# Used by .github/workflows/pages.yml on its copy of site/. Usage: scripts/build.sh <dir> [esbuild command]
set -e
D=${1:-site}
E=${2:-npx --yes esbuild@0.28.2}
for f in hi8.js geo.js fx.js map.js app.js live.js sw.js; do
  [ -f "$D/$f" ] && $E "$D/$f" --minify --charset=utf8 --legal-comments=none --target=es2017 --outfile="$D/$f" --allow-overwrite --log-level=warning
done
$E "$D/app.css" --minify --charset=utf8 --outfile="$D/app.css" --allow-overwrite --log-level=warning
echo "shrunk: $(cat "$D"/app.js "$D"/fx.js "$D"/map.js "$D"/hi8.js "$D"/geo.js "$D"/app.css | wc -c) bytes for the landing's code"
