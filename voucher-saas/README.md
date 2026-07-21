# ConectaVoucher

SaaS mobile para **venda de vouchers de acesso à internet em eventos**. O
visitante conecta no Wi-Fi, é direcionado automaticamente para a página de
compra, paga via **Pix (Efí)** e o acesso é liberado automaticamente por meio
de um **usuário Hotspot criado no MikroTik** com limite de tempo igual ao voucher.

> ⚠️ **Status: esqueleto para validação.** Esta entrega foca no **protótipo
> HTML mobile-first** que demonstra todo o fluxo de telas, mais um **scaffold
> do backend em Node.js + TypeScript** com os contratos de API e os pontos de
> integração já marcados (`// TODO:BACKEND`). As integrações reais com Efí e
> MikroTik ainda não estão implementadas.

---

## Como está organizado

```
voucher-saas/
├── prototype/              # Esqueleto HTML para validar (abra no navegador)
│   ├── index.html          #   Entrada: escolhe acesso Cliente ou Administrador
│   ├── portal.html         #   ACESSO CLIENTE — portal captivo: conectar → planos → Pix → sucesso
│   ├── admin.html          #   ACESSO ADMIN — login + dashboard, eventos, planos, vendas, config
│   └── assets/
│       ├── css/app.css     #   Design system mobile-first
│       ├── css/admin.css   #   Shell do painel (sidebar/bottom-nav responsivo)
│       ├── js/flow.js      #   Fluxo do cliente, timer de cortesia e simulações
│       └── js/admin.js     #   Login simulado e navegação do painel
├── backend/                # Backend Node.js + TypeScript
│   ├── src/
│   │   ├── server.ts       #   Express: serve o protótipo + API
│   │   ├── config.ts       #   Leitura do .env (MikroTik, Efí, cortesia)
│   │   ├── plans.ts        #   Catálogo de planos
│   │   ├── routes/api.ts   #   /plans /courtesy /checkout /webhook /status
│   │   └── services/
│   │       ├── efi.ts      #   Pix (SDK Efí) — implementado
│   │       └── mikrotik.ts #   RouterOS API (Hotspot) — implementado
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── mikrotik/
│   ├── setup.rsc           # Config do RouterOS: ether1 WAN, ether2 Hotspot p/ UniFi
│   └── wireguard.rsc       # Túnel WireGuard MikroTik ↔ VPS
├── Dockerfile              # Imagem de produção (backend serve portal + painel + API)
├── docker-compose.yml      # Stack VPS: app + Postgres + Caddy
├── Caddyfile               # Reverse proxy + TLS
├── .env.vps.example        # Variáveis de produção
├── scripts/setup-env.sh    # Gera o .env com segredos
└── docs/
    ├── ARQUITETURA.md      # Fluxo detalhado e decisões técnicas
    ├── MIKROTIK.md         # Topologia, Hotspot e integração
    ├── EFI.md              # Credenciais, cobrança Pix e webhook
    └── DEPLOY.md           # Deploy na VPS (Docker + Cloudflare + WireGuard)
```

---

## Validar o protótipo (sem instalar nada)

Abra **`prototype/index.html`** no navegador (de preferência no modo
responsivo/celular). A tela de entrada oferece os **dois acessos do portal**:

### Acesso do Cliente (`portal.html`)
Portal captivo mobile. Use a **barra escura no topo** para pular entre estados:

- **1·Conectar** → tela de boas-vindas com a cortesia de 3 min correndo
- **2·Planos** → escolha do voucher
- **3·Pix** → tela de pagamento (QR + copia e cola)
- **✓ Simular pagto** → simula o webhook confirmando → tela de sucesso
- **⏱ Estourar tempo** → simula a cortesia acabando sem pagamento

### Acesso do Administrador (`admin.html`)
Login simulado (é só clicar em **Entrar**) e o painel do organizador com
**Dashboard, Eventos, Planos, Vendas e Configurações** (Efí + MikroTik).
Responsivo: menu lateral no desktop, barra inferior no celular.

## Rodar servido pelo backend (opcional)

```bash
cd backend
cp .env.example .env      # preencha depois com as chaves reais
npm install
npm run dev               # http://localhost:3000  (portal) e /admin.html
```

---

## O fluxo do usuário

1. **Conecta no Wi-Fi** → o hotspot do MikroTik redireciona para o portal.
2. **Cortesia de 3 min** liberada apenas para navegar no portal e pagar
   (walled-garden mantém portal + Efí sempre acessíveis).
3. **Escolhe o voucher** (por tempo) e **paga no Pix** gerado pela Efí.
4. **Efí confirma** o pagamento por **webhook** → o backend cria o usuário
   **Hotspot no MikroTik** com `limit-uptime` = tempo do voucher, preso ao
   **MAC** (1 dispositivo por voucher).
5. **Acesso liberado.** Se já pagou, os 3 min de cortesia **não são
   descontados** do tempo contratado. Se a cortesia acabar sem pagamento, o
   acesso é interrompido.

Detalhes técnicos, regras de negócio e as chamadas de API em
[`docs/ARQUITETURA.md`](docs/ARQUITETURA.md).

## Integração MikroTik

O backend provisiona o voucher no roteador via **RouterOS API** (`node-routeros`)
usando o **Hotspot** (captive portal para celular):

- Cria `/ip/hotspot/user` com `limit-uptime` nativo, preso ao **MAC**
  (1 dispositivo por voucher).
- Faz o **auto-redirect ao conectar** e a **cortesia de 3 min** (via
  `ip-binding bypassed`, para o cliente pagar pelo app do banco).

> Sem `MIKROTIK_HOST`/`MIKROTIK_PASSWORD`, roda em **modo mock** (loga os
> comandos sem conectar). Topologia e detalhes em
> [`docs/MIKROTIK.md`](docs/MIKROTIK.md); config do roteador em
> [`mikrotik/setup.rsc`](mikrotik/setup.rsc).

## Deploy (produção)

Backend central na VPS via **Docker** (o container serve portal + painel + API),
com **Postgres** e **Caddy** (TLS), atrás do **Cloudflare**. Cada evento tem só a
MikroTik + UniFi; a MikroTik se conecta ao VPS por um **túnel WireGuard**, por
onde o backend provisiona o Hotspot.

```bash
cd voucher-saas
CV_HOST=conectavoucher.seudominio.com bash scripts/setup-env.sh
docker compose up -d --build
```

Passo a passo (Cloudflare, webhook e WireGuard) em [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Próximos passos

- [x] Implementar a RouterOS API (`node-routeros`) em `services/mikrotik.ts`
- [x] Integrar a Efí (SDK `sdk-node-apis-efi`) em `services/efi.ts` + webhook
- [x] Auto-login do portal no Hotspot após o pagamento
- [x] Empacotar para deploy (Docker + Compose + Caddy + WireGuard) na VPS
- [ ] Persistência (PostgreSQL + Prisma) para eventos, planos, pedidos e vouchers
- [ ] Multi-tenant: cada organizador com seus eventos, planos e conta Efí
- [ ] Autenticação do painel do organizador
