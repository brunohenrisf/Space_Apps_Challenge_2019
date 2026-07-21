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

4. **Idempotência da cortesia + reconciliação.**
   Cada reload do portal cria um novo `ip-binding` de cortesia. Tornar
   idempotente (por MAC) e rodar um job que reconcilia Pix × sessões do Hotspot
   e limpa cortesias órfãs.

5. **CRUD real de planos e eventos.**
   Os planos são fixos no código (`plans.ts`) e o evento é hardcoded no painel.
   Permitir criar/editar/pausar planos e eventos pela interface.

6. **Robustez da integração RouterOS.**
   O serviço abre uma conexão por comando. Adicionar pool/reuso de conexão,
   timeout, retry com backoff e uma fila de provisionamento — para o pagamento
   nunca ficar sem liberar acesso por uma falha transitória do túnel.

7. **Segurança do webhook e dos segredos.**
   Suportar o **mTLS real da Efí** (além do HMAC na query), guardar segredos
   num cofre (não em memória/env plano), validar o payload do webhook e aplicar
   rate limiting nas rotas públicas.

## Experiência

8. **Self-host das fontes e assets do portal.**
   O portal usa Google Fonts, que fica **bloqueado antes da cortesia** (só o
   walled-garden é acessível). Servir Inter/Space Grotesk localmente para o
   portal renderizar 100% mesmo sem internet aberta.

9. **Comprovante e recuperação do voucher.**
   Tela/recibo pós-pagamento com o tempo contratado, opção de **reenviar o
   voucher** (ex.: por link) e reconectar o mesmo dispositivo dentro da validade
   sem pagar de novo.

10. **Observabilidade + testes.**
    Logs estruturados e métricas (vendas, conversão, falhas de provisionamento),
    alertas (webhook parado, roteador offline) e testes automatizados
    (unitários de efí/mikrotik/relatório + e2e do fluxo
    checkout→webhook→provision→handoff) rodando em CI.
