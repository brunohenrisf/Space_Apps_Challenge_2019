/* Copie este arquivo para config.h e preencha com os dados da casa.
 * config.h está no .gitignore — as credenciais do cliente não sobem
 * para repositório nenhum. */

#pragma once

#define FW_VERSAO   "1.0.0"

/* ── Identidade da ponte ─────────────────────────────────────────── */
/* O id vira o tópico (nexo/pontes/<id>/…) e a identidade do aparelho
 * na central — depois de instalado, NÃO mude, ou o portão vira um
 * aparelho novo e perde histórico e automações. Minúsculas, sem espaço. */
#define PONTE_ID      "portao"
#define PONTE_NOME    "Portão da garagem"
/* Uma das áreas do casa/casa.json (sala, cozinha, suite, escrit,
 * varanda, entrada). O instalador pode trocar depois pelo casa.json,
 * sem reflashar. */
#define PONTE_AREA    "entrada"

/* ── Wi-Fi da casa ───────────────────────────────────────────────── */
#define WIFI_SSID   "nome-da-rede"
#define WIFI_PASS   "senha-da-rede"

/* ── Broker da central ───────────────────────────────────────────── */
/* O IP do Raspberry Pi (o mesmo da reserva DHCP do guia de instalação)
 * e a porta do LISTENER DAS PONTES — 1884, o que exige senha. A 1883 só
 * existe dentro do Docker; veja docs/pontes-mqtt.md para habilitar a
 * 1884 e criar esta credencial. */
#define MQTT_HOST   "192.168.0.30"
#define MQTT_PORT   1884
#define MQTT_USER   "ponte-portao"
#define MQTT_PASS   "troque-esta-senha"

/* ── Canais ──────────────────────────────────────────────────────── */
/* Cada linha vira um controle ou um sensor no app, sem tocar em nada
 * do lado da central: o announce apresenta tudo.
 *
 * Relés   — pulsoMs > 0: fecha o contato e solta sozinho (portão de
 *           garagem quer um toque, não um interruptor). pulsoMs = 0:
 *           liga/desliga comum. nivelAtivo: HIGH para módulo de relé
 *           que fecha em nível alto, LOW para os opto-isolados comuns.
 * Contatos— tipo é a medida do contrato: "contact", "occupancy",
 *           "water_leak", "smoke", "gas", "vibration", "tamper".
 *           Com INPUT_PULLUP e reed fechando para o GND, circuito
 *           aberto = HIGH = ativo (porta aberta). invertido inverte,
 *           para sensor NA/NF ao contrário.
 * Botões  — borda de descida publica um evento (campainha, botão de
 *           cena). Nada fica "aceso": evento é stateless.
 * Dimmers — PWM LEDC no pino (0–100% → duty). Para 0–10 V de verdade,
 *           use um módulo conversor PWM→0-10V (custa uns R$ 15).
 */

struct CanalRele    { const char* id; const char* nome; uint8_t pino; uint16_t pulsoMs; uint8_t nivelAtivo; };
struct CanalContato { const char* id; const char* nome; const char* tipo; uint8_t pino; bool invertido; };
struct CanalBotao   { const char* id; uint8_t pino; };
struct CanalDimmer  { const char* id; const char* nome; uint8_t pino; };

static const CanalRele RELES[] = {
  { "rele", "Portão", 26, 800, HIGH },
};

static const CanalContato CONTATOS[] = {
  { "aberto", "Folha do portão", "contact", 27, false },
};

static const CanalBotao BOTOES[] = {
  { "campainha", 32 },
};

static const CanalDimmer DIMMERS[] = {
  /* { "jardim", "Luz do jardim", 25 }, */
};
