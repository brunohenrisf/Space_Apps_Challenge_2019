# Painel ESP32 — protótipo de interface web

Protótipo em HTML/CSS/JS puro (sem build, sem dependências) de uma página para
acessar um ESP32 na rede local. A interface é **personalizável**: para cada
porta (GPIO) você informa qual equipamento está conectado e como ele deve ser
controlado — e aciona cada um de forma **individual**.

A paleta segue a identidade do projeto Map Trash (azul-marinho + verde).

## Como abrir

```bash
cd esp32-panel
python3 -m http.server 8000
# abra http://localhost:8000
```

Também funciona abrindo `index.html` direto no navegador — o **Modo demo** já
vem ligado, então a página simula um ESP32 e todos os controles respondem sem
hardware nenhum.

Para falar com a placa de verdade: digite o IP no campo **Endereço do ESP32**
(ex.: `192.168.0.50`), desmarque **Modo demo** e clique em **Conectar**.

## O que a interface faz

**Personalização por porta** (botão ⚙ em cada card, ou **+ Nova porta**):

| Campo | Descrição |
| --- | --- |
| Nome do equipamento | Texto livre, ex.: "Lâmpada da varanda" |
| Tipo | 17 tipos com ícone — lâmpada, fita LED, tomada, ventilador, bomba, válvula, motor, aquecedor, fechadura, portão, sirene, sensores de temperatura/umidade/luz/presença/porta, genérico |
| Ambiente | Agrupamento livre, ex.: "Cozinha" |
| GPIO | 0–39, com aviso quando o pino já está em uso, é pino de flash (6–11), é somente entrada (34–39) ou é pino de boot (0, 2, 12, 15) |
| Modo de controle | Liga/Desliga, Intensidade (PWM 0–100%), Pulso (momentâneo) ou Sensor (leitura) |
| Lógica invertida | Para módulos relé *active low* |

**Controle individual:** cada card tem seu próprio acionamento — toggle para
liga/desliga, slider de 0–100% para PWM, botão de disparo para pulso. Sensores
aparecem como leitura em tempo real.

**Extras:** busca por nome/ambiente/tipo/GPIO, ligar e desligar tudo, exportar
e importar a configuração em JSON, restaurar o padrão, registro de eventos e
resumo do dispositivo (IP, RSSI, uptime, portas ativas).

A configuração fica salva no `localStorage` do navegador, então sobrevive ao
recarregamento da página sem precisar gravar nada no ESP32.

## Contrato da API

A página consome dois endpoints. Qualquer firmware que os implemente funciona.

### `GET /api/status`

```json
{
  "device": "ESP32-DevKitC",
  "ip": "192.168.0.50",
  "rssi": -54,
  "uptime": 3821,
  "ports": { "2": 1, "4": 80, "34": 24.5 }
}
```

`ports` mapeia GPIO → valor atual (0/1 para digital, 0–100 para PWM, leitura
para sensores). O ESP32 é a fonte da verdade: a página faz *polling* a cada
4 s e reflete o que a placa reporta, o que mantém a interface correta mesmo se
um botão físico alterar o estado.

### `POST /api/port`

```json
{ "gpio": 4, "mode": "dimmer", "value": 80, "inverted": false, "pulse": 500 }
```

- `mode`: `switch` | `dimmer` | `pulse` | `sensor`
- `value`: `0/1` em `switch`, `0–100` em `dimmer`
- `inverted`: inverte o nível de saída (relé *active low*)
- `pulse`: duração em ms, usado só em `mode: "pulse"`

Resposta: `{ "ok": true, "gpio": 4, "value": 80 }`

## Firmware de exemplo

`firmware/esp32_panel/esp32_panel.ino` implementa os dois endpoints (com CORS),
trata lógica invertida, PWM via LEDC e pulso, e serve a própria interface a
partir do LittleFS.

1. Ajuste `WIFI_SSID`, `WIFI_PASS` e as listas `OUTPUT_PINS` / `INPUT_PINS`.
2. Instale a biblioteca **ArduinoJson** (v6) e o suporte à placa esp32.
3. Copie `index.html`, `css/` e `js/` para uma pasta `data/` ao lado do sketch
   e faça o upload do LittleFS.
4. Grave o sketch e acesse o IP mostrado no Monitor Serial.

Se preferir hospedar a página fora do ESP32, mantenha o CORS habilitado no
firmware — é o que permite o navegador chamar a placa a partir de outra origem.

## Estrutura

```
esp32-panel/
├── index.html
├── css/style.css
├── js/app.js
├── firmware/esp32_panel/esp32_panel.ino
└── README.md
```

## Limitações do protótipo

- Sem autenticação: pensado para rede local confiável.
- HTTP puro. Uma página servida por HTTPS bloqueia chamadas ao ESP32 em HTTP
  (*mixed content*) — abra o painel por HTTP ou sirva-o pelo próprio ESP32.
- O polling é HTTP simples; para muitos dispositivos, WebSocket seria melhor.
