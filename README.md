# Nexo

Painel de automação residencial que roda na rede da casa e em mais lugar
nenhum. A interface é servida pelo cartão SD de um ESP32, o ESP32 conversa
com o hub Zigbee, e o cliente instala o app no iPhone pela tela de início.
Sem conta, sem nuvem, sem depender da operadora.

![Início, ficha do dispositivo e energia](docs/telas.png)

## Ver funcionando agora

```bash
node tools/make-icons.mjs      # gera os ícones PNG
cd app && python3 -m http.server 8000
```

Abra `http://localhost:8000`, código **1234**. Sem ESP32 alcançável o app
cai num simulador com 19 dispositivos, latência de rádio de verdade e um
nó de sinal fraco que às vezes não responde — dá para sentir como a
interface se comporta quando a malha falha, que é o que separa um painel
de automação de uma tela bonita.

Arraste a coluna de brilho na ficha de um dispositivo. É o gesto central
do app.

## O que tem aqui

```
app/                interface (documento único, 21 KB gzipado)
  index.html        HTML, CSS e JS juntos — ver "por que um arquivo só"
  manifest.webmanifest
  sw.js             cache da casca, só em contexto seguro
  icons/            gerados por código, não versionados à mão
sdcard/             configuração da casa, vai na raiz do cartão
  devices.json      catálogo: id, friendly_name do Z2M, cômodo, recursos
  scenes.json       cenas, no vocabulário do Zigbee
firmware/nexo-panel/
  nexo-panel.ino    ESP32: serve o SD, ponte MQTT, WebSocket
  config.example.h  copie para config.h e preencha
tools/
  build.mjs         gzipa e monta dist/sd/ para o cartão
  make-icons.mjs    gera os PNG (codifica o PNG na mão, sem dependências)
docs/
  arquitetura.md    contratos, tradução Zigbee, decisões, limites
  ios-pwa.md        o requisito de HTTPS do iOS e as quatro saídas
```

## Instalar numa casa

1. **Preparar o cartão**

   ```bash
   node tools/make-icons.mjs
   node tools/build.mjs
   cp -r dist/sd/* /Volumes/CARTAO/
   ```

   Ajuste `devices.json` para os dispositivos daquela casa. O campo `z2m`
   precisa bater exatamente com o `friendly_name` no Zigbee2MQTT.

2. **Gravar o firmware**

   ```bash
   cp firmware/nexo-panel/config.example.h firmware/nexo-panel/config.h
   # preencha Wi-Fi, broker MQTT e o código do painel
   ```

   Arduino IDE, placa ESP32 Dev Module. Bibliotecas: ESPAsyncWebServer,
   AsyncTCP, PubSubClient, ArduinoJson 7.

3. **Instalar no iPhone**

   Safari em `http://nexo.local` → Compartilhar → Adicionar à Tela de
   Início. **Antes disso, leia [docs/ios-pwa.md](docs/ios-pwa.md)** — a
   decisão de HTTPS muda o que o app consegue fazer, e é melhor tomá-la
   antes de entregar.

## Duas decisões que valem explicar

**Por que um arquivo só.** O servidor web do ESP32 atende poucas conexões
simultâneas. Doze arquivos viram doze idas e voltas disputando as mesmas
conexões; um documento de 21 KB gzipado vira uma. A interface inteira chega
antes de o primeiro arquivo do segundo cenário terminar de negociar.

**Por que a configuração fica em JSON no cartão, e não compilada.**
Renomear um cômodo ou trocar uma lâmpada não pode exigir levar um notebook
com o Arduino IDE até a casa do cliente. Editar um arquivo de texto no
cartão e reiniciar resolve — a diferença entre uma visita de dez minutos e
uma de duas horas.

## O desenho

A paleta é literal: o app manipula luz, então o fundo é um cômodo apagado
(`#100E0C`, neutro puxado para o quente) e o acento é âmbar incandescente
(`#F6A93B`) querendo dizer uma coisa só — *aceso*. O eixo âmbar↔azul da
faixa de temperatura de cor é dado, não enfeite. O tema claro é o mesmo
cômodo com a luz acesa.

Sem webfont: o alvo é iPhone, e a SF Pro é a voz nativa da plataforma —
custa zero byte no cartão, o que importa. O caráter vem dos papéis
tipográficos: leituras em peso 200 com numerais tabulares (voz de painel de
instrumento), rótulos em caixa alta com tracking largo, monoespaçado para
endereço IEEE, LQI e IP.

## Estado

A interface está completa e testada nos dois temas. O firmware é um
esqueleto funcional: serve o cartão, faz a ponte MQTT e transmite estado.
Falta, para virar produto: validação do PIN no firmware (hoje o app aceita
qualquer código quando fala com um painel real), OTA, e RTC para as rotinas
por horário. Os limites conhecidos estão em
[docs/arquitetura.md](docs/arquitetura.md#limites-conhecidos).

---

O histórico anterior deste repositório é o *Map Trash*, do NASA Space Apps
Challenge 2019, sem relação com este projeto.
