# Arquitetura SaaS — Plataforma Elyon Engenharia

Este documento desenha a plataforma no **formato SaaS**: multi-tenant (cada escritório de
engenharia é um espaço de trabalho isolado), com assinatura por planos, documentos gerados
no servidor e aceite de proposta online. O protótipo HTML deste repositório é a **fase 0**
do plano — as telas e o motor de cálculo já validados migram quase 1:1.

---

## 1. Visão geral da arquitetura

```mermaid
flowchart LR
  subgraph Usuarios["Usuários"]
    ENG["Engenheiro / equipe<br>(app web · PWA)"]
    CLI["Cliente final<br>(página pública da proposta)"]
  end

  subgraph Front["Front-end — Vercel"]
    SPA["App Next.js/React<br>(as telas do protótipo atual)"]
    PUB["Página pública:<br>proposta + aceite online"]
  end

  subgraph Back["Back-end"]
    API["API (Next.js Server Actions<br>ou NestJS)"]
    PDF["Worker de PDF<br>(propostas e laudos)"]
  end

  subgraph Dados["Supabase (ou equivalente)"]
    AUTH["Auth<br>e-mail/senha · Google"]
    PG[("PostgreSQL<br>RLS multi-tenant")]
    STG[("Storage<br>PDFs · fotos de laudos · logos")]
  end

  subgraph Servicos["Serviços externos"]
    PAY["Asaas / Stripe<br>Pix · boleto · cartão"]
    MAIL["E-mail transacional<br>(Resend)"]
    ZAP["WhatsApp Business API"]
  end

  ENG --> SPA --> API
  CLI --> PUB --> API
  API --> AUTH
  API --> PG
  API --> PDF --> STG
  API --> PAY
  API --> MAIL
  API --> ZAP
```

**Decisões-chave:**

- **Multi-tenant com banco único**: todas as tabelas de negócio carregam `tenant_id`, com
  **Row Level Security (RLS)** do PostgreSQL garantindo isolamento no próprio banco — o
  modelo mais barato e simples de operar para um SaaS nesta escala.
- **O motor de cálculo já existe**: as fórmulas de `js/app.js` (hora técnica, horas por
  serviço, composição) viram funções puras compartilhadas entre front (pré-visualização ao
  vivo) e back (valor oficial gravado).
- **PDF no servidor**: propostas e laudos são renderizados no worker (mesmo HTML/CSS de
  impressão do protótipo) e guardados no Storage — cada documento ganha URL estável e
  histórico de versões.

## 2. Modelo de dados (ERD)

```mermaid
erDiagram
  PLANOS ||--o{ ASSINATURAS : define
  TENANTS ||--o| ASSINATURAS : contrata
  TENANTS ||--o{ MEMBROS : possui
  USUARIOS ||--o{ MEMBROS : participa
  TENANTS ||--o{ SERVICOS : cataloga
  SERVICOS ||--o{ COMPLEXIDADES : gradua
  TENANTS ||--o{ ORCAMENTOS : emite
  ORCAMENTOS ||--o{ ORCAMENTO_ITENS : compoe
  SERVICOS ||--o{ ORCAMENTO_ITENS : precifica
  ORCAMENTOS ||--o| PROPOSTAS : publica
  TENANTS ||--o{ LAUDOS : emite
  MODELOS_LAUDO ||--o{ LAUDOS : estrutura
  ORCAMENTO_ITENS ||--o{ HORAS_REAIS : calibra

  TENANTS {
    uuid id PK
    text nome
    text cnpj
    jsonb identidade_visual "logo, cores, RT, CREA"
    jsonb hora_tecnica "custos, produtividade, impostos, margem"
  }
  USUARIOS {
    uuid id PK
    text nome
    text email
  }
  MEMBROS {
    uuid tenant_id FK
    uuid usuario_id FK
    text papel "admin | engenheiro | comercial"
  }
  PLANOS {
    text id PK "essencial | profissional | escritorio"
    numeric preco_mensal
    jsonb limites "usuarios, orcamentos/mes, laudos"
  }
  ASSINATURAS {
    uuid tenant_id FK
    text plano_id FK
    text status "trial | ativa | inadimplente | cancelada"
    text gateway_ref
  }
  SERVICOS {
    uuid id PK
    uuid tenant_id FK
    text nome
    text unidade "m2 | kWp | kVA | pontos | quadros"
    numeric horas_base
    numeric horas_por_unidade
    jsonb escopo
  }
  COMPLEXIDADES {
    uuid id PK
    uuid servico_id FK
    text nome
    numeric fator
  }
  ORCAMENTOS {
    uuid id PK
    uuid tenant_id FK
    text numero "ORC-2026-001"
    jsonb cliente
    text status "rascunho | enviada | aprovada | recusada"
    jsonb condicoes "urgencia, visitas, custos diretos, desconto, pagamento"
    jsonb totais "horas, valores calculados"
  }
  ORCAMENTO_ITENS {
    uuid id PK
    uuid orcamento_id FK
    uuid servico_id FK
    numeric quantidade
    uuid complexidade_id FK
    numeric ajuste_perc
    numeric horas_calc
    numeric valor_calc
  }
  PROPOSTAS {
    uuid id PK
    uuid orcamento_id FK
    text pdf_url
    text token_publico "link de aceite"
    timestamptz enviada_em
    timestamptz aceita_em
  }
  MODELOS_LAUDO {
    uuid id PK
    uuid tenant_id FK "null = modelo global"
    text titulo
    jsonb normas
    jsonb itens_checklist
  }
  LAUDOS {
    uuid id PK
    uuid tenant_id FK
    text numero "LAU-2026-001"
    uuid modelo_id FK
    jsonb respostas "status + obs por item"
    text parecer
    text pdf_url
    text art
  }
  HORAS_REAIS {
    uuid id PK
    uuid orcamento_item_id FK
    numeric horas
    date registrada_em
  }
```

A tabela **HORAS_REAIS** é a peça estratégica: registrando as horas efetivamente gastas por
item entregue, a plataforma passa a sugerir coeficientes calibrados por serviço
("seus projetos de SPDA estão saindo 18% acima do estimado") — o diferencial competitivo
frente a planilhas.

## 3. Fluxo principal: do orçamento ao aceite

```mermaid
sequenceDiagram
  actor E as Engenheiro
  participant A as App (front)
  participant B as API
  participant W as Worker PDF
  actor C as Cliente final

  E->>A: monta orçamento (serviços + complexidades)
  A->>B: salvar (valida limites do plano)
  B-->>A: nº ORC-2026-014 + totais oficiais
  E->>A: "Enviar proposta"
  B->>W: renderizar PDF com a marca do tenant
  W-->>B: URL do PDF no Storage
  B->>C: e-mail/WhatsApp com link público
  C->>B: abre, visualiza e clica "Aceitar proposta"
  B-->>E: notificação + status muda para "aprovada"
  Note over B,E: pipeline e taxa de conversão<br>atualizados no painel
```

O mesmo fluxo vale para laudos (sem etapa de aceite): checklist preenchido no celular
durante a inspeção (PWA offline) → PDF numerado no servidor → link para o cliente.

## 4. Planos e monetização (sugestão)

| | **Essencial** — R$ 0 | **Profissional** — R$ 49/mês | **Escritório** — R$ 149/mês |
|---|---|---|---|
| Usuários | 1 | 1 | até 5, com papéis |
| Orçamentos | 10/mês | ilimitados | ilimitados |
| Laudos | — | 4 modelos | 4 modelos + modelos próprios |
| Marca nos documentos | padrão | própria | própria + white-label |
| Aceite online / envio | — | — | ✔ |
| Calibração por horas reais | — | ✔ | ✔ + relatórios de produtividade |

Cobrança via **Asaas** (Pix/boleto — essencial no mercado brasileiro de engenharia) ou
Stripe. Trial de 14 dias do Profissional no cadastro. Preços são sugestão de partida.

## 5. Segurança e multi-tenancy

- **RLS em todas as tabelas**: `tenant_id = auth.jwt() ->> 'tenant_id'` — isolamento no banco,
  não na aplicação.
- Papéis por membro: `admin` (planos, catálogo, hora técnica), `engenheiro` (orçamentos,
  laudos), `comercial` (status e envio, sem ver custos).
- Link público da proposta com token aleatório e expiração pela validade da proposta.
- Laudos são imutáveis após emissão (nova versão = novo documento) — trilha de auditoria.
- Backup diário do banco; exportação JSON por tenant (já existe no protótipo).

## 6. Roteiro de implantação

```mermaid
flowchart LR
  F0["FASE 0 — feita ✔<br>Protótipo HTML<br>motor de cálculo validado"]
  F1["FASE 1 · 2-4 sem<br>Auth + PostgreSQL<br>dados saem do localStorage<br>1 tenant (Elyon)"]
  F2["FASE 2 · 4-6 sem<br>PDF no servidor<br>envio e-mail/WhatsApp<br>aceite online"]
  F3["FASE 3 · 4 sem<br>Billing + planos<br>cadastro self-service<br>= SaaS aberto"]
  F4["FASE 4 · contínuo<br>PWA offline p/ inspeções<br>fotos nos laudos<br>calibração automática"]
  F0 --> F1 --> F2 --> F3 --> F4
```

**Custo de infraestrutura estimado**: R$ 0/mês nas fases 1–2 (free tiers de Vercel +
Supabase) e ~R$ 120–250/mês a partir da fase 3 (planos pagos de infra + domínio + e-mail),
antes de qualquer receita de assinatura.

## 7. Correspondência protótipo → produção

| No protótipo (este repositório) | No SaaS em produção |
|---|---|
| `entrar.html` (login simulado) | Supabase Auth / Clerk (e-mail, Google, MFA) |
| `localStorage` | PostgreSQL multi-tenant com RLS |
| `js/data.js` (catálogo padrão) | Seeds do banco por tenant, editáveis por plano |
| `js/app.js` (motor de cálculo) | Pacote compartilhado front/back (mesmas fórmulas) |
| `window.print()` | Worker de PDF + Storage com URL estável |
| `site.html` (landing) | Site de marketing + onboarding self-service |
| Backup JSON manual | Backup automático + exportação por tenant |
