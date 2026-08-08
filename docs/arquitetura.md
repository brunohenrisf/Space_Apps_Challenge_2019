# Arquitetura

## Topologia

```
┌──────────────┐        Wi-Fi da casa          ┌──────────────────────┐
│   iPhone     │◄─────────────────────────────►│  ESP32 + cartão SD   │
│   PWA        │   HTTP (interface, /api)      │  "o painel"          │
│              │   WebSocket (/ws, tempo real) │                      │
└──────────────┘                               └──────────┬───────────┘
                                                          │ MQTT
                                                          │ (LAN)
                                               ┌──────────▼───────────┐
                                               │  Hub Zigbee          │
                                               │  Zigbee2MQTT +       │
                                               │  coordenador CC2652  │
                                               └──────────┬───────────┘
                                                          │ Zigbee 3.0
                                            ┌─────────────┼─────────────┐
                                         lâmpadas      tomadas       sensores
                                         cortinas      fechadura     (a pilha)
```

Nenhuma seta sai desse desenho para a internet. É a premissa do produto,
não uma limitação: a casa funciona com o roteador desligado da rua.

## Por que o ESP32 no meio

O hub Zigbee poderia servir a interface sozinho. O painel existe por três
razões:

1. **Desacopla o telefone do hub.** Trocar o Zigbee2MQTT por ZHA, ou o
   coordenador por outro modelo, muda o firmware do painel e nada mais. A
   interface não sabe que Zigbee existe.
2. **Estado e cenas moram fora do hub.** Se o Zigbee2MQTT reinicia, o
   "boa noite" da casa não vai junto — está no cartão SD.
3. **Vira painel de parede.** O mesmo ESP32 aceita um display touch e
   passa a ser o controle fixo da sala, servindo o telefone ao mesmo tempo.

A troca: mais um ponto de falha, e o painel precisa estar de pé para o
telefone funcionar. Numa instalação onde o hub já é um Raspberry Pi
confiável e não há plano de painel de parede, servir a interface direto do
Pi é uma escolha defensável — a interface é a mesma, muda quem a entrega.

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
```

**Telefone → painel**

```jsonc
{ "t":"set",   "id":"sala_teto", "p":{ "on":true, "bri":72 } }
{ "t":"scene", "id":"boanoite" }
{ "t":"pair",  "s":60 }                        // abre a rede por 60 s
```

### Vocabulário de estado

A interface fala em grandezas humanas; o painel traduz para Zigbee. Essa
tradução mora num lugar só — `aoMensagemMqtt()` e `aoReceberDoApp()` — e é
o que permite trocar de hub sem mexer no app.

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

## Segurança

O modelo de ameaça honesto: **quem está na rede Wi-Fi da casa controla a
casa.** O código de 4 dígitos impede que a visita brinque com as luzes; não
detém um atacante já dentro do perímetro.

O que de fato sustenta a segurança:

- o painel não é exposto para a internet — sem redirecionamento de portas,
  sem UPnP;
- os dispositivos ficam numa VLAN ou SSID separado do resto da casa;
- o broker MQTT exige usuário e senha (`config.h`), e não escuta em `0.0.0.0`
  se o hub e o painel estiverem no mesmo segmento;
- `config.h` está no `.gitignore`; as credenciais da casa do cliente não
  entram em repositório.

Se um dia o acesso remoto entrar no escopo, o caminho é VPN (WireGuard no
roteador), não abrir porta. Isso mantém o modelo: para controlar a casa,
estar dentro dela — ou dentro do túnel.

## Limites conhecidos

- **Sem NTP, o painel não sabe a hora.** Rotinas por horário precisam de um
  RTC (DS3231) ou de uma janela de internet na partida. As rotinas por
  evento (presença, vazamento, contato) não dependem disso.
- **Consumo só onde há medição.** A tela de Energia mostra o que passa por
  tomada Zigbee com medidor. Iluminação em circuito direto não aparece — a
  própria tela diz isso, para o cliente não achar que o número está errado.
- **Um painel, poucos telefones.** O `ESPAsyncWebServer` atende bem uns 4 a
  6 WebSockets simultâneos no ESP32 clássico. Para uma casa, sobra.
- **`MAX_DISPOSITIVOS` é 64.** Acima disso, o JSON de `/api/state` começa a
  pressionar a heap; o caminho é paginar por cômodo.
