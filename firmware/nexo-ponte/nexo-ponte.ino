/* ─────────────────────────────────────────────────────────────────────
 * NEXO — ponte de E/S
 * ESP32 levando para a central o que o Zigbee não alcança: o relé do
 * portão, contato seco de alarme, campainha, um dimmer 0–10 V.
 *
 * A convenção é a de docs/pontes-mqtt.md, e o desenho inteiro cabe numa
 * frase: a ponte se APRESENTA (config retained), RELATA (estado retained,
 * LWT de disponibilidade) e OBEDECE ({ canal, valor } em /comando). A
 * central monta o aparelho no app a partir do announce — instalar um
 * canal novo é editar o config.h e reflashar a ponte; do lado do
 * Raspberry, nada.
 *
 * O que ela NÃO faz, de propósito: falar com a internet, guardar estado,
 * decidir automação. Ponte é músculo; o cérebro fica na central.
 *
 * Dependências (Gerenciador de Bibliotecas do Arduino IDE):
 *   PubSubClient · ArduinoJson 7
 *
 * Placa: qualquer ESP32 com os pinos das cargas. Sem cartão SD, sem
 * display — o binário inteiro vive na flash.
 * ───────────────────────────────────────────────────────────────────── */

#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

#include "config.h"

static const size_t N_RELES    = sizeof(RELES)    / sizeof(RELES[0]);
static const size_t N_CONTATOS = sizeof(CONTATOS) / sizeof(CONTATOS[0]);
static const size_t N_BOTOES   = sizeof(BOTOES)   / sizeof(BOTOES[0]);
static const size_t N_DIMMERS  = sizeof(DIMMERS)  / sizeof(DIMMERS[0]);

WiFiClient   wifi;
PubSubClient mqtt(wifi);

/* Estado vivo de cada canal — o espelho do que a casa enxerga. */
static bool     releLigado[N_RELES ? N_RELES : 1]       = {};
static uint32_t releDesligaEm[N_RELES ? N_RELES : 1]    = {};   // 0 = sem pulso pendente
static bool     contatoAtivo[N_CONTATOS ? N_CONTATOS : 1] = {};
static uint8_t  dimmerValor[N_DIMMERS ? N_DIMMERS : 1]  = {};

static char topico[96];
const char* T(const char* sufixo) {
  snprintf(topico, sizeof(topico), "nexo/pontes/%s/%s", PONTE_ID, sufixo);
  return topico;
}

/* ─────────────────────────────────────────────────────────────────────
 * SAÍDA — announce, estado, evento
 * ───────────────────────────────────────────────────────────────────── */

/** A apresentação: é dela que a central tira nome, área e capabilities. */
void publicarConfig() {
  JsonDocument d;
  d["nome"]       = PONTE_NOME;
  d["area"]       = PONTE_AREA;
  d["fabricante"] = "Nexo";
  d["modelo"]     = "Ponte de E/S";
  d["fw"]         = FW_VERSAO;

  JsonArray canais = d["canais"].to<JsonArray>();
  for (size_t i = 0; i < N_RELES; i++) {
    JsonObject c = canais.add<JsonObject>();
    c["id"] = RELES[i].id; c["tipo"] = "switch"; c["nome"] = RELES[i].nome;
    if (RELES[i].pulsoMs) c["pulsoMs"] = RELES[i].pulsoMs;
  }
  for (size_t i = 0; i < N_CONTATOS; i++) {
    JsonObject c = canais.add<JsonObject>();
    c["id"] = CONTATOS[i].id; c["tipo"] = CONTATOS[i].tipo; c["nome"] = CONTATOS[i].nome;
  }
  for (size_t i = 0; i < N_BOTOES; i++) {
    JsonObject c = canais.add<JsonObject>();
    c["id"] = BOTOES[i].id; c["tipo"] = "botao";
  }
  for (size_t i = 0; i < N_DIMMERS; i++) {
    JsonObject c = canais.add<JsonObject>();
    c["id"] = DIMMERS[i].id; c["tipo"] = "dimmer"; c["nome"] = DIMMERS[i].nome;
  }

  String corpo; serializeJson(d, corpo);
  if (!mqtt.publish(T("config"), corpo.c_str(), true))     // retained
    // Announce que não coube no buffer é ponte invisível — grite cedo.
    Serial.printf("[mqtt] announce de %u bytes NAO coube; aumente setBufferSize\n",
                  (unsigned)corpo.length());
}

/** O retrato completo, retained: quem chegar depois vê o agora. */
void publicarEstado() {
  JsonDocument d;
  for (size_t i = 0; i < N_RELES; i++)    d[RELES[i].id]    = releLigado[i];
  for (size_t i = 0; i < N_CONTATOS; i++) d[CONTATOS[i].id] = contatoAtivo[i];
  for (size_t i = 0; i < N_DIMMERS; i++)  d[DIMMERS[i].id]  = dimmerValor[i];
  d["rssi"] = WiFi.RSSI();

  String corpo; serializeJson(d, corpo);
  mqtt.publish(T("estado"), corpo.c_str(), true);          // retained
}

void publicarEvento(const char* canal, const char* valor) {
  JsonDocument d;
  d["canal"] = canal; d["valor"] = valor;
  String corpo; serializeJson(d, corpo);
  mqtt.publish(T("evento"), corpo.c_str(), false);         // efêmero, de propósito
}

/* ─────────────────────────────────────────────────────────────────────
 * ENTRADA — { "canal": "rele", "valor": true | 0–100 }
 * ───────────────────────────────────────────────────────────────────── */

void escreverDimmer(size_t i, uint8_t pct) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(DIMMERS[i].pino, (uint32_t)pct * 255 / 100);   // 3.x: por pino
#else
  ledcWrite(i, (uint32_t)pct * 255 / 100);                 // 2.x: por canal
#endif
}

void aplicarRele(size_t i, bool ligar) {
  releLigado[i] = ligar;
  digitalWrite(RELES[i].pino, ligar ? RELES[i].nivelAtivo : !RELES[i].nivelAtivo);
  // Pulso: fecha e solta sozinho. O estado reporta o vaivém completo,
  // então o app mostra o botão "apertar" e ele volta — como o controle
  // remoto do portão, que é o modelo mental de quem usa.
  // (0 é o sentinela de "sem pulso"; se a soma cair exatamente em 0 na
  //  volta do millis(), 1 ms de diferença é mais barato que relé preso.)
  releDesligaEm[i] = (ligar && RELES[i].pulsoMs) ? millis() + RELES[i].pulsoMs : 0;
  if (ligar && RELES[i].pulsoMs && !releDesligaEm[i]) releDesligaEm[i] = 1;
}

void aoComando(char*, byte* carga, unsigned int tam) {
  JsonDocument m;
  if (deserializeJson(m, carga, tam)) return;
  const char* canal = m["canal"] | "";

  for (size_t i = 0; i < N_RELES; i++)
    if (strcmp(canal, RELES[i].id) == 0) {
      aplicarRele(i, m["valor"].as<bool>());
      publicarEstado();
      return;
    }

  for (size_t i = 0; i < N_DIMMERS; i++)
    if (strcmp(canal, DIMMERS[i].id) == 0) {
      int v = m["valor"].as<int>();
      dimmerValor[i] = v < 0 ? 0 : v > 100 ? 100 : v;
      escreverDimmer(i, dimmerValor[i]);
      publicarEstado();
      return;
    }
  // Canal que não existe aqui: ignora. A central valida antes; isto é
  // só cinto de segurança contra config.h e casa dessincronizados.
}

/* ─────────────────────────────────────────────────────────────────────
 * CONEXÕES
 * ───────────────────────────────────────────────────────────────────── */

void conectarMqtt() {
  static uint32_t proxima = 0;
  if (mqtt.connected() || millis() < proxima) return;
  proxima = millis() + 5000;

  Serial.print("[mqtt] conectando… ");
  // LWT: se a ponte cair — energia, Wi-Fi — o broker avisa por nós, e o
  // app esmaece o portão em vez de mentir que está tudo bem.
  if (mqtt.connect(("nexo-ponte-" PONTE_ID), MQTT_USER, MQTT_PASS,
                   T("disponibilidade"), 1, true, "offline")) {
    Serial.println("ok");
    mqtt.publish(T("disponibilidade"), "online", true);
    publicarConfig();
    publicarEstado();
    mqtt.subscribe(T("comando"));
  } else {
    Serial.printf("falhou (rc=%d)\n", mqtt.state());
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[ponte] " PONTE_ID " iniciando");

  for (size_t i = 0; i < N_RELES; i++) {
    pinMode(RELES[i].pino, OUTPUT);
    digitalWrite(RELES[i].pino, !RELES[i].nivelAtivo);     // nasce desligado
  }
  for (size_t i = 0; i < N_CONTATOS; i++) pinMode(CONTATOS[i].pino, INPUT_PULLUP);
  for (size_t i = 0; i < N_BOTOES; i++)   pinMode(BOTOES[i].pino, INPUT_PULLUP);
  for (size_t i = 0; i < N_DIMMERS; i++) {
    // O core arduino-esp32 3.x trocou a API do LEDC; os dois mundos
    // compilam com este guarda.
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
    ledcAttach(DIMMERS[i].pino, 5000, 8);                  // 5 kHz, 8 bits
#else
    ledcSetup(i, 5000, 8);
    ledcAttachPin(DIMMERS[i].pino, i);
#endif
    escreverDimmer(i, 0);
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);          // o portão não pode esperar o rádio acordar
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[wifi] ");
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.printf(" %s\n", WiFi.localIP().toString().c_str());

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(aoComando);
  mqtt.setBufferSize(1024);      // o announce com vários canais passa de 256
}

void loop() {
  const uint32_t t = millis();

  /* Pulsos vencidos PRIMEIRO, antes de qualquer conversa de rede: soltar
   * o relé do portão é dever do hardware local — se o Wi-Fi caiu no meio
   * do pulso, o relé NÃO pode ficar preso fechado esperando a rede
   * voltar. (Comparação por diferença com sinal: sobrevive à volta do
   * millis() a cada 49 dias.) */
  for (size_t i = 0; i < N_RELES; i++)
    if (releDesligaEm[i] && (int32_t)(t - releDesligaEm[i]) >= 0) {
      releDesligaEm[i] = 0;
      aplicarRele(i, false);
      if (mqtt.connected()) publicarEstado();
    }

  if (WiFi.status() != WL_CONNECTED) {
    // Wi-Fi caiu: o ESP32 reconecta sozinho, mas não indefinidamente
    // bem — um empurrão a cada 15 s resolve os casos teimosos.
    static uint32_t tentou = 0;
    if (t - tentou > 15000) { tentou = t; WiFi.reconnect(); }
    delay(50);
    return;
  }
  conectarMqtt();
  mqtt.loop();

  /* Contatos: debounce de 30 ms, publica só o que mudou de verdade. */
  static uint32_t estaveisEm[N_CONTATOS ? N_CONTATOS : 1] = {};
  static bool     leituraAnterior[N_CONTATOS ? N_CONTATOS : 1] = {};
  bool mudou = false;
  for (size_t i = 0; i < N_CONTATOS; i++) {
    // Pull-up + reed para o GND: aberto = HIGH = ativo (true = aberto,
    // a semântica do contrato — sem a inversão de legado do Zigbee).
    bool ativo = digitalRead(CONTATOS[i].pino) == HIGH;
    if (CONTATOS[i].invertido) ativo = !ativo;
    if (ativo != leituraAnterior[i]) { leituraAnterior[i] = ativo;
      estaveisEm[i] = t + 30; if (!estaveisEm[i]) estaveisEm[i] = 1; }
    else if (estaveisEm[i] && t >= estaveisEm[i] && ativo != contatoAtivo[i]) {
      estaveisEm[i] = 0; contatoAtivo[i] = ativo; mudou = true;
    }
  }
  if (mudou && mqtt.connected()) publicarEstado();

  /* Botões: borda de descida com trava de 250 ms contra repique. */
  static uint32_t apertadoEm[N_BOTOES ? N_BOTOES : 1] = {};
  for (size_t i = 0; i < N_BOTOES; i++) {
    if (digitalRead(BOTOES[i].pino) == LOW && t - apertadoEm[i] > 250) {
      apertadoEm[i] = t;
      if (mqtt.connected()) publicarEvento(BOTOES[i].id, "single");
    }
  }

  /* Batimento: estado (com RSSI fresco) a cada 60 s, mesmo sem mudança —
   * é o "estou vivo" que mantém o lastSeen honesto na central. */
  static uint32_t ultimoBatimento = 0;
  if (t - ultimoBatimento > 60000 && mqtt.connected()) {
    ultimoBatimento = t;
    publicarEstado();
  }
}
