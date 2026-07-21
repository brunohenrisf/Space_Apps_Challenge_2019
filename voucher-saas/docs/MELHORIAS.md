# ConectaVoucher — 10 melhorias (roadmap priorizado)

Avaliação da aplicação após o refinamento. As três primeiras são o que falta
para ficar **production-ready**; as demais aumentam robustez e experiência.

## Essenciais (produção)

1. **Persistência (PostgreSQL + Prisma).** ✅ **Feito.**
   Planos, pedidos/vendas e configurações agora ficam no banco (Prisma; SQLite
   no dev, Postgres em produção) e sobrevivem a reinícios. Falta ainda modelar
   `Event`/`Voucher` dedicados quando o multi-tenant entrar.

2. **Autenticação real do painel.** ✅ **Feito.**
   Login com senha (scrypt) + token assinado (HMAC); rotas `/api/admin/*` e
   `/api/efi/webhook` protegidas (401 sem token). Falta: troca de senha pelo
   painel, expiração/renovação e rate limiting no login.

3. **Multi-tenant + cadastro de contas.** ✅ **Feito.**
   Isolamento **entre contas** (usuários da plataforma): cada conta tem sua Efí,
   sua MikroTik/rede e seus planos/vendas. Portal serve a conta por `?ac=<slug>`.
   **Cadastro self-serve** (`/signup`, gate por `ALLOW_SIGNUP`) e **troca de
   senha** no painel. Falta: verificação de e-mail/anti-abuso, múltiplos
   usuários por conta e billing.

## Robustez

4. **Idempotência da cortesia + reconciliação.** ✅ **Feito.**
   `grantCourtesyAccess` agora é idempotente por MAC (remove o `ip-binding` e o
   scheduler anteriores antes de recriar). Um job de reconciliação
   (`services/jobs.ts`, a cada 60s) expira pendentes antigos (`expireStalePending`)
   e reprovisiona pedidos **pagos sem voucher** (`paidWithoutVoucher`) para que
   nenhuma falha transitória do túnel deixe o cliente pago sem acesso.

5. **CRUD real de planos.** ✅ **Feito.**
   Planos deixaram de ser fixos no código: criar/editar/pausar/**excluir**
   (`DELETE /api/admin/plans/:id`) pela interface, persistidos por conta. Não há
   modelo de "evento" — por decisão de produto o isolamento é só **entre contas**
   (cada cliente usa seu equipamento em vários eventos, sem isolar por evento).

6. **Robustez da integração RouterOS.** ✅ **Feito.**
   `services/mikrotik.ts` faz **retry com backoff** (3 tentativas,
   `300·2^tentativa` ms) em cada comando; combinado com o job de reconciliação
   (item 4), o pagamento nunca fica sem liberar acesso por falha transitória.

7. **Segurança do webhook e das rotas públicas.** ✅ **Feito.**
   Webhook validado por HMAC (`?hmac=` ou header `x-efi-token`) contra o segredo
   da conta; **rate limiting** em `/admin/login` (10/5min) e `/signup` (5/10min);
   headers de segurança, `trust proxy` e `express.json({limit:'256kb'})`. mTLS da
   Efí continua no roadmap (o SDK usa o certificado `.p12` da conta).

## Experiência

8. **Self-host das fontes e assets do portal.** ✅ **Feito.**
   Inter e Space Grotesk agora são servidas localmente
   (`assets/fonts/fonts.css` + `inter.woff2` + `space-grotesk.woff2`, subset
   latino, ~70KB) — o portal renderiza 100% mesmo antes da cortesia, sem depender
   do Google Fonts (bloqueado fora do walled-garden).

9. **Comprovante e reconexão do voucher.** ✅ **Feito.**
   Tela de sucesso com plano, tempo e código do voucher; endpoint
   `GET /api/voucher/active?ac=&mac=` reconhece o dispositivo já pago dentro da
   validade (`getActiveVoucherByMac`) e o portal reconecta sem cobrar de novo
   (`showReconnect`).

10. **Observabilidade + testes.** ✅ **Feito.**
    Logs estruturados em JSON (`services/log.ts`) nos eventos de servidor,
    reconciliação e provisionamento; testes unitários com `node:test`
    (auth/token, mikrotik, efí) e **CI no GitHub Actions**
    (`conectavoucher-ci.yml`: `npm ci` → `prisma generate` → typecheck → test).
