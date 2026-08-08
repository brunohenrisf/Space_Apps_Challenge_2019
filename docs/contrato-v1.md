# Contrato v1 — notas de implementação

O documento do contrato é a fonte da verdade. Esta página registra
**como** ele foi implementado, o que foi acrescentado, e as decisões que
o próprio contrato deixou em aberto.

Verificação: `node server/ferramentas/conformidade.mjs` sobe a central e
confere 70 cláusulas — normalização, códigos de status, rotação de
refresh, escopo do convidado, handshake do stream, tolerância a
capability desconhecida, healthcheck e freio de força bruta.

## Onde cada coisa mora

```
server/lib/contrato/modelo.mjs    tipos, normalização, validação de comando
server/lib/contrato/auth.mjs      §3 e §4 — EdDSA, scrypt, refresh rotativo
server/lib/contrato/rest.mjs      §5 — rotas
server/lib/contrato/stream.mjs    §6 — WebSocket
server/lib/adaptadores/*.mjs      a fronteira do princípio 1
app/index.html                    o cliente, renderizado por capability
```

## Princípio 1 — o cliente nunca conhece o backend

A fronteira é o diretório `adaptadores/`. Um adaptador implementa cinco
métodos (`iniciar`, `devices`, `comandar`, `parear`, `remover`) e avisa a
central por um `bus`. Nada fora dele sabe o que há do outro lado.

Existem dois hoje: `zigbee2mqtt.mjs` e `simulador.mjs`. Um adaptador de
Home Assistant entra sem tocar em `rest.mjs`, `stream.mjs` ou no cliente —
a tabela do §8 está implementada em `exposesParaCapabilities()`, que faz
o equivalente para o `exposes` do Zigbee2MQTT.

Uma consequência prática: `NEXO_ADAPTADOR=simulador` roda o produto
inteiro sem hub nenhum. Serve para demonstração e para o teste de
conformidade.

## Princípio 2 — capability sobre modelo

Este é o princípio que mais mudou o cliente, e é o que exige disciplina
para não erodir.

As funções de um aparelho **não** estão em arquivo de configuração: saem
do `exposes` que o Zigbee2MQTT declara. Lâmpada de modelo novo entra na
casa e aparece na tela com os controles certos, sem editar nada.

No cliente há um registro `REND`, uma entrada por tipo de capability, e
cada entrada sabe se desenhar. Não existe `if (é lâmpada)` em lugar
nenhum — o termostato, por exemplo, ganhou controle próprio sem que uma
única linha mencionasse ar-condicionado.

Tipo desconhecido é ignorado em silêncio, como manda o §2.3. Para que
isso não seja promessa vazia, o simulador declara de propósito uma
capability `air_quality`, que não existe no contrato. O aparelho renderiza
as duas funções conhecidas, some com a terceira, e a ficha técnica admite:
*"1 função não suportada — este app é mais antigo que a central"*.

## Regra de normalização

Todas as conversões moram em `modelo.mjs` e em nenhum outro arquivo.
Quem precisar de um valor cru vai ter que vir aqui e explicar por quê —
que era exatamente a intenção do *"a primeira exceção vira dez"*.

| Do rádio | Para o cliente |
|---|---|
| `brightness` 0–254 | `value` 0–100 |
| `color_temp` em mireds | `kelvin`, e a faixa invertida para crescente |
| `color` xy CIE 1931 | `hue` 0–360, `saturation` 0–100 |
| `linkquality` 0–255 | `signal` 0–100 |
| `contact` (true = fechado) | `state` (true = aberto, o estado "ativo") |

O `signal` não é regra de três: LQI abaixo de ~40 já é enlace ruim e acima
de ~180 a diferença não se percebe. A curva achata as pontas para que a
barra na tela signifique algo para quem está instalando.

## Acréscimos ao contrato

Quatro, todos marcados no código:

**`GET /setup/status`** (público). O §4 prevê que o cliente leia
`setup=<0|1>` do TXT do mDNS — mas navegador não faz mDNS. Sem esta rota
o PWA não sabe se mostra "criar conta" ou "entrar". Não revela nada que
quem já está na LAN não descubra sozinho.

**`POST /devices/:id/favorite`.** Favorito é preferência de quem usa, não
função do aparelho, então não cabia como capability.

**`GET /health`** (público). O healthcheck do contêiner e o diagnóstico de
bancada: status, uptime, adaptador, hub e contagem de aparelhos. Mínimo de
propósito — não revela nada que quem já está na LAN não veja de outro
jeito.

**Extensões do §9** (`/scenes`, `/modes`, `/automations`, `/suggestions`).
Ver abaixo.

## Decisões que o §9 deixou em aberto

**Cenas e automações: recurso próprio do BFF.** Delegar ao engine do Home
Assistant seria mais rápido de escrever e errado de manter — a UI ficaria
amarrada ao formato de automação do HA, e trocar de backend levaria junto
as rotinas que a família construiu. Cena vira um `POST /commands/batch`:
um round-trip em vez de N.

Junto vêm os **modos da casa** (Normal, Dormindo, Fora, Recebendo). Um
modo não é uma cena: cena é comando, modo é o estado em que a casa fica. É
o que permite ao mesmo gatilho agir diferente sem virar pilha de exceções
aninhadas. Automação fora do modo atual reporta `activeNow: false` e
aparece esmaecida.

**Multi-central: ainda em aberto.** O `home` claim do JWT hoje é o id da
central, e cada central é sua própria autoridade. Casa com duas centrais
seria duas `Home` — o que é errado para o usuário. Resolver isso exige
decidir quem emite o token quando há mais de uma; não há apuro para isso
enquanto não existir a segunda casa grande.

**Relay: não implementado.** Fora da LAN o app não conecta. Ver a nota
sobre WireGuard em [arquitetura.md](arquitetura.md#segurança).

## Notas de segurança

- **`alg: none` é rejeitado explicitamente.** O ataque clássico contra JWT
  mal verificado; tem teste próprio na conformidade.
- **Reuso de refresh derruba a família inteira**, inclusive o token bom. Não
  há como distinguir vazamento de cópia legítima, e errar para o lado
  permissivo é errar para o lado do invasor.
- **Escopo de convidado é avaliado no servidor**, em três lugares: no
  `GET /devices`, no despacho de comando (avulso e em lote, pelo mesmo
  caminho — senão o lote vira porta dos fundos) e na difusão do WebSocket.
- **`pairing/start` tem teto de 5 minutos**, não negociável pelo cliente.
  Rede aberta sem prazo é falha de segurança.
- **A chave Ed25519 é gerada no primeiro boot** e não sai do disco da
  central. Vazar uma casa não vaza nenhuma outra.

## Consequência para o firmware do ESP32

O firmware em `firmware/nexo-panel` **não implementa o contrato v1** e não
serve mais este aplicativo. JWT com EdDSA, modelo de capability e refresh
rotativo são pesados demais para o ESP32 clássico, e forçá-los ali seria
piorar os dois lados.

Ele fica no repositório como referência da topologia enxuta e como ponto
de partida para o papel que o ESP32 de fato faz bem: painel de parede
(cliente da central) ou ponte de E/S para relé, dimmer 0–10 V e sensor com
fio. Quem quiser o painel no ESP32 usa o app da tag anterior a esta.
