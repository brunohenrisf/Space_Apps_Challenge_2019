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

**ESP32: periférico, não painel.** Com o contrato v1 — JWT EdDSA, modelo
de capability, refresh rotativo — o ESP32 clássico deixou de dar conta de
ser a central. O firmware em `firmware/nexo-panel` fica como referência da
topologia enxuta e como ponto de partida para o que o ESP32 faz bem:
painel de parede (cliente da central) ou ponte de E/S para relé, dimmer
0–10 V e sensor com fio. Ver [contrato-v1.md](contrato-v1.md).

O que muda entre as duas: **nada na interface**. Ver
[raspberry.md](raspberry.md) para o que se ganha, o que se perde (o cartão
do Pi corrompe; boot de 30 s em vez de 2 s) e como instalar.

## Contrato: cliente ↔ central

A fronteira é o **contrato v1**, versionado em `/api/v1`. Os princípios
que o estruturam:

1. **O cliente nunca conhece o backend.** Nenhum `entity_id`, nenhum tópico
   MQTT, nenhuma URL de Home Assistant atravessa a fronteira.
2. **Capability sobre modelo.** A tela é montada a partir das funções que a
   central declara, nunca de modelo ou fabricante. Aparelho novo não exige
   publicar app.
3. **Local-first.** Tudo funciona sem internet.
4. **Estado por WebSocket, ação por REST.** Sem polling.
5. **Versionamento no path.** Quebrar exige `/v2`, com `/v1` mantido por
   no mínimo 12 meses.

O contrato completo é o documento de referência; as notas de implementação,
os acréscimos e as decisões que ele deixou em aberto estão em
[contrato-v1.md](contrato-v1.md).

### Verificação

```bash
node server/ferramentas/conformidade.mjs
```

Sobe a central com o adaptador simulador e confere 70 cláusulas, uma a
uma. É o que impede alguém de "otimizar" o BFF devolvendo `brightness`
0–254 porque é o que o Zigbee manda — o erro aparece aqui, e não na casa
do cliente três meses depois.

### A fronteira do backend

`server/lib/adaptadores/` é onde o princípio 1 vira estrutura de arquivo.
Um adaptador implementa cinco métodos e avisa a central por um `bus`;
nada fora dele sabe o que há do outro lado. Existem dois: Zigbee2MQTT e
um simulador que roda a casa inteira em memória.

A tradução de unidade — 0–254 para percentual, mired para Kelvin, xy para
HS, LQI para sinal 0–100 — mora em `server/lib/contrato/modelo.mjs` e em
mais lugar nenhum.

## Decisões de interface que vieram do rádio

Três coisas nesta interface existem por causa de como o Zigbee se comporta.
Se forem removidas numa versão futura, o app volta a parecer quebrado.

**Comando otimista com reconciliação.** É por isso que o comando responde
`202 Accepted` e não `200`: foi aceito e despachado, e a confirmação chega
depois por `command.result`. Uma ida e volta no Zigbee leva de 100 a 500 ms,
e mais quando o nó está longe; esperar por ela para mover o interruptor faz
o app parecer travado. A interface muda na hora, pulsa em âmbar, e desfaz
com aviso se o resultado vier `failed`. `comandar()` e `resolverComando()`,
em `app/index.html`.

**Arrasto limitado a ~4 comandos por segundo.** Um slider que emite a cada
pixel derruba a malha — literalmente: os relatos dos sensores param de
chegar enquanto se arrasta. O envio é limitado a 240 ms, com o valor final
sempre despachado ao soltar.

**Estado velho é mostrado como velho.** Um sensor a pilha que não reporta
há três horas aparece esmaecido e com "sem reportar", em vez de exibir a
última leitura como se fosse agora. Mentir sobre a idade do dado é a causa
mais comum de "o app está errado" em automação residencial.

**O agendador conhece o sol, sem internet.** Automações aceitam o gatilho
`sol` (`nascer`/`por`, com offset em minutos): o horário é calculado
astronomicamente de `home.lat/lon` em `server/lib/sol.mjs`, uma vez por
dia. "Acender no pôr do sol" continua certa em junho e em dezembro sem
ninguém reajustar — e sem depender de API de clima.

**O que a família constrói sobrevive a reinício.** Modo da casa,
favoritos, apelidos de aparelho, automações criadas pelo aprendiz e
recusas ficam em `estado.json` no volume de dados — atualizar a imagem do
contêiner não apaga o que a casa aprendeu.

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
