# MikroTik — integração e topologia

## Topologia

```
   Internet ──▶ [ ether1 ] MikroTik [ ether2 ] ──▶ UniFi ──▶ ((Wi-Fi)) ──▶ clientes
                 DHCP client            bridge-lan (PPPoE server)
                 (WAN)                  10.10.0.1/24
```

- **ether1** — WAN, recebe o link por **DHCP client** (`/ip dhcp-client`).
- **ether2** — LAN, numa **bridge** (`bridge-lan`) que vai para a **UniFi**. A
  UniFi entrega o Wi-Fi; o MikroTik roteia, faz NAT e autentica.

Script pronto: [`../mikrotik/setup.rsc`](../mikrotik/setup.rsc).

---

## Dois modos de acesso (`ACCESS_MODE`)

O backend provisiona o voucher de duas formas. Escolha no `.env`.

### `pppoe` (padrão — sua topologia)
- No pagamento, o backend cria um **`/ppp/secret`** único (login + senha) no
  perfil `voucher-default` (**`only-one=yes`** → 1 dispositivo por voucher).
- O `/ppp/secret` **não tem limite de tempo nativo**, então o backend também
  cria um **`/system/scheduler`** que, ao fim do tempo do plano, derruba a
  sessão (`/ppp/active/remove`) e desabilita o secret. Assim o próprio MikroTik
  encerra o acesso mesmo se o backend estiver offline.
- Indicado quando cada ponto de acesso é um **roteador/CPE que disca PPPoE**.

### `hotspot` (recomendado se os clientes são celulares)
- Cria **`/ip/hotspot/user`** com **`limit-uptime`** (limite de tempo **nativo**).
- É o único modo que entrega o requisito de **auto-redirect ao conectar** e a
  **cortesia de 3 minutos**, porque o celular recebe IP via DHCP e cai no
  captive portal.

> ⚠️ **Importante:** em **PPPoE puro, um celular não é redirecionado** para o
> portal — sem discar PPPoE ele não recebe IP nem conectividade, então não há
> página para exibir. O "conectou → página de compra + 3 min de cortesia"
> depende do **Hotspot**. Por isso os dois modos vêm implementados: rode em
> `pppoe` para CPEs que discam, ou `hotspot` para o público com celular.
> Não use PPPoE e Hotspot juntos na mesma LAN.

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
