# Deploy do ConectaVoucher na VPS (Docker + Postgres + Caddy + Cloudflare)

Backend central na nuvem (padrão SaaS): um container serve **portal + painel +
API**, com **Postgres** ao lado e **Caddy** para TLS. Cada evento tem só a
**MikroTik + UniFi**; a MikroTik se conecta ao VPS por um **túnel WireGuard**,
por onde o backend provisiona o Hotspot.

```
  Cloudflare (DNS)
        │
     Caddy (80/443, TLS) ──► cv-app:3000  (portal + painel + /api)
                                 │ rede interna
                              cv-db (Postgres 16)
  cv-app ──(WireGuard, via host)──► MikroTik 10.20.0.2:8728  (RouterOS API)
                                          │ (evento)
                                       UniFi ──► Wi-Fi ──► celulares
```

Arquivos: [`../Dockerfile`](../Dockerfile), [`../docker-compose.yml`](../docker-compose.yml),
[`../Caddyfile`](../Caddyfile), [`../.env.vps.example`](../.env.vps.example),
[`../scripts/setup-env.sh`](../scripts/setup-env.sh).

---

## 1) Subir o stack

```bash
git clone https://github.com/brunohenrisf/space_apps_challenge_2019.git /opt/cv
cd /opt/cv/voucher-saas

# gera o .env com segredos (CV_DB_PASSWORD, EFI_WEBHOOK_TOKEN)
CV_HOST=conectavoucher.seudominio.com bash scripts/setup-env.sh

# preencha no .env: EFI_CLIENT_ID/SECRET, EFI_PIX_KEY, MIKROTIK_PASSWORD
# e coloque o certificado da Efí:
mkdir -p certs && cp /caminho/efi.p12 certs/efi.p12

docker compose up -d --build
docker compose ps
curl -s http://localhost:3000/health; echo     # {"ok":true}
```

No boot o container roda **`prisma db push`** (cria/atualiza o schema no
Postgres, idempotente) e sobe o backend na porta **3000** (proxied pelo Caddy).
Planos, pedidos, vendas e configurações ficam no **Postgres** — sobrevivem a
reinícios.

> **Login do painel:** o `setup-env.sh` gera `ADMIN_EMAIL`/`ADMIN_PASSWORD` e
> os imprime; o admin é criado no primeiro boot. Guarde a senha e troque depois.

## 2) Cloudflare (DNS + TLS)

- **DNS:** registro `conectavoucher.seudominio.com` → IP do VPS.
- **TLS automático (mais simples):** deixe o DNS **"DNS only"** (nuvem cinza) e
  abra as portas 80/443 — o Caddy emite o certificado sozinho.
- **Proxied (nuvem laranja):** gere um **Origin Certificate** no Cloudflare,
  monte em `./certs/origin.pem` e `./certs/origin.key`, e no `Caddyfile` troque
  o TLS automático por `tls /certs/origin.pem /certs/origin.key`.

Confira: `curl -sI https://conectavoucher.seudominio.com/ | head -1` → `HTTP/2 200`.

## 3) Webhook da Efí

Com o domínio no ar, aponte o webhook da chave Pix para o backend:

```bash
curl -X POST https://conectavoucher.seudominio.com/api/efi/webhook
```

Isso registra `.../api/webhook/efi?hmac=<EFI_WEBHOOK_TOKEN>` na Efí (ver
[`EFI.md`](EFI.md)).

## 4) WireGuard: VPS ↔ MikroTik

A MikroTik está na LAN do evento; o VPS a alcança por um túnel. Passo a passo em
[`../mikrotik/wireguard.rsc`](../mikrotik/wireguard.rsc). Resumo:

1. **No VPS:** gere as chaves (`wg genkey | tee vps.key | wg pubkey`), crie
   `/etc/wireguard/wg0.conf` (Address `10.20.0.1/24`, ListenPort `51820`, o
   `PostUp` de MASQUERADE — essencial p/ os containers), suba com
   `wg-quick up wg0` e abra a UDP `51820`.
2. **Na MikroTik (RouterOS 7):** rode o `wireguard.rsc` (cria a interface,
   o IP `10.20.0.2`, o peer = VPS e libera a API só pelo túnel). Ele imprime a
   **chave pública** da MikroTik.
3. **No VPS:** cadastre essa chave como `[Peer]` (AllowedIPs `10.20.0.2/32`) e
   `wg syncconf`/`wg-quick down/up`.
4. **Teste:** `ping 10.20.0.2` e `nc -vz 10.20.0.2 8728` a partir do VPS.
5. No `.env`, `MIKROTIK_HOST=10.20.0.2`. Reinicie: `docker compose up -d`.
   Valide: `GET /api/status` deve mostrar o roteador conectado (`pingRouter`).

> **Multi-eventos:** cada MikroTik vira um peer com um IP `10.20.0.x`. A escolha
> de qual roteador provisionar (por evento) entra junto com o multi-tenant.

## Operação

```bash
# nova versão
cd /opt/cv/voucher-saas && git pull --ff-only && docker compose up -d --build

# logs / status
docker compose logs -f cv-app

# backup do banco
docker exec cv-db pg_dump -U conectavoucher conectavoucher > cv-$(date +%F).sql

# parar (mantém os volumes)
docker compose down
```
