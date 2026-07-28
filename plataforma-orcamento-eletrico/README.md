# ⚡ OrçaElétrico — Plataforma de Orçamentos para Projetos Elétricos

Plataforma web para engenheiros eletricistas montarem **composições de orçamento** a partir do
**custo da hora técnica** e da **previsão de horas de cada projeto**, estimada por complexidade
e outros parâmetros.

É um MVP 100% funcional: um app estático (HTML + CSS + JavaScript puro), sem dependências,
que roda em qualquer navegador — basta abrir o `index.html`. Os dados ficam salvos no
`localStorage` do navegador, com exportação/importação de backup em JSON.

---

## Como usar

1. Abra `plataforma-orcamento-eletrico/index.html` no navegador (duplo clique resolve).
2. Na aba **Hora técnica**, informe seus custos e metas → a plataforma calcula o valor de venda da sua hora.
3. Na aba **Parâmetros**, ajuste as horas base por tipo de projeto, fatores e seus dados profissionais.
4. Na aba **Novo orçamento**, preencha os dados do projeto → o resumo calcula tudo ao vivo.
5. Clique em **Salvar orçamento** para guardar, ou **Gerar proposta** para imprimir/salvar em PDF
   uma proposta comercial formatada (use "Salvar como PDF" na janela de impressão).

> Dica: sirva a pasta com `python3 -m http.server` se preferir acessar via `http://localhost:8000`.

---

## O modelo de cálculo (a sugestão em si)

### 1. Custo da hora técnica

A hora técnica é calculada de trás para frente, partindo do que você precisa ganhar:

```
horas_faturáveis/mês = dias_úteis × horas/dia × %produtivo
custo_mensal         = pró-labore desejado + custos fixos do escritório
custo_da_hora        = custo_mensal ÷ horas_faturáveis
valor_de_venda/hora  = custo_da_hora × (1 + margem) ÷ (1 − impostos)
```

O `%produtivo` é o ponto que quase todo mundo esquece: ninguém fatura 100% do expediente —
parte do dia vai para prospecção, e-mails, administrativo. O padrão sugerido é **65%**.
Os impostos entram dividindo (não somando), porque incidem sobre a nota, não sobre o custo.

### 2. Previsão de horas do projeto

Cada tipo de projeto tem uma equação `horas = base + (h/m² × área)`, corrigida por multiplicadores:

```
horas_projeto = (base + h/m² × área)
              × fator_complexidade      (0,85 a 1,60)
              × fator_info_de_entrada   (1,00 a 1,30 — arquitetônico completo vs. levantamento em campo)
              × fator_urgência          (1,00 a 1,30)
              × fator_compatibilização  (1,15 se houver outras disciplinas)

horas_total = horas_projeto
            + revisões_extras × 8% das horas base
            + visitas × horas_por_visita
```

Parâmetros iniciais (todos editáveis na aba **Parâmetros** — calibre com seus projetos reais):

| Tipo de projeto              | Horas base | Horas por m² |
|------------------------------|-----------:|-------------:|
| Residencial unifamiliar      | 8          | 0,15         |
| Residencial multifamiliar    | 24         | 0,10         |
| Comercial / escritórios      | 16         | 0,18         |
| Industrial                   | 40         | 0,25         |
| Fotovoltaico (área ocupada)  | 12         | 0,06         |
| SPDA / aterramento           | 10         | 0,05         |
| Reforma / retrofit           | 12         | 0,20         |
| Laudo / vistoria técnica     | 6          | 0,03         |

As horas são distribuídas em etapas (levantamento → anteprojeto → dimensionamento → desenho →
memorial → revisões/ART), o que serve tanto para conferir a estimativa quanto para compor o
escopo da proposta.

### 3. Composição do orçamento

```
serviços      = horas_total × valor_da_hora
custos_diretos = ART/TRT + deslocamento (km × 2 × R$/km × visitas) + plotagem + outros
subtotal      = serviços + custos_diretos
total         = subtotal − desconto comercial
```

Além do total, a plataforma mostra três indicadores de sanidade:

- **Preço mínimo**: horas × *custo* da hora (sem margem), com impostos — abaixo disso é prejuízo.
  O total fica destacado em vermelho se o desconto te levar para baixo desse piso.
- **Preço por m²**: para comparar com o mercado da sua região.
- **Prazo estimado**: horas ÷ capacidade produtiva diária, em dias úteis.

---

## Estrutura do projeto

```
plataforma-orcamento-eletrico/
├── index.html      # Interface (4 abas: orçamento, hora técnica, parâmetros, salvos)
├── css/style.css   # Estilos + layout de impressão da proposta
├── js/app.js       # Núcleo de cálculo, persistência e geração da proposta
└── README.md
```

## Funcionalidades do MVP

- ✅ Cálculo do custo e do valor de venda da hora técnica
- ✅ Estimativa de horas por tipo, área, complexidade, qualidade da informação, urgência e compatibilização
- ✅ Composição do orçamento com custos diretos (ART, deslocamento, plotagem) e desconto
- ✅ Alerta de preço abaixo do custo, preço/m² e prazo estimado
- ✅ Orçamentos salvos no navegador (criar, reabrir, editar, excluir)
- ✅ Proposta comercial formatada para impressão / PDF
- ✅ Todos os parâmetros editáveis + backup/restauração em JSON

## Roadmap sugerido (evolução da plataforma)

1. **Calibração com dados reais** — registrar as horas efetivamente gastas em cada projeto
   entregue e comparar com a estimativa; ajustar `base`, `h/m²` e fatores a cada 5–10 projetos.
   Esse ciclo é o que transforma a ferramenta num estimador confiável.
2. **Backend + banco de dados** (quando precisar de multiusuário/multidispositivo):
   API em Node ou Python (FastAPI/Django) + PostgreSQL, mantendo este front como base.
3. **Gestão comercial**: status da proposta (enviada, negociação, aprovada, recusada),
   taxa de conversão por tipo de cliente e follow-up automático.
4. **Geração de PDF nativa** e envio por e-mail/WhatsApp direto da plataforma.
5. **Modelos de proposta personalizáveis** (logo, cores, textos de condições).
6. **Integrações**: emissão de nota, ART via CREA, planilha de medição.

## Aviso

Os valores padrão são pontos de partida razoáveis, **não** tabela de referência oficial.
Consulte também a tabela de honorários do seu CREA regional e calibre os parâmetros com o
histórico dos seus próprios projetos.
