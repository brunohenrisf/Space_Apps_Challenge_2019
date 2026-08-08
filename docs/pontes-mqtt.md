# Pontes de E/S — a convenção MQTT

O Zigbee cobre lâmpada, tomada e sensor de prateleira. O que ele não
cobre é o **fio**: o relé do portão de garagem, o contato seco da
central de alarme, a campainha, um dimmer 0–10 V do trilho de LED.
Ponte é o nome que o Nexo dá a qualquer coisa que traga esses fios para
a central — o firmware de referência roda num ESP32 de R$ 40
([`firmware/nexo-ponte`](../firmware/nexo-ponte/nexo-ponte.ino)), mas a
convenção é só MQTT: um Arduino com Ethernet ou um script Python servem
igual.

O princípio é o mesmo do resto do projeto: **a central não conhece
modelos, conhece capabilities**. A ponte se apresenta dizendo o que tem;
o app desenha a partir disso. Nenhuma linha de código muda no Raspberry
quando uma ponte nova entra na casa.

## Os cinco tópicos

Tudo vive sob `nexo/pontes/<id>/…`, onde `<id>` é a identidade da ponte
(minúsculas, sem espaço — `portao`, `alarme`, `jardim`). **Depois de
instalada, o `<id>` nunca muda**: ele gera o identificador do aparelho
na central, e trocá-lo cria um aparelho novo, órfão de histórico e
automações.

| Tópico | Direção | Retained | Conteúdo |
|---|---|---|---|
| `…/config` | ponte → central | **sim** | o announce: nome, área, canais |
| `…/estado` | ponte → central | **sim** | último valor de cada canal |
| `…/evento` | ponte → central | não | botão, campainha — stateless |
| `…/comando` | central → ponte | não | `{ "canal": "...", "valor": ... }` |
| `…/disponibilidade` | ponte → central | **sim** (LWT) | `"online"` / `"offline"` |

Os retained fazem o trabalho pesado: a central pode reiniciar a qualquer
momento e reencontra o announce e o último estado no broker, sem a ponte
precisar reapresentar nada. A `disponibilidade` é o *Last Will* da
conexão MQTT — se a ponte cair (energia, Wi-Fi), o **broker** publica
`offline` por ela, e o app esmaece o portão em vez de mentir.

## O announce (`config`)

```json
{
  "nome": "Portão da garagem",
  "area": "entrada",
  "fabricante": "Nexo", "modelo": "Ponte de E/S", "fw": "1.0.0",
  "canais": [
    { "id": "rele",      "tipo": "switch",  "nome": "Portão", "pulsoMs": 800 },
    { "id": "aberto",    "tipo": "contact", "nome": "Folha do portão" },
    { "id": "temp",      "tipo": "temperature" },
    { "id": "campainha", "tipo": "botao" }
  ]
}
```

- `area` é uma das chaves de `casa/casa.json` (`sala`, `cozinha`,
  `suite`, `escrit`, `varanda`, `entrada`). O instalador pode renomear e
  mudar de área depois pelo `casa.json` (chave = `<id>` da ponte), sem
  reflashar.
- `id` de canal é único dentro da ponte e vira o id da capability
  (`rssi` e `bateria` são reservados à saúde e não podem ser canal;
  duplicado, o primeiro vale).
- Não reaproveite como `<id>` da ponte um `friendly_name` que já exista
  no Zigbee2MQTT: nas automações do `casa.json`, o nome resolve primeiro
  para a malha Zigbee.
- Announce repetido **atualiza** o aparelho (canal novo aparece, estado
  conhecido sobrevive). Announce com tipo de canal que a central não
  conhece: o **canal** é ignorado, a ponte continua — a mesma regra de
  tolerância que o contrato impõe ao app.

### Tipos de canal

| `tipo` | vira no contrato | comanda? | valor no `estado` |
|---|---|---|---|
| `switch` | `switch` | sim | `true` / `false` |
| `dimmer` | `dimmer` | sim | `0–100` |
| `botao` | `event` (button) | não | — (usa `evento`) |
| `temperature`, `humidity`, `power`, `energy`, `voltage`, `current`, `illuminance`, `pressure`, `co2`, `voc`, `pm25` | `sensor` | não | número, na unidade do contrato |
| `contact`, `occupancy`, `motion`, `water_leak`, `smoke`, `gas`, `vibration`, `tamper` | `binary_sensor` | não | `true` = **ativo** |

A convenção nasce falando a língua do contrato — percentuais 0–100,
`true` = ativo (contato **aberto**) — então não existe a camada de
tradução de legado que o Zigbee exige. `pulsoMs` num `switch` documenta
que o relé solta sozinho (portão quer um toque, não um interruptor); o
pulso é executado pelo firmware, e o vaivém aparece no app.

## O relato (`estado`)

```json
{ "rele": false, "aberto": true, "temp": 29.5, "rssi": -58 }
```

Cada chave é o `id` de um canal. Duas chaves reservadas são **saúde**,
não função — vão para a barra de alcance do aparelho, não viram sensor
na tela: `rssi` (dBm do Wi-Fi) e `bateria` (0–100, para ponte a pilha).
Publique no mínimo a cada 60 s (é o `lastSeen` que mantém o app
honesto) e sempre que algo mudar.

## O comando (`comando`)

```json
{ "canal": "rele", "valor": true }
```

`valor` é booleano para `switch`, `0–100` para `dimmer`. A ponte aplica
e **reporta o estado novo** — é esse eco que confirma o comando para o
app (que está otimista desde o toque). Sem eco em 6 s, a central marca
`device_no_response` e o app volta atrás.

## Habilitar na central

O broker da central não escuta a LAN de fábrica. As pontes usam um
segundo listener, **sempre com senha**:

```bash
# 1. credencial da ponte (uma por ponte, para poder revogar uma só)
docker compose exec mosquitto mosquitto_passwd -c /mosquitto/data/pontes.passwd ponte-portao

# 2. descomente o bloco "listener 1884" em docker/mosquitto/mosquitto.conf
# 3. descomente a porta "1884:1884" no docker-compose.yml
docker compose restart mosquitto
```

No `config.h` da ponte: `MQTT_HOST` = IP fixo do Pi (o mesmo da reserva
DHCP do [guia de instalação](instalacao-docker.md)), `MQTT_PORT` = 1884,
e o usuário/senha criados acima. O listener interno 1883 continua
existindo só dentro do Docker, anônimo, como sempre.

## Testar sem ESP32 nenhum

Qualquer máquina na LAN com `mosquitto_pub` finge uma ponte inteira:

```bash
H="-h <ip-do-pi> -p 1884 -u ponte-portao -P <senha>"
mosquitto_pub $H -r -t nexo/pontes/portao/config \
  -m '{"nome":"Portão (bancada)","area":"entrada","canais":[{"id":"rele","tipo":"switch","nome":"Portão"}]}'
mosquitto_pub $H -r -t nexo/pontes/portao/estado -m '{"rele":false,"rssi":-50}'
mosquitto_pub $H -r -t nexo/pontes/portao/disponibilidade -m online
# → o "Portão (bancada)" já está no app. Toque nele e assista:
mosquitto_sub $H -t nexo/pontes/portao/comando
```

E a convenção inteira tem banco de ensaio automatizado — broker real,
central real, ponte fingida, 28 verificações:

```bash
node server/ferramentas/ponte.mjs
```

## Remoção

Apagar o aparelho pelo app (ou `DELETE /api/v1/devices/{id}`) limpa os
retained no broker — sem isso a ponte "renasceria" na próxima subida da
central. Para reinstalar, basta a ponte religar: o announce dela
recria tudo.
