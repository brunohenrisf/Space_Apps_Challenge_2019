# Hardware da central — especificação completa

Esta é a lista que vai para a cotação e para a mochila do instalador. Cada
item tem o porquê; os dois avisos em destaque são o que separa uma
instalação que funciona anos de uma que gera visita técnica.

## Lista de compras (BOM)

| # | Peça | Especificação | Por que esta | R$ aprox. |
|---|------|---------------|--------------|-----------|
| 1 | **Raspberry Pi 4 Model B, 4 GB** | BCM2711, 4× Cortex-A72 @ 1,8 GHz, Gigabit Ethernet | 2 GB roda; 4 GB deixa folga para o Zigbee2MQTT crescer com a casa. Alternativas: Pi 5 4 GB (mais caro, exige fonte 5 V/5 A) ou CM4 com eMMC (elimina o item 3) | 750 |
| 2 | **Dongle Zigbee SONOFF ZBDongle-E** | EFR32MG21, +20 dBm, USB, firmware *ember* NCP 7.4.x | Coordenador com firmware atualizável e boa sensibilidade. Alternativa: ZBDongle-P (CC2652P, driver `zstack`) — os dois estão no compose, muda uma variável do `.env` | 220 |
| 3 | **SSD USB 120–256 GB + case USB 3.0 UASP** | Qualquer SATA/NVMe de marca; case com chip Realtek/ASMedia | **Cartão SD corrompe**, e a energia no Brasil acelera isso. Boot em SSD é a peça que mais evita visita técnica | 250 |
| 4 | **Cabo extensor USB 2.0, 1 m, blindado** | Macho-A → fêmea-A | Parece supérfluo e é o item mais importante da lista — ver o aviso de rádio abaixo | 25 |
| 5 | **Fonte oficial USB-C 5 V / 3 A** (Pi 4) | 15 W, cabo fixo | Fonte fraca causa reinício aleatório que se confunde com bug de software. Pi 5 exige 5 V / 5 A | 120 |
| 6 | **Nobreak 600 VA** | Qualquer entrada com saída senoidal aproximada | A central inteira puxa ~7 W de pico: um nobreak pequeno segura horas e evita escrita interrompida no SSD | 300 |
| 7 | **Case ventilado + dissipadores** | Alumínio ou plástico com fluxo passivo | O Pi 4 estrangula a 80 °C; num armário fechado no verão isso acontece | 60 |
| 8 | Cabo Ethernet Cat5e até o roteador | — | Pi no cabo, sempre que der — ver rádio abaixo | 15 |

Total de referência: **~R$ 1.740** por casa, fora os dispositivos Zigbee.
Valores são ordem de grandeza para dimensionar proposta — confirme no dia.

### O que NÃO comprar

- **Cartão SD como armazenamento definitivo.** Só como mídia de boot
  provisória até o SSD chegar. Se for inevitável, use cartão "High
  Endurance" e dobre a frequência de backup.
- **Hub Zigbee de marca** (Hue Bridge, echo, etc.). O coordenador USB +
  Zigbee2MQTT falam com todas as marcas ao mesmo tempo; um hub de marca
  prende a casa ao catálogo de um fabricante.
- **Fonte de celular avulsa.** É a causa nº 1 de "o Pi vive reiniciando".

## ⚠️ Os dois avisos que valem a página

**1. USB 3.0 emite ruído exatamente em 2,4 GHz.** SSDs e portas USB 3.0
irradiam banda larga em cima da faixa do Zigbee. Dongle espetado direto na
traseira do Pi, ao lado do SSD, produz uma malha que funciona na bancada e
falha na casa — sensor que some, comando que não chega, uma tarde caçando
um bug de software que não existe. **Use o cabo extensor (item 4) e afaste
o dongle ~50 cm do Pi e de qualquer USB 3.0.** O dongle vai numa porta
USB 2.0 (as pretas); o SSD nas USB 3.0 (azuis).

**2. Escolha o canal Zigbee contra o Wi-Fi da casa.** Os dois vivem em
2,4 GHz. Wi-Fi ocupa os canais 1, 6 e 11; o Zigbee 15, 20 e 25 caem nas
frestas:

| Wi-Fi da casa no canal… | Use Zigbee no canal |
|---|---|
| 1 | 15 ou 20 |
| 6 | 15 ou 25 |
| 11 | 25 |
| roteador em "auto" | fixe o Wi-Fi primeiro, depois escolha |

Configura-se no `.env` (`NEXO_CANAL`), antes do primeiro pareamento —
trocar o canal depois obriga a reparear a casa inteira.

## Planejando a malha Zigbee

- **Quem é alimentado pela rede elétrica roteia; quem é a pilha, não.**
  Lâmpadas e tomadas Zigbee repetem sinal; sensores a pilha só falam.
  Uma casa só com sensores não tem malha — tem pontos isolados gritando
  com o coordenador.
- **Regra prática:** um roteador (lâmpada/tomada) a cada 8–10 m em planta,
  um por pavimento no mínimo, e um perto de qualquer fechadura — fechadura
  a pilha com enlace fraco é chamado garantido.
- **Pi no cabo Ethernet.** Wi-Fi no Pi liga um segundo rádio de 2,4 GHz a
  centímetros do dongle. O cabo resolve de graça; se for impossível,
  prenda o Wi-Fi do Pi em 5 GHz.

## Consumo e autonomia

| Item | Consumo típico |
|---|---|
| Pi 4 + SSD + dongle, em uso | 5–7 W |
| Roteador da casa (referência) | 8–12 W |

Nobreak de 600 VA / ~360 W com carga de 15–20 W (central + roteador)
segura na casa de **1 h 30 a 3 h** — o suficiente para a quase totalidade
das quedas. Importante: **o roteador também vai no nobreak**, senão a
central sobrevive à queda mas ninguém a alcança.

## Montagem física, na ordem

1. Grave o SSD com Raspberry Pi OS Lite 64-bit (ver
   [instalacao-docker.md](instalacao-docker.md)); nada de cartão SD.
2. Case + dissipadores no Pi; SSD numa porta **azul** (USB 3.0).
3. Cabo extensor numa porta **preta** (USB 2.0); dongle na ponta, afastado
   do Pi, em pé se possível — a antena do ZBDongle-E é articulada, deixe-a
   vertical.
4. Ethernet ao roteador; fonte oficial; tudo no nobreak.
5. `./instalar.sh` e siga o [guia de instalação](instalacao-docker.md).

## O ESP32 neste desenho

O ESP32 não é mais a central (o contrato v1 pesa demais para ele), mas
continua no catálogo para dois papéis:

- **Painel de parede**: ESP32-S3 + display touch de 4–7", rodando o mesmo
  PWA como cliente da central (via navegador embarcado ou LVGL falando o
  contrato).
- **Ponte de E/S**: relé de portão, dimmer 0–10 V, sensores com fio —
  coisas que o Zigbee não alcança — publicando MQTT no broker da central.
