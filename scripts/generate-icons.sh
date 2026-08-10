#!/usr/bin/env bash
# Generate tray and app icons from logo/kizami-icon.paths.svg.
# The design matches the zabuton family (meguri): rounded square in the candy
# background colour, kanji 刻 and inner border in the tomato gradient
# (Yuji Syuku, pre-converted to paths).
# Outputs: resources/icon.png, resources/tray-running.png,
#          resources/tray-idle.png, resources/trayTemplate.png (+@2x, macOS)
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p resources
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

src=logo/kizami-icon.paths.svg

# App icon (256px, full colour).
rsvg-convert -w 256 -h 256 "$src" -o resources/icon.png

# Tray icons are scaled-down versions of the app icon.
# running: full colour / idle: desaturated.
rsvg-convert -w 88 -h 88 "$src" -o "$tmp/tray-base.png"
magick "$tmp/tray-base.png" -resize 22x22 resources/tray-running.png
magick "$tmp/tray-base.png" -modulate 100,0 -resize 22x22 resources/tray-idle.png

# macOS template image: black shape + alpha. The tomato-gradient glyph and
# inner border are knocked out to transparency, the rest becomes black.
magick "$tmp/tray-base.png" \
  -fuzz 25% -transparent '#ff6b57' -fuzz 25% -transparent '#e0432e' \
  -channel RGB -fill black -colorize 100 +channel \
  "$tmp/template-base.png"
magick "$tmp/template-base.png" -resize 16x16 resources/trayTemplate.png
magick "$tmp/template-base.png" -resize 32x32 "resources/trayTemplate@2x.png"

echo "Icons generated in resources/"
