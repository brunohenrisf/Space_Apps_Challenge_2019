# MikroTik — integração e topologia

## Topologia

```
   Internet ──▶ [ ether1 ] MikroTik [ ether2 ] ──▶ UniFi ──▶ ((Wi-Fi)) ──▶ celulares
                 DHCP client            bridge-lan (Hotspot)
                 (WAN)                  10.10.0.1/24
```

- **ether1** — WAN, recebe o link por **DHCP client** (`/ip dhcp-client`).
- **ether2** — LAN, numa **bridge** (`bridge-lan`) que vai para a **UniFi**. A
  UniFi entrega o Wi-Fi (modo AP/bridge); o MikroTik roteia, faz NAT, entrega
  DHCP aos clientes e roda o **Hotspot** (captive portal).

Script pronto: [`../mikrotik/setup.rsc`](../mikrotik/setup.rsc) (já no **modo
hotspot**; o bloco PPPoE fica ao final como alternativa).

---

## Modo de acesso (`ACCESS_MODE`)

Padrão: **`hotspot`** (público com celular). O `pppoe` fica como alternativa.

### `hotspot` (padrão)
- O celular conecta no Wi-Fi, recebe IP por DHCP e cai no **captive portal**,
  que o redireciona para a **página de compra**.
- **Cortesia de 3 min:** ao conectar, o backend libera o dispositivo com um
  **`/ip/hotspot/ip-binding` `type=bypassed`** (internet ampla) + um
  `/system/scheduler` que remove o bypass ao fim do tempo. É "internet ampla"
  de propósito: para pagar o Pix a pessoa abre o **app do banco**, que precisa
  de rede aberta — não dá para prever/liberar todos os bancos no walled-garden.
- **Pagamento confirmado:** o backend cria **`/ip/hotspot/user`** com
  **`limit-uptime`** (tempo do voucher, nativo) preso ao **MAC** (1 dispositivo)
  e **encerra a cortesia** daquele MAC. O portal então faz o **login do
  dispositivo** com as credenciais retornadas (ver "Handoff" abaixo), e a partir
  daí o `limit-uptime` conta o tempo do voucher — os 3 min de cortesia **não são
  descontados**, pois o relógio só corre enquanto autenticado como o voucher.

### `pppoe` (alternativa)
- Cria **`/ppp/secret`** por voucher (**`only-one=yes`** → 1 dispositivo) +
  **`/system/scheduler`** que encerra ao fim do tempo (o secret não tem limite
  nativo). Indicado quando cada ponto é um **roteador/CPE que disca PPPoE**.

> ⚠️ Em **PPPoE puro o celular não é redirecionado** (sem discar não recebe IP),
> então o "auto-redirect + cortesia" não funciona. Por isso o padrão é
> `hotspot`. Não use PPPoE e Hotspot juntos na mesma LAN.

### Handoff: portal → login do Hotspot
Depois que o status vira `paid`, o portal recebe `voucherLogin`/`voucherPassword`
e redireciona o dispositivo para o login do Hotspot, autenticando-o de forma
transparente:

```
http://10.10.0.1/login?username=<voucherLogin>&password=<voucherPassword>&dst=<url_original>
```

Com `mac-cookie` habilitado no profile do Hotspot, reconexões do mesmo aparelho
reautenticam sozinhas enquanto durar o voucher.

---

## O que o backend executa no roteador

| Ação | Modo pppoe | Modo hotspot |
|---|---|---|
| Criar voucher | `/ppp/secret/add` + `/system/scheduler/add` | `/ip/hotspot/user/add` (`limit-uptime`) |
| 1 dispositivo | perfil `only-one=yes` | `mac-address` no user |
| Encerrar no tempo | scheduler derruba + desabilita | `limit-uptime` nativo |
| Revogar | remove secret + active + scheduler | remove user + active |
| Cortesia (3 min) | não se aplica | `ip-binding type=bypassed` + scheduler |
| Diagnóstico | `/ppp/active/print` | `/ip/hotspot/active/print` |

Implementação: [`../backend/src/services/mikrotik.ts`](../backend/src/services/mikrotik.ts).

---

## Configuração da API RouterOS

1. No `setup.rsc`, ajuste o usuário `api` (senha) e o `/ip service set api
   address=` para a faixa do backend.
2. No backend (`.env`):
   ```
   ACCESS_MODE=pppoe
   MIKROTIK_HOST=10.10.0.1
   MIKROTIK_PORT=8728
   MIKROTIK_USER=api
   MIKROTIK_PASSWORD=...
   MIKROTIK_PPPOE_PROFILE=voucher-default
   ```
3. Sem `MIKROTIK_HOST`/`MIKROTIK_PASSWORD`, o serviço roda em **modo mock**
   (loga as ações sem conectar) — útil para desenvolver sem o hardware.

Teste rápido de conexão: `GET /api/status` → retorna `accessMode` e a
identidade do roteador (`pingRouter`).

---

## Notas de produção

- **RADIUS / User Manager**: para PPPoE com controle de tempo/banda mais
  robusto e relatórios, considere o User Manager como servidor RADIUS em vez do
  scheduler por voucher.
- **TLS**: habilite `api-ssl` (porta 8729) e `MIKROTIK_TLS=true` se o backend
  não estiver na mesma LAN do roteador.
- **Persistência**: os vouchers hoje vivem em memória no backend; migrar para
  banco garante reprovisionar/reconciliar após reinício.
