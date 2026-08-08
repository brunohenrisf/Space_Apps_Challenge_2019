# O PWA no iPhone: o problema que decide o projeto

Leia esta página antes de prometer prazo ao cliente. É o único ponto do
sistema em que uma decisão de infraestrutura muda o que o aplicativo
consegue fazer.

## O que acontece

O Safari só habilita Service Worker, Cache API e Web Push em **contexto
seguro** — `https://` ou `localhost`. Um ESP32 servindo em
`http://nexo.local` não é contexto seguro. O iOS não avisa: o registro
simplesmente falha e o app fica sem cache offline.

O que sobrevive e o que não, sobre `http://` puro:

| Recurso | Sobre `http://nexo.local` |
|---|---|
| Adicionar à Tela de Início | **funciona** |
| Abrir em tela cheia, sem barra do Safari (`display: standalone`) | **funciona** |
| Ícone, nome e splash do manifest | **funciona** |
| Service Worker / cache offline | **não** |
| Web Push (iOS 16.4+) | **não** |
| `navigator.share`, `getUserMedia` | **não** |

Vale pesar o que isso custa de verdade: o app **só serve dentro de casa**.
Fora da rede não há o que controlar. O cache offline melhora a partida a
frio de uns 400 ms para uns 80 ms — é conforto, não função.

## As quatro saídas, em ordem de recomendação

### 1. TLS terminado no hub (recomendado quando o hub é um Raspberry Pi)

O hub que roda o Zigbee2MQTT quase sempre é um Linux com CPU sobrando.
Ponha um Caddy ou nginx nele, com um certificado, encaminhando para o
ESP32:

```
casa.exemplo.com.br {
    reverse_proxy 192.168.0.44:80
}
```

O ESP32 continua em HTTP puro — não gasta os ~40 KB de RAM e o tempo de
CPU que o TLS custaria nele, e o handshake fica com quem tem folga.

Para o certificado sem expor nada à internet, use desafio DNS-01 com um
domínio seu, apontando um registro A para o IP da LAN. O Caddy resolve
com uma linha, e a renovação só precisa de internet nos poucos segundos
em que ocorre.

### 2. Autoridade certificadora própria, instalada nos aparelhos

Para uma casa realmente sem internet nenhuma. Gere uma CA, emita um
certificado para `nexo.local`, e instale a CA em cada iPhone:

```bash
# CA da instalação (uma vez, guarde a chave em lugar seguro)
openssl req -x509 -newkey rsa:4096 -sha256 -days 3650 -nodes \
  -keyout ca.key -out ca.crt -subj "/CN=Nexo CA/O=Volttex"

# certificado do painel
openssl req -newkey rsa:2048 -nodes -keyout nexo.key -out nexo.csr \
  -subj "/CN=nexo.local"
openssl x509 -req -in nexo.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out nexo.crt -days 825 -sha256 \
  -extfile <(printf "subjectAltName=DNS:nexo.local,IP:192.168.0.44")
```

No iPhone, instalar `ca.crt` **não basta**. São dois passos, e esquecer o
segundo é o erro clássico:

1. Ajustes → Geral → VPN e Gerenciamento de Dispositivo → instalar o perfil.
2. Ajustes → Geral → Sobre → **Ajustes de Confiança de Certificado** →
   ligar a chave da sua CA.

Custo: uma visita por aparelho novo, e trocar o certificado a cada 825
dias (limite que o iOS impõe).

### 3. Aceitar o app sem cache offline

Não fazer nada. `http://nexo.local`, adicionar à tela de início, pronto.
O app abre em tela cheia, com ícone próprio, e funciona. É a opção certa
para um piloto ou para a primeira casa — dá para subir para a opção 1
depois, sem tocar numa linha da interface.

O código já trata esse caso: o registro do service worker é condicionado
a `window.isSecureContext`, então nada estoura no console.

### 4. TLS no próprio ESP32

Possível — `esp-tls` faz — mas o handshake fica em torno de 2 a 4 s no
ESP32 clássico, cada conexão come RAM, e o WebSocket sobre TLS deixa o
painel sem fôlego para atender dois telefones ao mesmo tempo. Só considere
se não houver hub Linux na instalação e a opção 2 estiver descartada.

## Fixar o endereço, em qualquer das opções

O mDNS (`nexo.local`) funciona bem no iOS, mas depende de multicast, que
muitos roteadores domésticos filtram entre banda de 2,4 e 5 GHz. Na
instalação, faça as duas coisas:

- reserva de DHCP no roteador, fixando o IP do ESP32 pelo MAC;
- `MDNS_NOME` configurado, para quem preferir o nome.

Se o cliente reclamar que "às vezes não abre", é quase sempre o multicast
entre as duas bandas do Wi-Fi. Um SSID único para as duas bandas resolve.

## Instalar no iPhone

1. Safari (não Chrome — no iOS só o Safari instala PWA), abrir
   `http://nexo.local` ou o IP fixo.
2. Botão Compartilhar → **Adicionar à Tela de Início**.
3. O ícone entra na tela inicial; abrir por ele dá tela cheia.

Vale avisar o cliente: se ele abrir pelo Safari em vez do ícone, vê a
barra de endereço e acha que "está diferente". É a mesma coisa.
