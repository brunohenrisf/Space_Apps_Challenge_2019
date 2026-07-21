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
│   ├── prisma/schema.prisma #  Modelos: Plan, Order, AppSettings
│   ├── src/
│   │   ├── server.ts       #   Express: serve o protótipo + API; seed no boot
│   │   ├── config.ts       #   Leitura do .env (MikroTik, Efí, cortesia, DB)
│   │   ├── db.ts           #   Cliente Prisma
│   │   ├── auth.ts         #   Login: hash scrypt, token HMAC, middleware
│   │   ├── store.ts        #   Repositório (planos, pedidos, relatório, settings)
│   │   ├── plans.ts        #   Catálogo padrão (seed)
│   │   ├── routes/api.ts   #   /plans /courtesy /checkout /webhook /admin/* /status
│   │   └── services/
│   │       ├── efi.ts      #   Pix (SDK Efí) — usa settings do banco
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
Login real (via `/api/admin/login`; padrão de dev: `organizador@evento.com` /
`conecta123`) e o painel do organizador com **Dashboard, Eventos, Planos,
Vendas, Relatórios e Configurações**. Aberto como arquivo (sem backend), entra
em modo demonstração. Responsivo:
menu lateral no desktop, barra inferior no celular. Destaques:

- **Planos:** gerenciar os planos da conta (criar, pausar).
- **Vendas / Relatórios:** resumo, filtros, gráficos e exportação **CSV**
  (dados ao vivo via `/api/admin/...`, escopados à conta autenticada).
- **Configurações:** **conta Efí** + **gerador de configuração da MikroTik** —
  preencha e baixe o `.rsc` e o `login.html` prontos para importar no roteador,
  **sem digitar comandos**. Cada conta = um cliente com seu equipamento.

## Rodar servido pelo backend (opcional)

```bash
cd backend
cp .env.example .env      # já vem com DATABASE_URL=SQLite (dev, sem serviço externo)
npm install
npm run dev               # roda `prisma db push` e sobe em http://localhost:3000
```

O banco no dev é **SQLite** (arquivo `prisma/dev.db`, criado no boot); em
produção o `docker-compose` usa **Postgres**. Sem chaves de Efí/MikroTik, roda
em modo mock. Planos são semeados na primeira execução.

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
- [x] Persistência (PostgreSQL + Prisma) para planos, pedidos, vendas e settings
- [x] Autenticação do painel (login + token; rotas `/admin/*` protegidas)
- [x] Multi-tenant por **conta** (usuário da plataforma): Efí, MikroTik/rede e
      planos/vendas por conta; portal serve a conta por `?ac=<slug>`
