/* ─────────────────────────────────────────────────────────────────────
 * NEXO — painel de automação residencial
 * ESP32 + cartão SD, ponte entre o iPhone e o hub Zigbee.
 *
 * O que este firmware faz:
 *   1. Serve a interface (index.html.gz e companhia) direto do cartão SD.
 *   2. Mantém o estado dos dispositivos em RAM e empurra mudanças para
 *      os telefones conectados por WebSocket.
 *   3. Conversa com o Zigbee2MQTT do hub por MQTT.
 *
 * O que ele NÃO faz, de propósito: falar com a internet. Não há cliente
 * de nuvem, não há NTP obrigatório, não há telemetria. Se o link da
 * operadora cair, a casa continua inteira.
 *
 * Dependências (Gerenciador de Bibliotecas do Arduino IDE):
 *   ESPAsyncWebServer · AsyncTCP · PubSubClient · ArduinoJson 7
 *
 * Placa: ESP32 Dev Module. Esquema de partição com SPIFFS pequeno —
 * a interface mora no SD, não na flash interna.
 * ───────────────────────────────────────────────────────────────────── */

#include <WiFi.h>
#include <ESPmDNS.h>
#include <SD.h>
#include <SPI.h>
#include <ESPAsyncWebServer.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>

#include "config.h"

/* ── Pinos do cartão SD (VSPI) ──────────────────────────────────── */
static const int SD_CS = 5, SD_SCK = 18, SD_MISO = 19, SD_MOSI = 23;

AsyncWebServer servidor(80);
AsyncWebSocket  ws("/ws");
WiFiClient      wifiMqtt;
PubSubClient    mqtt(wifiMqtt);

// O Arduino IDE gera protótipos sozinho, mas quem compilar com
// arduino-cli ou PlatformIO precisa destes aqui.
void aplicarCena(const String& cenaId);
void aoReceberDoApp(const String& texto);

/* ─────────────────────────────────────────────────────────────────────
 * REGISTRO DE DISPOSITIVOS
 *
 * Carregado de /devices.json no cartão SD. O instalador edita um arquivo
 * de texto no cartão em vez de recompilar o firmware na casa do cliente —
 * essa é a diferença entre uma visita de 10 minutos e uma de duas horas.
 *
 * Formato de cada entrada:
 *   { "id":"sala_teto", "z2m":"Luz sala",  "nome":"Luz principal",
 *     "comodo":"sala", "tipo":"light", "caps":["onoff","dim","cct"] }
 * ───────────────────────────────────────────────────────────────────── */
static const size_t MAX_DISPOSITIVOS = 64;

struct Dispositivo {
  String id;        // identificador usado pela interface
  String z2m;       // friendly_name no Zigbee2MQTT
  JsonDocument estado;   // último estado conhecido, como veio do hub
  uint32_t visto = 0;    // millis() do último relato
};

Dispositivo dispositivos[MAX_DISPOSITIVOS];
size_t nDispositivos = 0;
JsonDocument catalogo;   // devices.json inteiro, devolvido em /api/state

Dispositivo* porId(const String& id) {
  for (size_t i = 0; i < nDispositivos; i++)
    if (dispositivos[i].id == id) return &dispositivos[i];
  return nullptr;
}

Dispositivo* porZ2M(const String& nome) {
  for (size_t i = 0; i < nDispositivos; i++)
    if (dispositivos[i].z2m == nome) return &dispositivos[i];
  return nullptr;
}

bool carregarCatalogo() {
  File f = SD.open("/devices.json");
  if (!f) { Serial.println("[sd] /devices.json não encontrado"); return false; }

  DeserializationError err = deserializeJson(catalogo, f);
  f.close();
  if (err) { Serial.printf("[sd] devices.json inválido: %s\n", err.c_str()); return false; }

  for (JsonObject d : catalogo["devices"].as<JsonArray>()) {
    if (nDispositivos >= MAX_DISPOSITIVOS) break;
    dispositivos[nDispositivos].id  = d["id"].as<String>();
    dispositivos[nDispositivos].z2m = d["z2m"].as<String>();
    nDispositivos++;
  }
  Serial.printf("[sd] %u dispositivos no catálogo\n", (unsigned)nDispositivos);
  return true;
}

/* ─────────────────────────────────────────────────────────────────────
 * WEBSOCKET — o caminho quente
 * ───────────────────────────────────────────────────────────────────── */

void transmitir(const JsonDocument& msg) {
  if (ws.count() == 0) return;
  String buf;
  serializeJson(msg, buf);
  ws.textAll(buf);
}

/** Empurra o estado de um dispositivo para todos os telefones abertos. */
void publicarEstado(const Dispositivo& d) {
  JsonDocument m;
  m["t"]  = "state";
  m["id"] = d.id;
  m["p"].set(d.estado);
  transmitir(m);
}

/** Comando vindo da interface: {"t":"set","id":"sala_teto","p":{...}} */
void aoReceberDoApp(const String& texto) {
  JsonDocument m;
  if (deserializeJson(m, texto)) return;

  const String tipo = m["t"] | "";

  if (tipo == "set") {
    Dispositivo* d = porId(m["id"].as<String>());
    if (!d) return;

    // A interface fala em % de brilho; o Zigbee fala em 0–254.
    JsonDocument fora;
    JsonObject p = m["p"].as<JsonObject>();
    if (p["on"].is<bool>())  fora["state"]      = p["on"].as<bool>() ? "ON" : "OFF";
    if (p["bri"].is<int>())  fora["brightness"] = (int)round(p["bri"].as<int>() * 2.54);
    if (p["k"].is<int>())    fora["color_temp"] = (int)(1000000L / p["k"].as<int>());  // mireds
    if (p["pos"].is<int>())  fora["position"]   = p["pos"].as<int>();
    if (p["trancado"].is<bool>()) fora["state"] = p["trancado"].as<bool>() ? "LOCK" : "UNLOCK";

    String carga;
    serializeJson(fora, carga);
    const String topico = String(MQTT_BASE) + "/" + d->z2m + "/set";
    mqtt.publish(topico.c_str(), carga.c_str());
    Serial.printf("[cmd] %s -> %s\n", topico.c_str(), carga.c_str());
  }

  else if (tipo == "scene") {
    // As cenas vivem no cartão, não no hub: uma queda do Zigbee2MQTT não
    // pode levar junto o "boa noite" da casa.
    aplicarCena(m["id"].as<String>());
  }

  else if (tipo == "pair") {
    JsonDocument req;
    req["value"] = m["s"].as<int>() > 0;
    req["time"]  = m["s"].as<int>();
    String carga; serializeJson(req, carga);
    mqtt.publish((String(MQTT_BASE) + "/bridge/request/permit_join").c_str(), carga.c_str());
  }
}

void aoEventoWS(AsyncWebSocket*, AsyncWebSocketClient* cliente,
                AwsEventType tipo, void*, uint8_t* dados, size_t tam) {
  if (tipo == WS_EVT_CONNECT) {
    Serial.printf("[ws] cliente %u conectado\n", cliente->id());
  } else if (tipo == WS_EVT_DATA) {
    String texto;
    texto.reserve(tam + 1);
    for (size_t i = 0; i < tam; i++) texto += (char)dados[i];
    aoReceberDoApp(texto);
  }
}

/* ─────────────────────────────────────────────────────────────────────
 * CENAS — lidas de /scenes.json no cartão
 * ───────────────────────────────────────────────────────────────────── */
void aplicarCena(const String& cenaId) {
  File f = SD.open("/scenes.json");
  if (!f) return;
  JsonDocument cenas;
  DeserializationError err = deserializeJson(cenas, f);
  f.close();
  if (err) return;

  for (JsonObject c : cenas["scenes"].as<JsonArray>()) {
    if (c["id"].as<String>() != cenaId) continue;

    for (JsonObject passo : c["steps"].as<JsonArray>()) {
      Dispositivo* d = porId(passo["id"].as<String>());
      if (!d) continue;
      String carga;
      serializeJson(passo["set"], carga);
      mqtt.publish((String(MQTT_BASE) + "/" + d->z2m + "/set").c_str(), carga.c_str());
      delay(35);   // não estourar a malha com um burst de 14 comandos
    }
    return;
  }
}

/* ─────────────────────────────────────────────────────────────────────
 * MQTT — a ponte com o Zigbee2MQTT
 * ───────────────────────────────────────────────────────────────────── */
void aoMensagemMqtt(char* topico, byte* carga, unsigned int tam) {
  String t(topico);
  String corpo;
  corpo.reserve(tam + 1);
  for (unsigned int i = 0; i < tam; i++) corpo += (char)carga[i];

  // zigbee2mqtt/bridge/state → "online" / "offline"
  if (t.endsWith("/bridge/state")) {
    JsonDocument m;
    m["t"] = "hub";
    m["p"]["online"] = corpo.indexOf("online") >= 0;
    transmitir(m);
    return;
  }
  if (t.startsWith(String(MQTT_BASE) + "/bridge/")) return;   // demais tópicos do bridge

  const String nome = t.substring(String(MQTT_BASE).length() + 1);
  Dispositivo* d = porZ2M(nome);
  if (!d) return;

  JsonDocument z;
  if (deserializeJson(z, corpo)) return;

  // Tradução Zigbee → vocabulário da interface.
  if (z["state"].is<const char*>()) {
    const String s = z["state"].as<String>();
    if (s == "LOCK" || s == "UNLOCK") d->estado["trancado"] = (s == "LOCK");
    else                              d->estado["on"] = (s == "ON");
  }
  if (z["brightness"].is<int>())   d->estado["bri"] = (int)round(z["brightness"].as<int>() / 2.54);
  if (z["color_temp"].is<int>())   d->estado["k"]   = (int)(1000000L / z["color_temp"].as<int>());
  if (z["position"].is<int>())     d->estado["pos"] = z["position"];
  if (z["power"].is<float>())      d->estado["w"]   = z["power"];
  if (z["energy"].is<float>())     d->estado["kwh"] = z["energy"];
  if (z["temperature"].is<float>())d->estado["t"]   = z["temperature"];
  if (z["humidity"].is<float>())   d->estado["h"]   = z["humidity"];
  if (z["occupancy"].is<bool>())   d->estado["motion"] = z["occupancy"];
  if (z["contact"].is<bool>())     d->estado["aberto"] = !z["contact"].as<bool>();
  if (z["water_leak"].is<bool>())  d->estado["leak"] = z["water_leak"];
  if (z["battery"].is<int>())      d->estado["bat"] = z["battery"];
  if (z["linkquality"].is<int>())  d->estado["lqi"] = z["linkquality"];

  d->visto = millis();
  publicarEstado(*d);
}

void reconectarMqtt() {
  static uint32_t proxima = 0;
  if (mqtt.connected() || millis() < proxima) return;
  proxima = millis() + 5000;

  Serial.print("[mqtt] conectando… ");
  if (mqtt.connect(MQTT_CLIENT_ID, MQTT_USER, MQTT_PASS)) {
    Serial.println("ok");
    mqtt.subscribe((String(MQTT_BASE) + "/+").c_str());
    mqtt.subscribe((String(MQTT_BASE) + "/bridge/state").c_str());
  } else {
    Serial.printf("falhou (rc=%d)\n", mqtt.state());
  }
}

/* ─────────────────────────────────────────────────────────────────────
 * HTTP
 * ───────────────────────────────────────────────────────────────────── */
void montarRotas() {
  /* Estado completo — é o que a interface pede ao abrir. */
  servidor.on("/api/state", HTTP_GET, [](AsyncWebServerRequest* req) {
    JsonDocument out;
    out["hub"]["online"] = mqtt.connected();
    out["painel"]["ip"]     = WiFi.localIP().toString();
    out["painel"]["rssi"]   = WiFi.RSSI();
    out["painel"]["uptime"] = millis() / 1000;
    out["painel"]["heap"]   = ESP.getFreeHeap() / 1024;
    out["painel"]["fw"]     = FW_VERSAO;

    out["rooms"].set(catalogo["rooms"]);
    out["scenes"].set(catalogo["scenes"]);

    JsonArray ds = out["devices"].to<JsonArray>();
    for (JsonObject meta : catalogo["devices"].as<JsonArray>()) {
      JsonObject o = ds.add<JsonObject>();
      o.set(meta);
      Dispositivo* d = porId(meta["id"].as<String>());
      if (d) {
        o["st"].set(d->estado);
        o["seen"] = d->visto;
      }
    }

    String buf;
    serializeJson(out, buf);
    req->send(200, "application/json", buf);
  });

  /* A interface e os ícones vêm do cartão. O handler estático já
     prefere o .gz quando existe e manda Content-Encoding sozinho. */
  servidor.serveStatic("/", SD, "/").setDefaultFile("index.html");

  servidor.onNotFound([](AsyncWebServerRequest* req) {
    req->send(404, "text/plain", "nao encontrado");
  });

  ws.onEvent(aoEventoWS);
  servidor.addHandler(&ws);
}

/* ─────────────────────────────────────────────────────────────────────
 * SETUP / LOOP
 * ───────────────────────────────────────────────────────────────────── */
void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println("\n[nexo] iniciando");

  SPI.begin(SD_SCK, SD_MISO, SD_MOSI, SD_CS);
  if (!SD.begin(SD_CS)) {
    Serial.println("[sd] cartão não montou — o painel não tem interface para servir");
  } else {
    Serial.printf("[sd] %llu MB\n", SD.cardSize() / (1024ULL * 1024ULL));
    carregarCatalogo();
  }

  WiFi.mode(WIFI_STA);
  WiFi.setSleep(false);            // latência de toque acima de economia
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("[wifi] ");
  while (WiFi.status() != WL_CONNECTED) { delay(400); Serial.print("."); }
  Serial.printf(" %s\n", WiFi.localIP().toString().c_str());

  if (MDNS.begin(MDNS_NOME)) {
    MDNS.addService("http", "tcp", 80);
    Serial.printf("[mdns] http://%s.local\n", MDNS_NOME);
  }

  mqtt.setServer(MQTT_HOST, MQTT_PORT);
  mqtt.setCallback(aoMensagemMqtt);
  mqtt.setBufferSize(2048);        // relatos do Z2M passam fácil dos 256 padrão

  montarRotas();
  servidor.begin();
  Serial.println("[http] no ar na porta 80");
}

void loop() {
  reconectarMqtt();
  mqtt.loop();
  ws.cleanupClients();

  // Zela pelos nós que pararam de reportar: um sensor a pilha que sumiu
  // há três horas não deve continuar mostrando o último valor como se
  // fosse verdade. A interface esmaece sozinha a partir de "seen".
  static uint32_t ultimoPing = 0;
  if (millis() - ultimoPing > 30000) {
    ultimoPing = millis();
    JsonDocument m;
    m["t"] = "panel";
    m["p"]["rssi"]   = WiFi.RSSI();
    m["p"]["heap"]   = ESP.getFreeHeap() / 1024;
    m["p"]["uptime"] = millis() / 1000;
    transmitir(m);
  }
}
