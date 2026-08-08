#!/usr/bin/env bash
# Instalador da central Nexo num Raspberry Pi com Docker.
#
#   git clone <repo> nexo && cd nexo && ./instalar.sh
#
# O que ele faz, nesta ordem:
#   1. confere Docker + plugin compose (e diz como instalar se faltar)
#   2. encontra o dongle Zigbee em /dev/serial/by-id e deduz o driver
#   3. escreve o .env da casa (só na primeira vez — nunca sobrescreve)
#   4. sugere o hostname "nexo" para o app abrir em http://nexo.local
#   5. sobe a pilha com build local (multi-arch: funciona em arm64 e amd64)
#
# Idempotente: rodar de novo só atualiza e religa o que mudou.

set -euo pipefail
cd "$(dirname "$0")"

azul()    { printf '\033[1;34m%s\033[0m\n' "$*"; }
alerta()  { printf '\033[1;33m%s\033[0m\n' "$*"; }
erro()    { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

azul "── Nexo · instalador da central ─────────────────────────────"

# 1 ── Docker ────────────────────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  erro "Docker não encontrado."
  echo  "  Instale com:  curl -fsSL https://get.docker.com | sh"
  echo  "  Depois:       sudo usermod -aG docker \$USER && newgrp docker"
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  erro "Plugin 'docker compose' não encontrado (Docker muito antigo?)."
  echo  "  No Raspberry Pi OS: sudo apt-get install docker-compose-plugin"
  exit 1
fi

# 2 ── Dongle Zigbee ────────────────────────────────────────────────
SERIAL=""
ADAPTADOR="ember"
if compgen -G "/dev/serial/by-id/*" >/dev/null 2>&1; then
  # Um dongle é o caso normal; com mais de um, o primeiro leva e avisamos.
  SERIAL=$(ls -1 /dev/serial/by-id/ | head -n1)
  QTD=$(ls -1 /dev/serial/by-id/ | wc -l)
  [ "$QTD" -gt 1 ] && alerta "Vários dispositivos seriais; usando o primeiro. Ajuste NEXO_SERIAL no .env se for o errado."
  case "$SERIAL" in
    *SONOFF*V2*|*ZBDongle-E*|*Silicon_Labs*) ADAPTADOR="ember"  ;;
    *CC2652*|*ZBDongle-P*|*Texas*)           ADAPTADOR="zstack" ;;
    *) alerta "Não reconheci o modelo do dongle; assumindo 'ember'. Confira NEXO_SERIAL_ADAPTADOR no .env." ;;
  esac
  azul "Dongle: $SERIAL  (driver $ADAPTADOR)"
else
  alerta "Nenhum dongle em /dev/serial/by-id — subo a central SEM o rádio Zigbee."
  echo   "  Quando espetar o dongle, rode ./instalar.sh de novo: ele completa a pilha."
  alerta "Lembrete de ouro: use o CABO EXTENSOR USB 2.0. Dongle na traseira do Pi, colado no SSD, é malha que falha (docs/hardware.md)."
fi

# 3 ── .env da casa ─────────────────────────────────────────────────
if [ ! -f .env ]; then
  cp .env.example .env
  [ -n "$SERIAL" ] && sed -i "s|^NEXO_SERIAL=.*|NEXO_SERIAL=/dev/serial/by-id/$SERIAL|" .env
  sed -i "s|^NEXO_SERIAL_ADAPTADOR=.*|NEXO_SERIAL_ADAPTADOR=$ADAPTADOR|" .env
  azul ".env criado. Revise TZ e NEXO_CANAL antes de entregar a casa."
else
  # Reexecução depois de espetar o dongle: se o NEXO_SERIAL gravado não
  # existe no sistema e um rádio real apareceu, atualiza — é o fluxo de
  # quem instalou primeiro e conectou o dongle depois.
  ATUAL=$(grep -E '^NEXO_SERIAL=' .env | head -n1 | cut -d= -f2- || true)
  if [ -n "$SERIAL" ] && [ ! -e "$ATUAL" ]; then
    sed -i "s|^NEXO_SERIAL=.*|NEXO_SERIAL=/dev/serial/by-id/$SERIAL|" .env
    sed -i "s|^NEXO_SERIAL_ADAPTADOR=.*|NEXO_SERIAL_ADAPTADOR=$ADAPTADOR|" .env
    azul ".env atualizado com o dongle recém-detectado."
  else
    azul ".env já existe — mantido como está."
  fi
fi

# 4 ── hostname nexo.local ──────────────────────────────────────────
if [ "$(hostname)" != "nexo" ]; then
  alerta "Hostname atual: $(hostname). Com o hostname 'nexo', o app abre em http://nexo.local sem configurar nada:"
  echo   "    sudo hostnamectl set-hostname nexo && sudo systemctl restart avahi-daemon"
fi

# 5 ── Sobe a pilha ─────────────────────────────────────────────────
# No Raspberry Pi OS padrão o controlador de memória vem desligado e o
# mem_limit do compose é descartado em silêncio. Nada quebra — mas o teto
# de RAM só passa a valer depois de habilitar o cgroup e reiniciar.
if ! grep -qE '^memory\s+[0-9]+\s+[0-9]+\s+1' /proc/cgroups 2>/dev/null; then
  alerta "cgroup de memória desligado — o teto de RAM (mem_limit) será ignorado."
  echo   "  Para valer: acrescente ao FINAL da linha única de /boot/firmware/cmdline.txt:"
  echo   "      cgroup_enable=memory cgroup_memory=1"
  echo   "  e reinicie o Pi. A pilha funciona sem isso; só fica sem o teto."
fi

azul "Construindo e subindo a pilha (a primeira vez leva alguns minutos)…"
if [ -n "$SERIAL" ]; then
  docker compose up -d --build
else
  # Sem dongle, o mapeamento de /dev falharia na CRIAÇÃO do contêiner do
  # Zigbee2MQTT e derrubaria o script inteiro. Sobe o resto da pilha; o
  # rádio entra quando o dongle chegar.
  docker compose up -d --build mosquitto nexo caddy
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
azul "── Pronto ───────────────────────────────────────────────────"
echo "  Acesse:   http://nexo.local   ou   http://${IP:-<ip-do-pi>}"
echo "  1º acesso cria a conta do dono; os demais entram por convite."
if [ -z "$SERIAL" ]; then
  echo "  Zigbee:   parado (sem dongle). Espete o rádio e rode ./instalar.sh de novo."
fi
echo "  Saúde:    curl http://127.0.0.1/api/v1/health"
echo "  Logs:     docker compose logs -f nexo"
