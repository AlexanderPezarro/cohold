#!/usr/bin/env bash
# Regenerate all favicon and PWA icon PNGs from the SVG sources.
# Requirements: rsvg-convert (librsvg) and python with Pillow.
set -euo pipefail

cd "$(dirname "$0")/.."
PUB="client/public"
PY="${PYTHON:-python3}"

render() {
  local src="$1" size="$2" out="$3"
  rsvg-convert -w "$size" -h "$size" "$PUB/$src" -o "$PUB/$out"
}

# Browser favicons + apple-touch — full-bleed favicon.svg
render favicon.svg 16  favicon-16.png
render favicon.svg 32  favicon-32.png
render favicon.svg 48  favicon-48.png
render favicon.svg 64  favicon-64.png
render favicon.svg 180 apple-touch-icon.png

# PWA maskable icons — scaled-down mark for safe area
render icon-maskable.svg 192 icon-192-maskable.png
render icon-maskable.svg 512 icon-512-maskable.png

# Compose favicon.ico from 16/32/48 PNGs.
# Pillow re-renders from a single source image, so render at 64px and let it
# downscale via the explicit sizes list — this yields a real multi-size .ico.
"$PY" - <<'PY'
from PIL import Image
src = Image.open("client/public/favicon-64.png")
src.save(
    "client/public/favicon.ico",
    format="ICO",
    sizes=[(16, 16), (32, 32), (48, 48)],
)
PY

echo "Icon generation complete."
