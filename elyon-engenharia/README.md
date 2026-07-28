# ⚡ Elyon Engenharia — Plataforma SaaS de Orçamentos, Propostas e Laudos

Plataforma no **formato SaaS** para **precificação e geração de propostas comerciais** de
serviços de engenharia elétrica, com a identidade visual da **Elyon Engenharia**, e módulo
de **laudos técnicos** (NR-10, instalações elétricas, SPDA e medição de aterramento).

100% funcional em qualquer navegador, sem instalar nada. O fluxo é o de um SaaS:

1. **`site.html`** — landing page do produto, com recursos e planos (Essencial, Profissional, Escritório)
2. **`entrar.html`** — tela de login do espaço de trabalho (autenticação simulada no protótipo)
3. **`index.html`** — o aplicativo: shell SaaS com sidebar, topbar, usuário logado e os 6 módulos

> Comece por `site.html` para a experiência completa, ou vá direto ao `entrar.html`
> e use **"Entrar em modo demonstração"**. A arquitetura de produção (multi-tenant,
> planos, aceite online, stack sugerida) está desenhada em
> **[`docs/arquitetura-saas.md`](docs/arquitetura-saas.md)**, com diagramas.

No protótipo os dados ficam no `localStorage` do navegador, com backup/restauração em JSON —
a migração para banco multi-tenant está mapeada no documento de arquitetura.

---

## Módulos

| Módulo | O que faz |
|---|---|
| **Início** | Painel com nº de orçamentos, valor em negociação, valor fechado, taxa de conversão e últimos orçamentos |
| **Orçamentos** | Monta orçamentos **multi-serviço**, calcula horas e valores ao vivo, controla status (rascunho → enviada → aprovada/recusada) e gera a **proposta comercial** formatada |
| **Laudos** | Checklists de inspeção (NR-10, NBR 5410, SPDA, aterramento) com conclusão automática e geração do **documento do laudo** |
| **Hora técnica** | Calcula o custo e o valor de venda da sua hora a partir de custos, produtividade, impostos e margem |
| **Catálogo de serviços** | Todos os parâmetros de precificação editáveis: horas base, horas/unidade, complexidades e escopo de cada serviço |
| **Configurações** | Dados da empresa e do responsável técnico (aparecem nos documentos) + backup JSON |

## Catálogo de serviços incluído

Cada serviço tem **sua própria unidade de medida** e **seus próprios níveis de complexidade**:

| Serviço | Unidade | Exemplos de complexidade |
|---|---|---|
| Projeto Elétrico BT | m² | residencial padrão → industrial pesado (×0,9 a ×1,9) |
| Projeto SPDA (NBR 5419) | m² de cobertura | volume único → estrutura complexa/inflamáveis |
| Subestação MT | kVA | aérea → cabine blindada → geração paralela |
| Fotovoltaico + Homologação | kWp | micro telhado → solo/carport → minigeração |
| Automação Residencial | pontos | iluminação/cenas → integração completa (KNX) |
| Cabeamento Estruturado / CFTV | pontos | residencial → industrial |
| Laudo NR-10 (prontuário) | quadros | até 75 kW → industrial completo |
| Laudo Instalações (NBR 5410) | m² | residencial → industrial |
| Laudo de SPDA | descidas | edificação única → múltiplas |
| Medição de Aterramento | pontos | malha simples → industrial |
| As-built / Regularização | m² | com documentação → sem documentação |

Um orçamento pode combinar **quantos serviços quiser** (ex.: elétrico + SPDA + solar na
mesma proposta), cada um com sua quantidade, complexidade e ajuste fino.

## O modelo de cálculo

**Hora técnica** (aba própria — alimenta tudo):

```
horas_faturáveis/mês = dias_úteis × horas/dia × %produtivo
custo_da_hora        = (pró-labore + custos fixos) ÷ horas_faturáveis
valor_de_venda/hora  = custo_da_hora × (1 + margem) ÷ (1 − impostos)
```

**Horas por serviço:**

```
horas = (horas_base + horas/unidade × quantidade)
      × fator_complexidade   (próprio de cada serviço)
      × fator_urgência       (normal / apertado +15% / urgente +30%)
      × (1 + ajuste_fino%)
```

**Orçamento:**

```
serviços       = Σ horas de todos os serviços (+ visitas técnicas) × valor_hora
custos_diretos = ART/TRT + deslocamento (visitas × km × 2 × R$/km) + plotagem + outros
total          = serviços + custos_diretos − desconto
```

Indicadores de sanidade: **preço mínimo** (abaixo dele é prejuízo — o total fica vermelho),
e **prazo estimado** em dias úteis pela capacidade produtiva configurada.

## Laudos e relatórios

Modelos prontos com objetivo, normas de referência, metodologia e checklist:

- **Laudo Técnico NR-10** (12 itens — prontuário, EPIs, treinamentos, LOTO…)
- **Laudo de Instalações Elétricas — NBR 5410** (12 itens — proteções, DR, DPS, aterramento…)
- **Laudo de Inspeção de SPDA — NBR 5419** (10 itens — captação, descidas, medições…)
- **Relatório de Medição de Aterramento** (8 itens — resistência, conexões, BEP…)

Cada item é marcado como **Conforme / Não conforme / Não aplicável** com observação.
O botão *“Gerar conclusão automática”* redige a conclusão a partir das não conformidades
e sugere o parecer (aprovado / com ressalvas / reprovado). O documento final sai com a
identidade da Elyon, numeração automática (LAU-ANO-NNN), campo de ART e assinatura do RT.

## Como usar no dia a dia

1. **Configurações** → preencha CNPJ, contato e responsável técnico (uma vez só).
2. **Hora técnica** → informe seus custos e metas (uma vez, revise a cada semestre).
3. **Catálogo** → calibre horas base/complexidades com seu histórico (sempre que entregar projetos).
4. **Orçamentos → Novo** → adicione os serviços, gere a proposta em PDF (imprimir → salvar como PDF).
5. Atualize o **status** de cada orçamento para acompanhar conversão no painel inicial.
6. **Laudos → Novo** → preencha o checklist no local da inspeção e gere o documento.

## Estrutura do código

```
elyon-engenharia/
├── site.html                  # Landing page do SaaS (recursos + planos)
├── entrar.html                # Login do espaço de trabalho (sessão simulada)
├── index.html                 # Aplicativo: shell SaaS (sidebar/topbar) + 6 módulos
├── css/style.css              # Identidade visual + layout de impressão dos documentos
├── js/data.js                 # Catálogo padrão, fatores e modelos de laudo
├── js/app.js                  # Motor de cálculo, sessão, persistência e documentos
└── docs/arquitetura-saas.md   # Desenho SaaS: arquitetura, ERD, fluxos, planos, fases
```

> A pasta `plataforma-orcamento-eletrico/` contém o MVP inicial que deu origem a esta
> versão — mantida como referência.

## Roadmap para o SaaS em produção

O plano completo (com diagramas e estimativas) está em `docs/arquitetura-saas.md`:

1. **Fase 1** — Auth + PostgreSQL multi-tenant (dados saem do localStorage), 1 tenant.
2. **Fase 2** — PDF no servidor, envio por e-mail/WhatsApp e **aceite online da proposta**.
3. **Fase 3** — Billing (Pix/boleto/cartão) + planos + cadastro self-service → SaaS aberto.
4. **Fase 4** — PWA offline para inspeções, fotos nos laudos e **calibração automática**
   comparando horas previstas × horas reais por serviço.

## Aviso

Os parâmetros padrão são pontos de partida de mercado, não tabela oficial. Revise cada
proposta e laudo antes de enviar; laudos exigem responsável técnico habilitado com ART.
