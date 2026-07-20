# Efí (Pix) — integração

O backend cria a cobrança Pix, gera o QR Code e recebe a confirmação do
pagamento por webhook, usando o SDK oficial **`sdk-node-apis-efi`**.

Implementação: [`../backend/src/services/efi.ts`](../backend/src/services/efi.ts).

> Sem `EFI_CLIENT_ID` / `EFI_CLIENT_SECRET` / `EFI_CERT_PATH`, o serviço roda em
> **modo mock** (Pix fictício) — o fluxo funciona para desenvolvimento sem
> credenciais.

---

## 1. Credenciais e certificado

1. Crie uma aplicação em <https://dev.efipay.com.br> e habilite a **API Pix**.
2. Anote o **Client ID** e o **Client Secret** (há um par para *homologação*
   e outro para *produção*).
3. Baixe o **certificado `.p12`** da conta e salve em `backend/certs/`.
4. Cadastre (ou use) uma **chave Pix** na conta Efí — é ela que recebe.

No `backend/.env`:

```
EFI_ENV=sandbox              # ou "producao"
EFI_CLIENT_ID=Client_Id_...
EFI_CLIENT_SECRET=Client_Secret_...
EFI_CERT_PATH=./certs/efi-homolog.p12
EFI_PIX_KEY=sua-chave-pix
EFI_WEBHOOK_TOKEN=um-segredo-forte
```

---

## 2. Fluxo

| Passo | Chamada |
|---|---|
| Criar cobrança | `pixCreateImmediateCharge` (`calendario`, `valor`, `chave`) |
| Gerar QR | `pixGenerateQRCode({ id })` → `qrcode` (copia e cola) + `imagemQrcode` (data URI) |
| Consultar status | `pixDetailCharge({ txid })` → `ATIVA` / `CONCLUIDA` (polling de fallback) |
| Configurar webhook | `pixConfigWebhook({ chave }, { webhookUrl })` |

O portal exibe o QR/copia-e-cola e faz **polling** em
`GET /api/checkout/:txid/status`; em paralelo, a Efí chama o webhook.

---

## 3. Webhook

A Efí **acrescenta `/pix`** à URL configurada. O backend expõe:

```
POST /api/webhook/efi/pix     (chamado pela Efí)
POST /api/webhook/efi         (mesma lógica; útil p/ testes)
```

### Autenticação sem mTLS (HMAC na query)
Para não exigir mTLS, configuramos a URL com `?hmac=<EFI_WEBHOOK_TOKEN>`; a Efí
repete essa query em cada notificação e o backend valida
(`verifyWebhook`). Em testes locais também aceita o header `x-efi-token`.

Configurar o webhook (com o backend publicado em `PUBLIC_URL`):

```
curl -X POST $PUBLIC_URL/api/efi/webhook
```

> Em produção, a URL precisa ser **HTTPS pública** e alcançável pela Efí.
> Para mTLS "de verdade" (em vez do HMAC), veja a doc da Efí sobre
> `skip-mTLS` e o certificado do webhook.

---

## 4. Ao confirmar o pagamento

O webhook chama `provisionVoucher` (MikroTik) e o pedido passa a `paid` com
`voucherLogin`/`voucherPassword`. O portal detecta via polling e faz o
**login do dispositivo no Hotspot** (ver [`MIKROTIK.md`](MIKROTIK.md)).
