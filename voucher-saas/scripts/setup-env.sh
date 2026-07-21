#!/usr/bin/env bash
# Gera o .env de produção do ConectaVoucher com segredos aleatórios.
#
# Uso (na VPS, dentro de /opt/conectavoucher):
#   CV_HOST=conectavoucher.seudominio.com bash scripts/setup-env.sh
#
# CV_HOST você fornece. CV_DB_PASSWORD e EFI_WEBHOOK_TOKEN são gerados aqui.
# As credenciais da Efí e da MikroTik você preenche depois no .env.
set -euo pipefail
cd "$(dirname "$0")/.."

gen() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

HOST="${CV_HOST:-conectavoucher.seudominio.com}"
DB_PW="$(gen 24)"
WEBHOOK="$(gen 24)"

if [ -f .env ]; then
  cp .env ".env.bak.$(date +%s)"
  echo "• .env existente salvo como backup."
fi

cat > .env <<EOF
# gerado por scripts/setup-env.sh
CV_HOST=${HOST}
COURTESY_WINDOW_SECONDS=180
CV_DB_PASSWORD=${DB_PW}

# Efí (Pix) — preencha e coloque o certificado em ./certs/efi.p12
EFI_ENV=producao
EFI_CLIENT_ID=
EFI_CLIENT_SECRET=
EFI_PIX_KEY=
EFI_WEBHOOK_TOKEN=${WEBHOOK}

# MikroTik (via WireGuard)
MIKROTIK_HOST=10.20.0.2
MIKROTIK_PORT=8728
MIKROTIK_USER=api
MIKROTIK_PASSWORD=
MIKROTIK_TLS=false
MIKROTIK_HOTSPOT_PROFILE=default
EOF
chmod 600 .env

echo "✓ .env gerado (chmod 600):"
grep -v '^#' .env | grep -v '^$'
echo
echo "⚠  Falta preencher no .env: EFI_CLIENT_ID/SECRET, EFI_PIX_KEY e MIKROTIK_PASSWORD."
echo "   E colocar o certificado da Efí em ./certs/efi.p12"
