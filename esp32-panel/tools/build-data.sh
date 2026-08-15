#!/usr/bin/env bash
#
# Monta a pasta data/ que o plugin do LittleFS envia para o ESP32.
#
#   ./tools/build-data.sh            # copia os arquivos da PWA
#   ./tools/build-data.sh --no-splash # sem as telas de abertura (~310 KB a menos)
#
# Depois: Arduino IDE > Ferramentas > "ESP32 Sketch Data Upload"
# (ou: pio run -t uploadfs, no PlatformIO)

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA="$ROOT/firmware/esp32_panel/data"

rm -rf "$DATA"
mkdir -p "$DATA/css" "$DATA/js" "$DATA/icons"

cp "$ROOT/index.html"            "$DATA/"
cp "$ROOT/manifest.webmanifest"  "$DATA/"
cp "$ROOT/sw.js"                 "$DATA/"
cp "$ROOT/css/style.css"         "$DATA/css/"
cp "$ROOT/js/app.js"             "$DATA/js/"
cp "$ROOT/icons/icon.svg" "$ROOT/icons/icon-180.png" \
   "$ROOT/icons/icon-192.png" "$ROOT/icons/icon-512.png" \
   "$ROOT/icons/icon-512-maskable.png" "$DATA/icons/"

if [ "${1:-}" != "--no-splash" ]; then
  mkdir -p "$DATA/icons/splash"
  cp "$ROOT"/icons/splash/*.png "$DATA/icons/splash/"
fi

TOTAL=$(du -sk "$DATA" | cut -f1)
echo "data/ pronta em: $DATA"
echo "Total: ${TOTAL} KB — confira se cabe na partição SPIFFS/LittleFS da placa."
echo "Em seguida, use o upload do sistema de arquivos da sua IDE."
