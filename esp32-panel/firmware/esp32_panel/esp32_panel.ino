/*
 * esp32_panel.ino — firmware de exemplo para o protótipo "Painel ESP32".
 *
 * Serve a interface (index.html, css/, js/) a partir do LittleFS e expõe a
 * API HTTP consumida pela página:
 *
 *   GET  /api/status                -> estado do dispositivo e de todos os pinos
 *   POST /api/port  {json}          -> aciona um pino individualmente
 *
 * Dependências (Gerenciador de Bibliotecas do Arduino IDE):
 *   - ArduinoJson (v6)
 *   - Suporte à placa esp32 (Espressif Systems)
 *   - Plugin de upload do LittleFS, para enviar a pasta data/
 *
 * Para publicar a interface: copie index.html, css/ e js/ para uma pasta
 * "data/" ao lado deste sketch e faça o upload do sistema de arquivos.
 */

#include <WiFi.h>
#include <WebServer.h>
#include <LittleFS.h>
#include <ArduinoJson.h>

// ---------------------------------------------------------------- Wi-Fi

const char* WIFI_SSID = "SUA_REDE";
const char* WIFI_PASS = "SUA_SENHA";

WebServer server(80);

// ------------------------------------------------------------- pinagem
// Liste aqui os GPIOs que a interface pode comandar. Pinos de saída
// recebem pinMode(OUTPUT); pinos 34–39 são apenas entrada (sensores).

const int OUTPUT_PINS[] = { 2, 4, 5, 18, 19, 21, 22, 23, 25, 26, 27 };
const int INPUT_PINS[]  = { 34, 35, 36, 39 };

const size_t N_OUT = sizeof(OUTPUT_PINS) / sizeof(OUTPUT_PINS[0]);
const size_t N_IN  = sizeof(INPUT_PINS)  / sizeof(INPUT_PINS[0]);

// Último valor lógico enviado pela interface (0–1 ou 0–100), por GPIO.
int portValue[40] = { 0 };

// Canal de LEDC (PWM) associado a cada GPIO, ou -1 se ainda não alocado.
int pwmChannel[40];
int nextChannel = 0;

const int PWM_FREQ = 5000;
const int PWM_BITS = 8;

// ------------------------------------------------------------- helpers

void sendCors() {
  // A página pode ser aberta de outra origem (arquivo local, outro host).
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  server.sendHeader("Access-Control-Allow-Headers", "Content-Type");
}

bool isOutputPin(int gpio) {
  for (size_t i = 0; i < N_OUT; i++) if (OUTPUT_PINS[i] == gpio) return true;
  return false;
}

int channelFor(int gpio) {
  if (pwmChannel[gpio] < 0) {
    pwmChannel[gpio] = nextChannel++;
    ledcSetup(pwmChannel[gpio], PWM_FREQ, PWM_BITS);
    ledcAttachPin(gpio, pwmChannel[gpio]);
  }
  return pwmChannel[gpio];
}

void detachPwm(int gpio) {
  if (pwmChannel[gpio] >= 0) {
    ledcDetachPin(gpio);
    pwmChannel[gpio] = -1;
  }
}

// Escreve um nível digital respeitando a lógica invertida (relé active low).
void writeDigital(int gpio, bool on, bool inverted) {
  detachPwm(gpio);
  pinMode(gpio, OUTPUT);
  digitalWrite(gpio, inverted ? !on : on);
}

// Escreve 0–100% via PWM, também respeitando a lógica invertida.
void writePwm(int gpio, int percent, bool inverted) {
  percent = constrain(percent, 0, 100);
  int duty = map(percent, 0, 100, 0, (1 << PWM_BITS) - 1);
  if (inverted) duty = ((1 << PWM_BITS) - 1) - duty;
  ledcWrite(channelFor(gpio), duty);
}

// ------------------------------------------------------------ endpoints

void handleStatus() {
  StaticJsonDocument<1024> doc;
  doc["device"] = "ESP32-DevKitC";
  doc["ip"]     = WiFi.localIP().toString();
  doc["rssi"]   = WiFi.RSSI();
  doc["uptime"] = millis() / 1000;

  JsonObject ports = doc.createNestedObject("ports");
  for (size_t i = 0; i < N_OUT; i++) {
    ports[String(OUTPUT_PINS[i])] = portValue[OUTPUT_PINS[i]];
  }
  for (size_t i = 0; i < N_IN; i++) {
    // Ajuste conforme o sensor: aqui vai a leitura bruta do ADC.
    ports[String(INPUT_PINS[i])] = analogRead(INPUT_PINS[i]);
  }

  String out;
  serializeJson(doc, out);
  sendCors();
  server.send(200, "application/json", out);
}

void handlePort() {
  StaticJsonDocument<256> body;
  if (deserializeJson(body, server.arg("plain"))) {
    sendCors();
    server.send(400, "application/json", "{\"ok\":false,\"error\":\"json invalido\"}");
    return;
  }

  int  gpio     = body["gpio"] | -1;
  int  value    = body["value"] | 0;
  bool inverted = body["inverted"] | false;
  int  pulseMs  = body["pulse"] | 500;
  String mode   = body["mode"] | "switch";

  if (gpio < 0 || !isOutputPin(gpio)) {
    sendCors();
    server.send(400, "application/json", "{\"ok\":false,\"error\":\"gpio nao permitido\"}");
    return;
  }

  if (mode == "dimmer") {
    writePwm(gpio, value, inverted);
    portValue[gpio] = constrain(value, 0, 100);
  } else if (mode == "pulse") {
    writeDigital(gpio, true, inverted);
    delay(constrain(pulseMs, 50, 10000));
    writeDigital(gpio, false, inverted);
    portValue[gpio] = 0;
  } else {
    writeDigital(gpio, value > 0, inverted);
    portValue[gpio] = value > 0 ? 1 : 0;
  }

  StaticJsonDocument<128> res;
  res["ok"]    = true;
  res["gpio"]  = gpio;
  res["value"] = portValue[gpio];

  String out;
  serializeJson(res, out);
  sendCors();
  server.send(200, "application/json", out);
}

void handleOptions() {
  sendCors();
  server.send(204);
}

// ----------------------------------------------------------------- setup

void setup() {
  Serial.begin(115200);

  for (int i = 0; i < 40; i++) pwmChannel[i] = -1;

  for (size_t i = 0; i < N_OUT; i++) {
    pinMode(OUTPUT_PINS[i], OUTPUT);
    digitalWrite(OUTPUT_PINS[i], LOW);
  }

  if (!LittleFS.begin(true)) {
    Serial.println("Falha ao montar o LittleFS");
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Conectando ao Wi-Fi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print('.');
  }
  Serial.printf("\nPainel disponivel em http://%s/\n", WiFi.localIP().toString().c_str());

  server.on("/api/status", HTTP_GET,     handleStatus);
  server.on("/api/port",   HTTP_POST,    handlePort);
  server.on("/api/port",   HTTP_OPTIONS, handleOptions);

  // Interface estática a partir do LittleFS.
  server.serveStatic("/", LittleFS, "/").setDefaultFile("index.html");

  server.begin();
}

void loop() {
  server.handleClient();
}
