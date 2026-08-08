/* Copie este arquivo para config.h e preencha com os dados da casa.
 * config.h está no .gitignore — as credenciais do cliente não sobem
 * para repositório nenhum. */

#pragma once

#define FW_VERSAO   "1.0.0"

/* ── Wi-Fi da casa ───────────────────────────────────────────────── */
#define WIFI_SSID   "nome-da-rede"
#define WIFI_PASS   "senha-da-rede"

/* Nome mDNS: o painel responde em http://nexo.local */
#define MDNS_NOME   "nexo"

/* ── Broker MQTT (normalmente o mesmo host do Zigbee2MQTT) ───────── */
#define MQTT_HOST       "192.168.0.30"
#define MQTT_PORT       1883
#define MQTT_USER       "nexo"
#define MQTT_PASS       "troque-esta-senha"
#define MQTT_CLIENT_ID  "nexo-painel"

/* Prefixo dos tópicos do Zigbee2MQTT. Só mude se você mudou o
 * mqtt.base_topic no configuration.yaml do hub. */
#define MQTT_BASE       "zigbee2mqtt"

/* ── Código de acesso ao painel ──────────────────────────────────── */
/* Quatro dígitos, conferidos no firmware. Não é segredo criptográfico:
 * serve para impedir que a visita mexa nas luzes, não para conter um
 * atacante já dentro da rede. A defesa de verdade é a rede em si —
 * VLAN separada, sem exposição para a internet. */
#define PIN_PAINEL  "1234"
