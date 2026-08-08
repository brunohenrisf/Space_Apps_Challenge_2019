# Centralizar no Raspberry Pi

Sim, e é a topologia que eu levaria para produção. Este documento diz o
que muda, o que se ganha, o que se perde, e como instalar.

## O que muda

**Na interface: nada.** Zero linhas. O contrato REST/WebSocket foi feito
justamente para isso — o aplicativo fala com "o painel" e nunca soube que
existia um ESP32 do outro lado. Trocar quem responde é trocar o servidor,
não o cliente.

**No painel: `server/nexo.mjs` no lugar de `nexo-panel.ino`.** Mesmas
rotas, mesmas mensagens, mesma tradução Zigbee. E mais coisa, porque o Pi
aguenta.

```
ANTES                                  DEPOIS
┌────────┐                             ┌────────┐
│ iPhone │                             │ iPhone │
└───┬────┘                             └───┬────┘
    │ HTTP + WS                            │ HTTPS + WSS
┌───▼─────────────┐                    ┌───▼──────────────────────┐
│ ESP32 + cartão  │                    │ Raspberry Pi             │
│ interface       │                    │  Caddy (TLS)             │
│ estado em RAM   │                    │  nexo.mjs (interface,    │
└───┬─────────────┘                    │   rotinas, aprendiz)     │
    │ MQTT                             │  Zigbee2MQTT             │
┌───▼─────────────┐                    │  histórico em disco      │
│ Raspberry Pi    │                    └───┬──────────────────────┘
│  Zigbee2MQTT    │                        │ Zigbee 3.0
└───┬─────────────┘                    ┌───▼─────┐
    │ Zigbee 3.0                       │ malha   │
┌───▼─────┐                            └─────────┘
│ malha   │
└─────────┘
```

## O que se ganha

**O problema do PWA no iOS morre.** Este é o maior ganho, disparado. O Pi
termina TLS com um certificado de verdade, e o Safari passa a dar contexto
seguro: Service Worker, cache offline e — o que realmente importa —
**Web Push a partir do iOS 16.4**. Alerta de vazamento, porta aberta e
bateria acabando chegam no telefone. O ESP32 nunca teria isso na prática.

**O aprendiz passa a ser possível.** A aposta do produto
([docs/produto.md](produto.md)) precisa de meses de histórico e de um
relógio confiável. No ESP32 era RAM apertada, desgaste de cartão e nenhuma
hora certa. No Pi é um arquivo JSONL e NTP. **Foi isto que destravou o
`server/lib/aprendiz.mjs`.**

**Rotina por horário funciona.** Sem RTC, o ESP32 não sabia a hora.

**Um salto a menos.** Antes: telefone → ESP32 → MQTT → Z2M → Zigbee.
Agora: telefone → Pi → Zigbee. Um ponto de falha a menos.

**Backup e restauração viram `tar`.** Configuração de casa presa num
cartão SD dentro de um ESP32 é um pesadelo de suporte.

**Dezenas de telefones em vez de meia dúzia.** O `ESPAsyncWebServer`
atende uns 4 a 6 WebSockets; o Node atende centenas.

## O que se perde, e o que fazer a respeito

**O cartão SD do Pi corrompe.** É o risco real, e no Brasil ele é maior
por causa da qualidade da energia. O ESP32 ligava e rodava por anos. Faça
as três coisas:

- `log2ram` para tirar o journal do cartão;
- boot em SSD por USB, ou um CM4 com eMMC — resolve de vez, e custa pouco
  perto de uma visita técnica;
- nobreak pequeno. Um Pi consome ~5 W: um nobreak de entrada segura horas.

**Boot de 30 s em vez de 2 s.** Depois de uma queda de energia, a casa
fica sem painel por meio minuto. As lâmpadas e interruptores Zigbee
continuam funcionando nesse intervalo — a malha não depende do painel.
Vale explicar isso ao cliente antes que ele descubra sozinho.

**O painel de parede sai do lugar.** Se um dia entrar um display na
parede, ele deixa de ser o servidor e vira cliente: um ESP32 com tela
abrindo a mesma interface. É mais simples do que era, não menos.

## Como eu dividiria os papéis

| | Raspberry Pi | ESP32 |
|---|---|---|
| Zigbee2MQTT e coordenador | ✔ | |
| Interface e API | ✔ | |
| Histórico, aprendiz, rotinas | ✔ | |
| TLS | ✔ | |
| Painel de parede com display | | ✔ (cliente) |
| Relé, dimmer 0–10 V, sensor com fio | | ✔ (ponte de E/S) |

O ESP32 não sai do projeto — ele deixa de ser o cérebro e vira periférico,
que é o que ele faz bem. O firmware continua em `firmware/` para quem
quiser a topologia enxuta, sem Pi.

## Instalação

```bash
# 1. Código e dependências
sudo mkdir -p /opt/nexo && sudo chown $USER /opt/nexo
git clone <repo> /opt/nexo && cd /opt/nexo
npm --prefix server install --omit=dev        # só mqtt e ws, nada compila

# 2. Configuração
sudo mkdir -p /etc/nexo
sudo cp server/config.example.json /etc/nexo/config.json
sudo nano /etc/nexo/config.json               # broker, senha, PIN, tarifa
sudo sed -i 's|"./server/dados"|"/var/lib/nexo"|' /etc/nexo/config.json

# 3. Catálogo da casa
nano casa/devices.json                        # 'z2m' = friendly_name no Z2M
nano casa/routines.json

# 4. Interface pré-comprimida (o Node serve o .gz e poupa o cartão)
node tools/build.mjs && cp -r dist/sd/* app/

# 5. Serviço
sudo useradd --system --home /var/lib/nexo --create-home nexo
sudo chown -R nexo:nexo /var/lib/nexo
sudo cp server/deploy/nexo.service /etc/systemd/system/
sudo systemctl enable --now nexo
journalctl -u nexo -f

# 6. TLS — leia os comentários do arquivo antes
sudo cp server/deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## Verificar que está de pé

```bash
curl -s localhost:8080/api/state | head -c 400     # fotografia da casa
journalctl -u nexo | grep aprendiz                 # eventos e sugestões
ls -la /var/lib/nexo/historico/                    # um .jsonl por mês
```

Para ver o aprendiz trabalhando antes de a casa ter histórico:

```bash
node server/ferramentas/semear.mjs
```

Semeia 30 dias sintéticos com três padrões plantados e ruído por cima, e
confere que o motor acha os três sem inventar um quarto.

## Sobre os dados

O histórico é JSONL, um arquivo por mês, em `/var/lib/nexo/historico/`.
Não é banco por escolha: uma casa movimentada gera ~200 eventos por dia, um
ano cabe em 7 MB, e a ausência de dependência nativa é o que faz a
instalação num Pi de cliente não travar em compilação. Dá para depurar com
`tail` num chamado às 22h, e o backup é `tar`. Se um dia virar prédio,
SQLite entra sem que nada fora de `lib/historico.mjs` mude.

Nada disso sai da casa.
