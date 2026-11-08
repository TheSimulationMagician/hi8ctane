#!/bin/bash
# Builds site/fonts/ (self-hosted brand fonts, Latin only) from the Google Fonts repository (SIL Open Font License).
#   git clone --depth 1 --filter=blob:none --sparse https://github.com/google/fonts google-fonts
#   (sparse-checkout ofl/anton, ofl/archivoblack, ofl/spacemono, ofl/bowlbyone, ofl/shrikhand, apache/specialelite, apache/permanentmarker)
#   bash scripts/make_fonts.sh google-fonts site/fonts      (needs fonttools: pip install fonttools)
set -e
SRC=${1:-google-fonts}; OUT=${2:-site/fonts}; mkdir -p "$OUT"
U="U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+2013-2014,U+2018-201E,U+2022,U+2026,U+20AC,U+2190,U+2192,U+2212,U+2713,U+2715,U+25B6,U+275A"
for f in anton/Anton-Regular archivoblack/ArchivoBlack-Regular spacemono/SpaceMono-Regular spacemono/SpaceMono-Bold; do
  pyftsubset "$SRC/ofl/$f.ttf" --unicodes="$U" --flavor=woff --layout-features='kern,liga' --output-file="$OUT/$(basename $f).woff"
done
for d in anton archivoblack spacemono; do cp "$SRC/ofl/$d/OFL.txt" "$OUT/OFL-$d.txt"; done
# The ransom-note wordmark: Bowlby One for the 8 (and big banner numbers), the other three carry one letter each
pyftsubset "$SRC/ofl/bowlbyone/BowlbyOne-Regular.ttf" --unicodes="U+0020-005A,U+20AC" --flavor=woff --layout-features='kern' --output-file="$OUT/BowlbyOne-Regular.woff"
pyftsubset "$SRC/ofl/shrikhand/Shrikhand-Regular.ttf" --text="T" --flavor=woff --output-file="$OUT/Shrikhand-T.woff"
pyftsubset "$SRC/apache/specialelite/SpecialElite-Regular.ttf" --text="c" --flavor=woff --output-file="$OUT/SpecialElite-c.woff"
pyftsubset "$SRC/apache/permanentmarker/PermanentMarker-Regular.ttf" --text="E" --flavor=woff --output-file="$OUT/PermanentMarker-E.woff"
cp "$SRC/ofl/bowlbyone/OFL.txt" "$OUT/OFL-bowlbyone.txt"; cp "$SRC/ofl/shrikhand/OFL.txt" "$OUT/OFL-shrikhand.txt"
cp "$SRC/apache/specialelite/LICENSE.txt" "$OUT/LICENSE-specialelite.txt"; cp "$SRC/apache/permanentmarker/LICENSE.txt" "$OUT/LICENSE-permanentmarker.txt"
