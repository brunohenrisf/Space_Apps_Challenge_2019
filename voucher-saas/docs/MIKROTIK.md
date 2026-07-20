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

Script pronto: [`../mikrotik/setup.rsc`](../mikrotik/setup.rsc).

---

## Fluxo no Hotspot (captive portal)

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

| Ação | Comando RouterOS |
|---|---|
| Criar voucher | `/ip/hotspot/user/add` (`limit-uptime`) |
| 1 dispositivo | `mac-address` no user |
| Encerrar no tempo | `limit-uptime` nativo |
| Revogar | remove user + active |
| Cortesia (3 min) | `ip-binding type=bypassed` + scheduler |
| Diagnóstico | `/ip/hotspot/active/print` |

Implementação: [`../backend/src/services/mikrotik.ts`](../backend/src/services/mikrotik.ts).

---

## Configuração da API RouterOS

1. No `setup.rsc`, ajuste o usuário `api` (senha) e o `/ip service set api
   address=` para a faixa do backend.
2. No backend (`.env`):
   ```
   MIKROTIK_HOST=10.10.0.1
   MIKROTIK_PORT=8728
   MIKROTIK_USER=api
   MIKROTIK_PASSWORD=...
   MIKROTIK_HOTSPOT_PROFILE=default
   ```
3. Sem `MIKROTIK_HOST`/`MIKROTIK_PASSWORD`, o serviço roda em **modo mock**
   (loga as ações sem conectar) — útil para desenvolver sem o hardware.

Teste rápido de conexão: `GET /api/status` → retorna a identidade do roteador
(`pingRouter`) e a janela de cortesia.

---

## Notas de produção

- **RADIUS / User Manager**: para relatórios e controle de banda mais robustos,
  considere o User Manager como servidor RADIUS do Hotspot.
- **TLS**: habilite `api-ssl` (porta 8729) e `MIKROTIK_TLS=true` se o backend
  não estiver na mesma LAN do roteador.
- **Persistência**: os vouchers hoje vivem em memória no backend; migrar para
  banco garante reprovisionar/reconciliar após reinício.
