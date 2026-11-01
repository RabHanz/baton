#!/usr/bin/env bash
#
# Copy the Tessaya logo kit's icons for one palette into the repo: the one place the logo colour is chosen.
#
#   scripts/baton/apply-logo-kit.sh <kit dir> <palette> <dye hex>      e.g. .../kit madder '#8E1F2F'
#
# The palette folder under <kit>/app/ holds the app icon, its PNGs and the web icons. The dye is the
# web manifest's theme colour. The tray mark is one colour (white or black) and does not depend on it.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
kit="${1:?usage: apply-logo-kit.sh <kit dir> <palette> <dye hex>}"
palette="${2:?palette}"
dye="${3:?dye}"
app="$kit/app/$palette"
[ -d "$app" ] || { echo "apply-logo-kit: no $app" >&2; exit 1; }

cp "$app/tessaya-app.ico" assets/baton/t3-black-windows.ico
cp "$app/icons/tessaya-app-1024.png" assets/baton/black-macos-1024.png
cp "$app/icons/tessaya-app-1024.png" assets/baton/black-universal-1024.png
cp "$app/web/apple-touch-icon.png" assets/baton/t3-black-web-apple-touch-180.png
cp "$app/web/favicon-16.png" assets/baton/t3-black-web-favicon-16x16.png
cp "$app/web/favicon-32.png" assets/baton/t3-black-web-favicon-32x32.png
cp "$app/web/favicon.ico" assets/baton/t3-black-web-favicon.ico
cp "$kit/colour/$palette/tessaya-mark-on-paper.svg" assets/baton/logo.svg

web=apps/web/public
cp "$app/web/apple-touch-icon.png" "$web/apple-touch-icon.png"
cp "$app/web/favicon-16.png" "$web/favicon-16x16.png"
cp "$app/web/favicon-32.png" "$web/favicon-32x32.png"
cp "$app/web/favicon.ico" "$web/favicon.ico"
cp "$app/web/favicon.svg" "$web/favicon.svg"
cp "$app/web/icon-192.png" "$app/web/icon-512.png" "$app/web/maskable-512.png" "$web/"
cat > "$web/manifest.webmanifest" << JSON
{
  "id": "/",
  "name": "Tessaya",
  "short_name": "Tessaya",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "$dye",
  "theme_color": "$dye",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/maskable-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
JSON
echo "Tessaya icons applied from $palette (dye $dye)."
