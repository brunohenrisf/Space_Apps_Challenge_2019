# Instalação da central em contêineres

O caminho oficial de produção: toda a pilha — Caddy, central, Mosquitto e
Zigbee2MQTT — sobe com um `docker compose up`. Replicar a casa seguinte é
clonar o repositório, ajustar um `.env` de quatro linhas e rodar o
instalador. Este guia cobre do cartão virgem à entrega ao cliente.

```
┌─ Raspberry Pi ────────────────────────────────────────────────┐
│  docker compose (projeto "nexo")                              │
│                                                               │
│  caddy        :80/:443 → única porta aberta para a LAN        │
│  nexo         central · contrato v1 · automações · aprendiz   │
│  zigbee2mqtt  ← /dev/serial/by-id/… (dongle)                  │
│  mosquitto    broker — SÓ existe dentro da rede do compose    │
│                                                               │
│  volumes: nexo-dados (chaves, contas, histórico, aprendizado) │
│           z2m-dados · mosquitto-dados · caddy-dados           │
│  bind:    ./casa → configuração da casa, legível no host      │
└───────────────────────────────────────────────────────────────┘
```

## 1. Sistema operacional

1. **Raspberry Pi Imager** → *Raspberry Pi OS Lite (64-bit)*. Grave direto
   no **SSD** (adaptador USB no notebook) — cartão SD só como provisório.
2. No engrenagem do Imager, antes de gravar:
   - hostname: **nexo** ← é isto que faz `http://nexo.local` funcionar
   - SSH ligado, usuário e senha do instalador
   - Wi-Fi **em branco** (o Pi vai no cabo; ver [hardware.md](hardware.md))
3. Primeiro boot no Pi, via SSH:

```bash
sudo apt-get update && sudo apt-get full-upgrade -y
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
newgrp docker           # ou relogue
```

O Docker Engine para arm64 já traz o plugin compose. Nada mais é instalado
no host — Node, Mosquitto e Zigbee2MQTT vivem só dentro das imagens.

## 2. Subir a central

```bash
git clone <repo> nexo && cd nexo
./instalar.sh
```

O instalador confere o Docker, encontra o dongle em `/dev/serial/by-id`
(o caminho estável — `/dev/ttyUSB0` troca de número entre reinícios),
deduz o driver (`ember` para ZBDongle-E, `zstack` para CC2652), escreve o
`.env` e sobe a pilha com build local. A primeira construção leva alguns
minutos; as seguintes, segundos.

Dois desvios que ele trata sozinho:

- **Sem dongle conectado** — mapear um `/dev` inexistente faria o Docker
  falhar na *criação* do contêiner do Zigbee2MQTT; o instalador então sobe
  só `mosquitto + nexo + caddy` (dá para criar a conta do dono, instalar o
  app no iPhone, testar tudo em demo). Espetou o rádio? Rode
  `./instalar.sh` de novo: ele detecta o dongle, corrige o `.env` e
  completa a pilha.
- **cgroup de memória desligado** (padrão do Raspberry Pi OS) — o
  `mem_limit` do compose seria descartado *em silêncio*. O instalador
  avisa e mostra o que acrescentar em `/boot/firmware/cmdline.txt`
  (`cgroup_enable=memory cgroup_memory=1` + reinício). A pilha funciona
  sem isso; só fica sem o teto de RAM.

Revise o `.env` antes de entregar — são quatro decisões:

| Variável | O que é | Regra |
|---|---|---|
| `TZ` | fuso da casa | automações por horário e por sol dependem disto |
| `NEXO_SERIAL` | caminho do dongle | sempre `/dev/serial/by-id/…` |
| `NEXO_SERIAL_ADAPTADOR` | driver do coordenador | `ember` ou `zstack` |
| `NEXO_CANAL` | canal Zigbee | escolhido **contra** o Wi-Fi — tabela em [hardware.md](hardware.md); definir **antes** do primeiro pareamento |

Verificação:

```bash
docker compose ps                          # 4 serviços "healthy"
curl -s http://127.0.0.1/api/v1/health     # {"status":"ok",...}
docker compose logs -f zigbee2mqtt         # coordenador iniciou?
```

## 3. Como o cliente acessa e entra — a decisão, por extenso

**Endereço.** O app é servido pela própria central. O morador digita uma
vez `http://nexo.local` (o hostname *nexo* + o avahi que o Raspberry Pi OS
já traz fazem o mDNS funcionar em iPhone sem instalar nada) e adiciona à
tela de início. Como rede de segurança para roteadores que filtram mDNS
entre 2,4 e 5 GHz, o instalador **também** faz reserva DHCP no roteador e
deixa na central um adesivo com QR apontando para `http://<ip-fixo>` — os
dois endereços chegam ao mesmo lugar.

**Primeiro acesso = tomar posse.** Uma central virgem anuncia
`setup=1`; o app abre direto em **"Vamos configurar sua casa"** e a
primeira conta criada vira a dona (`POST /setup/claim` — aceito uma única
vez, depois disso sempre 409). Não existe senha padrão de fábrica para
vazar em lista: a credencial nasce na casa, na frente do cliente.

**Todos os demais entram por convite**, nunca por cadastro aberto:

1. O dono abre *Ajustes → Pessoas → Convidar morador* (ou *visita*).
2. A central gera um código de 8 caracteres com validade curta (72 h para
   morador, 24 h para visita) e o app mostra o código com a instrução
   completa na tela.
3. No aparelho da pessoa: mesmo Wi-Fi → `http://nexo.local` → **"Tenho um
   convite"** → código + nome + e-mail + senha. Pronto.
4. **Visita** enxerga e controla apenas os favoritos, e a restrição é
   avaliada no servidor (listagem, comando e WebSocket) — não é filtro de
   tela.

**Por trás disso:** access token JWT (EdDSA) de 15 min renovado em
silêncio + refresh de 60 dias que rotaciona a cada uso; reuso de refresh
derruba a família de tokens inteira. A chave Ed25519 nasce no primeiro
boot e nunca sai do volume — vazar uma casa não vaza nenhuma outra. Reset
físico (`docs/contrato-v1.md`) apaga contas e preserva os pareamentos.

**Fora da LAN o app não conecta, de propósito.** Acesso remoto, quando
entrar no escopo, será VPN (WireGuard no roteador) — nunca porta aberta.

## 4. Operação

| Tarefa | Comando |
|---|---|
| Estado da pilha | `docker compose ps` |
| Logs da central | `docker compose logs -f nexo` |
| Logs do rádio | `docker compose logs -f zigbee2mqtt` |
| Reiniciar após editar `casa/casa.json` | `docker compose restart nexo` |
| **Atualizar** para uma versão nova | `git pull && docker compose up -d --build` |
| Parar tudo | `docker compose down` (volumes ficam) |

**Backup** — o que não dá para recriar mora em dois lugares:

```bash
# estado da casa: chaves, contas, histórico, automações aprendidas
docker run --rm -v nexo_nexo-dados:/d -v "$PWD":/b alpine \
  tar czf /b/backup-nexo-$(date +%F).tgz -C /d .

# rede Zigbee: pareamentos e chaves da malha
docker run --rm -v nexo_z2m-dados:/d -v "$PWD":/b alpine \
  tar czf /b/backup-z2m-$(date +%F).tgz -C /d .
```

Restaurar é o `tar xzf` no sentido inverso, com a pilha parada. Agende os
dois num cron semanal para um pendrive.

**Réplica em casa nova** — clone o repositório, copie **somente**
`casa/casa.json` como ponto de partida e rode `./instalar.sh`. **Nunca**
copie os volumes de uma casa para outra: eles carregam a chave de
assinatura, as contas e as chaves da malha Zigbee — cada casa é sua
própria autoridade.

## 5. TLS quando a instalação pedir

O padrão de fábrica é HTTP puro na porta 80 — funciona no minuto um, e o
iPhone instala o app na tela de início mesmo assim (sem cache offline nem
push). Quando quiser destravar esses dois, edite
`docker/caddy/Caddyfile`: as duas opções (domínio próprio com DNS-01, ou
CA própria para casa 100% offline) estão comentadas lá, e o raciocínio
completo em [ios-pwa.md](ios-pwa.md). `docker compose restart caddy`
aplica.

## 6. Pontes de E/S (portão, contato seco, campainha)

O que tem fio e não tem Zigbee entra na casa por uma **ponte** — um
ESP32 de R$ 40 falando MQTT com a central. De fábrica o broker não
escuta a LAN; habilitar é criar uma credencial e abrir o listener 1884
(sempre com senha). O passo a passo, a convenção e o firmware estão em
[pontes-mqtt.md](pontes-mqtt.md).

## 7. Diagnóstico rápido

| Sintoma | Primeira suspeita |
|---|---|
| `zigbee2mqtt` reiniciando em loop | dongle: caminho errado no `.env`, ou driver trocado (`ember`×`zstack`) |
| Sensor some / comando não chega | dongle sem o extensor USB 2.0, colado no SSD — **o** clássico ([hardware.md](hardware.md)) |
| `nexo.local` não abre, IP abre | roteador filtrando mDNS entre bandas — use o IP fixo/QR; SSID único ajuda |
| App diz "central ligada" mas nada responde | `docker compose logs mosquitto` — broker de pé? |
| Automação por sol na hora errada | `TZ` errado no `.env`, ou `lat`/`lon` ausentes em `casa/casa.json` |
| `zigbee2mqtt` nem aparece no `ps` | instalação feita sem dongle — espete o rádio e rode `./instalar.sh` de novo |
| Ponte ESP32 não conecta | listener 1884 habilitado? credencial criada? — [pontes-mqtt.md](pontes-mqtt.md) |
| `mem_limit` sem efeito (RAM cresce além do teto) | cgroup de memória desligado — `cgroup_enable=memory cgroup_memory=1` no `cmdline.txt` e reinício |
| "no space left on device" | `docker system prune` (imagens antigas de builds acumulam) |

O ciclo completo (broker MQTT real → central → interface → comando →
relato → histórico) tem teste automatizado — `server/ferramentas/` — mas
**o build da imagem em si só é validado no Pi**: rode `./instalar.sh` numa
bancada antes da primeira casa.
