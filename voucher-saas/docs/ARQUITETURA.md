# Arquitetura — ConectaVoucher

## Visão geral

```
  ┌──────────────┐        Wi-Fi        ┌───────────────┐
  │  Dispositivo │  ───────────────▶   │   MikroTik    │
  │  do visitante│   (hotspot/PPPoE)   │  (RouterOS)   │
  └──────┬───────┘                     └───────┬───────┘
         │ redirect p/ portal                  │ RouterOS API
         ▼                                     ▼
  ┌──────────────────────────────────────────────────────┐
  │                Backend (Node + TypeScript)            │
  │  /plans  /courtesy  /checkout  /webhook/efi           │
  └───────┬───────────────────────────────┬──────────────┘
          │ cria cobrança Pix             │ confirma pagamento
          ▼                               │ (webhook)
     ┌─────────┐                          │
     │  Efí    │  ────────────────────────┘
     │  (Pix)  │
     └─────────┘
```

## Componentes

| Componente | Papel |
|---|---|
| **MikroTik (RouterOS)** | Hotspot que redireciona ao portal; walled-garden; cortesia; criação do usuário PPPoE com limite de tempo. |
| **Backend Node/TS** | Regras de negócio, catálogo de planos, criação da cobrança Pix, recebimento do webhook e provisionamento no MikroTik. |
| **Efí (Pix)** | Geração da cobrança/QR Code e notificação do pagamento por webhook. |
| **Portal (prototype)** | Página mobile de compra exibida no dispositivo do visitante. |
| **Painel** | Visão do organizador: vendas, planos, faturamento, status do roteador. |

## Regras de negócio

- **1 voucher = 1 dispositivo** pelo tempo contratado → no MikroTik, o profile
  PPPoE limita a **1 sessão simultânea** e usa `uptime-limit`.
- **Cortesia de 3 minutos** (`COURTESY_WINDOW_SECONDS`) liberada só para pagar.
  Ao expirar sem pagamento, o acesso é cortado.
- Se o pagamento é confirmado, **a cortesia não é descontada** do tempo do
  voucher — o cliente PPPoE é criado com o tempo cheio do plano.

## Fluxo de chamadas (API)

1. `POST /api/courtesy { mac }` → libera a janela de cortesia no MikroTik.
2. `GET  /api/plans` → catálogo de vouchers.
3. `POST /api/checkout { planId, mac }` → cria a cobrança Pix na Efí; retorna
   `txid`, `qrcodeImage` e `pixCopiaECola`.
4. Confirmação do pagamento (dois caminhos):
   - **Webhook** `POST /api/webhook/efi` (principal) → cria o usuário PPPoE.
   - **Polling** `GET /api/checkout/:txid/status` (fallback) → o portal
     consulta até virar `paid`.
5. Com `status = paid` e `voucherLogin`, o dispositivo já está conectado.

## Integração Efí (Pix) — a implementar

- SDK oficial: `sdk-node-apis-efi`.
- Credenciais: `EFI_CLIENT_ID`, `EFI_CLIENT_SECRET`, certificado `.p12`.
- `pixCreateImmediateCharge` (cob) + `pixGenerateQRCode`.
- Configurar o webhook da chave Pix apontando para `PUBLIC_URL/api/webhook/efi`.
- Validar autenticidade do webhook (mTLS / token) antes de provisionar.

## Integração MikroTik (RouterOS) — a implementar

- Lib: `node-routeros` (API na porta `8728`, ou `8729` com TLS).
- Hotspot com **walled-garden** liberando o domínio do portal e os IPs da Efí.
- Cortesia: liberar/expirar o MAC no hotspot.
- Provisionamento: `/ppp/secret/add` com `uptime-limit` e profile de 1 sessão.

## Evolução para produção

- **Banco**: PostgreSQL + Prisma (hoje os pedidos ficam em memória).
- **Multi-tenant**: organizador → eventos → planos → conta Efí própria.
- **Segurança**: autenticação do painel, rate limit, validação estrita do webhook.
- **Observabilidade**: logs de vendas, reconciliação Pix × sessões PPPoE.
