# Arquitetura

## Topologia

```
┌──────────────┐        Wi-Fi da casa          ┌──────────────────────────┐
│   iPhone     │◄─────────────────────────────►│  Raspberry Pi            │
│   PWA        │   HTTPS (interface, /api)     │   Caddy — termina TLS    │
│              │   WSS (tempo real)            │   nexo.mjs — painel      │
└──────────────┘                               │   Zigbee2MQTT            │
                                               │   histórico em disco     │
                                               └───────────┬──────────────┘
                                                           │ Zigbee 3.0
                                            ┌──────────────┼──────────────┐
                                         lâmpadas       tomadas        sensores
                                         cortinas       fechadura      (a pilha)
```

Na topologia enxuta, o bloco do meio vira um ESP32 servindo do cartão SD e
falando MQTT com um hub Zigbee separado.

Nenhuma seta sai desse desenho para a internet. É a premissa do produto,
não uma limitação: a casa funciona com o roteador desligado da rua.

## Duas topologias, um contrato

O aplicativo fala com **"o painel"** por REST e WebSocket, e nunca soube
quem está do outro lado. Isso não é abstração gratuita — é o que permite
trocar o painel inteiro sem tocar numa linha da interface, e foi exatamente
o que aconteceu quando o projeto migrou para o Raspberry Pi.

**Painel no Pi (recomendada).** `server/nexo.mjs` roda ao lado do
Zigbee2MQTT, no mesmo aparelho. Um salto a menos, TLS de verdade, relógio
certo e disco para o histórico. É o que destrava o aprendiz. O ESP32 sai
do caminho crítico e fica disponível para o que faz bem: painel de parede
com display, ou ponte de E/S para relé, dimmer 0–10 V e sensor com fio.

**Painel no ESP32 (enxuta).** `firmware/nexo-panel` serve a interface do
cartão SD e faz a mesma ponte MQTT. Para instalação sem Pi. Abre mão de
histórico, aprendiz e rotina por horário — sem RTC o ESP32 não sabe a hora.

O que muda entre as duas: **nada na interface**. Ver
[raspberry.md](raspberry.md) para o que se ganha, o que se perde (o cartão
do Pi corrompe; boot de 30 s em vez de 2 s) e como instalar.

## Contrato: interface ↔ painel

### REST

| Método | Rota | Retorno |
|---|---|---|
| `GET` | `/api/state` | Fotografia completa: `hub`, `painel`, `rooms`, `devices`, `scenes` |

`/api/state` é chamado uma vez, na abertura. Daí em diante tudo é
WebSocket. O app usa a falha dessa chamada como sinal de que não há painel
alcançável, e cai no simulador embutido.

### WebSocket `/ws`

**Painel → telefone**

```jsonc
{ "t":"state", "id":"sala_teto", "p":{ "on":true, "bri":64, "k":3000 } }
{ "t":"reject","id":"ent_portao" }            // o nó não confirmou
{ "t":"hub",   "p":{ "online":true } }
{ "t":"panel", "p":{ "rssi":-58, "heap":148, "uptime":412860 } }
{ "t":"modo",  "p":{ "modo":"dormindo" } }    // só no painel do Pi
{ "t":"sugestoes", "p":[ /* … */ ] }          //  idem
{ "t":"rotinas",   "p":[ /* … */ ] }          //  idem
```

**Telefone → painel**

```jsonc
{ "t":"set",   "id":"sala_teto", "p":{ "on":true, "bri":72 } }
{ "t":"scene", "id":"boanoite" }
{ "t":"pair",  "s":60 }                        // abre a rede por 60 s
{ "t":"modo",  "id":"dormindo" }
{ "t":"routine","id":"r1" }                    // liga/desliga a rotina
{ "t":"fav",   "id":"sala_teto", "v":true }
{ "t":"sug",   "id":"h:coz_bancada:util:26", "v":"aceitar" }   // aceitar|depois|nunca
```

As quatro últimas são atendidas só pelo painel do Pi. No ESP32 são
ignoradas, e a interface segue funcionando com o estado local — nenhuma
tela quebra por causa disso.

### Vocabulário de estado

A interface fala em grandezas humanas; o painel traduz para Zigbee. Essa
tradução mora num lugar só em cada painel — `zigbeeParaApp()` e
`appParaZigbee()` em `server/nexo.mjs`, `aoMensagemMqtt()` e
`aoReceberDoApp()` no `.ino` — e é o que permite trocar de hub sem mexer
no app. As duas implementações espelham a mesma tabela.

| Interface | Zigbee2MQTT | Observação |
|---|---|---|
| `on` (bool) | `state` `"ON"`/`"OFF"` | |
| `bri` 1–100 | `brightness` 0–254 | `bri × 2,54` |
| `k` 2000–6500 | `color_temp` em mireds | `1.000.000 ÷ K` |
| `pos` 0–100 | `position` | cortina |
| `trancado` (bool) | `state` `"LOCK"`/`"UNLOCK"` | |
| `w`, `kwh` | `power`, `energy` | tomada com medição |
| `t`, `h` | `temperature`, `humidity` | |
| `motion` | `occupancy` | |
| `aberto` | `contact` **invertido** | o Zigbee reporta contato fechado |
| `lqi` | `linkquality` | 0–255 |

## Decisões de interface que vieram do rádio

Três coisas nesta interface existem por causa de como o Zigbee se comporta.
Se forem removidas numa versão futura, o app volta a parecer quebrado.

**Comando otimista com reconciliação.** Uma ida e volta no Zigbee leva de
100 a 500 ms, e mais que isso quando o nó está longe. Esperar a confirmação
para mover o interruptor faz o app parecer travado. Então a interface muda
na hora, marca o cartão com um pulso âmbar, e se em 3 s não vier
confirmação, desfaz e avisa. `Bus.set()` e `confirmar()`, em `app/index.html`.

**Arrasto limitado a ~4 comandos por segundo.** Um slider que emite a cada
pixel derruba a malha — literalmente: os relatos dos sensores param de
chegar enquanto se arrasta. O envio é limitado a 240 ms, com o valor final
sempre despachado ao soltar.

**Estado velho é mostrado como velho.** Um sensor a pilha que não reporta
há três horas aparece esmaecido e com "sem reportar", em vez de exibir a
última leitura como se fosse agora. Mentir sobre a idade do dado é a causa
mais comum de "o app está errado" em automação residencial.

**Só ação manual conta como aprendizado.** O histórico marca a origem de
cada evento — `manual`, `rotina` ou `cena`. Se a rotina que a casa criou
realimentasse o histórico como se fosse gente, ela confirmaria o próprio
palpite para sempre. É uma linha de código e é o que separa aprendizado de
alucinação. Ver `server/lib/aprendiz.mjs`.

## Segurança

O modelo de ameaça honesto: **quem está na rede Wi-Fi da casa controla a
casa.** O código de 4 dígitos impede que a visita brinque com as luzes; não
detém um atacante já dentro do perímetro.

O que de fato sustenta a segurança:

- o painel não é exposto para a internet — sem redirecionamento de portas,
  sem UPnP;
- os dispositivos ficam numa VLAN ou SSID separado do resto da casa;
- o broker MQTT exige usuário e senha, e no Pi ele escuta só em `127.0.0.1`,
  porque painel e Zigbee2MQTT passam a morar no mesmo aparelho;
- `config.h` e `server/config.json` estão no `.gitignore`; as credenciais da
  casa do cliente não entram em repositório;
- no Pi, o serviço roda como usuário próprio e sem privilégio, com escrita
  só em `/var/lib/nexo` (ver `server/deploy/nexo.service`).

Se um dia o acesso remoto entrar no escopo, o caminho é VPN (WireGuard no
roteador), não abrir porta. Isso mantém o modelo: para controlar a casa,
estar dentro dela — ou dentro do túnel.

## Limites conhecidos

- **No ESP32, sem NTP o painel não sabe a hora.** Rotinas por horário
  precisam de um RTC (DS3231) ou de uma janela de internet na partida. As
  rotinas por evento (presença, vazamento, contato) não dependem disso. No
  Pi o problema não existe.
- **O cartão SD do Pi corrompe.** É o risco real da topologia recomendada;
  as mitigações estão em [raspberry.md](raspberry.md).
- **O aprendiz precisa de duas a quatro semanas** de histórico antes de
  propor a primeira rotina. Limiares em `server/lib/aprendiz.mjs` — baixá-los
  faz a casa sugerir bobagem, e uma sugestão ruim custa a confiança de todas
  as próximas.
- **Consumo só onde há medição.** A tela de Energia mostra o que passa por
  tomada Zigbee com medidor. Iluminação em circuito direto não aparece — a
  própria tela diz isso, para o cliente não achar que o número está errado.
- **No ESP32, poucos telefones.** O `ESPAsyncWebServer` atende bem uns 4 a
  6 WebSockets simultâneos. Para uma casa, sobra. No Pi são centenas.
- **`MAX_DISPOSITIVOS` é 64 no ESP32.** Acima disso, o JSON de `/api/state`
  começa a pressionar a heap; o caminho é paginar por cômodo. No Pi não há
  esse teto.
