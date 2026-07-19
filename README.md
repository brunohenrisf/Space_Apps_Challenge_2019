# Homologa — Automação do pacote de homologação fotovoltaica

Ferramenta para gerar automaticamente o pacote de documentos de homologação de
sistemas de geração distribuída fotovoltaica, a partir de um único cadastro de
projeto. Alvo do v1: **Equatorial Maranhão (MA)**.

## Ideia central

Um único **cadastro do projeto** (dados do cliente + técnicos) alimenta o motor
de cálculos e todos os geradores de documentos. Você não digita o mesmo dado
duas vezes: cadastra uma vez → gera o pacote completo → revisa e ajusta.

```
[Cadastro do projeto]  →  [Cálculos + validação]  →  [Geradores de documento]
     modelo.py                 calculos.py               geradores/
```

## O que já funciona (v0 — fundação)

| Documento | Formato | Status |
|---|---|---|
| Memorial técnico descritivo | .docx | ✅ gera estrutura-padrão |
| Autorização de representação técnica | .docx | ✅ gera estrutura-padrão |
| Lista de rateio | .xlsx | ✅ com validação de 100% |
| Diagrama unifilar | .dxf (AutoCAD) | ✅ paramétrico |
| Cálculos de engenharia | — | ✅ potência, corrente, disjuntor, classificação |
| Validação pré-geração | — | ✅ rateio, faixa, disjuntor, campos obrigatórios |

### Cálculos implementados
- Potência de geração (kWp) e potência instalada CA (kW)
- Relação FV/inversor (oversizing)
- Corrente nominal de saída CA (mono/bi/trifásico)
- Disjuntor do gerador (× 1,25 → série comercial)
- Classificação micro/minigeração (Lei 14.300/2022)
- Validação: rateio = 100%, disjuntor de entrada, faixa de potência, campos

## Como rodar

```bash
pip install -r requirements.txt
python3 exemplo.py        # gera um pacote de exemplo em ./saida/
```

## Estrutura

```
homologa/
  modelo.py            # dataclasses do cadastro (fonte única de dados)
  calculos.py          # motor de engenharia + validação
  pacote.py            # orquestra a geração do pacote completo
  geradores/
    memorial.py        # memorial técnico (.docx)
    autorizacao.py     # autorização de representação técnica (.docx)
    rateio.py          # lista de rateio (.xlsx)
    diagramas.py       # diagrama unifilar (.dxf)
exemplo.py             # exemplo executável ponta a ponta
```

## Roadmap

**Próximos passos (dependem dos seus templates reais):**
- [ ] Trocar geradores v0 pelo preenchimento dos SEUS modelos (.docx/.xlsx da Equatorial MA)
- [ ] Folha zero e formulário de solicitação (Equatorial MA)
- [ ] Diagramas multifilar e em blocos (.dxf) + inserção dos seus blocos-modelo
- [ ] Planta de situação a partir das coordenadas
- [ ] Extração automática de dados das faturas/fotos (OCR)
- [ ] Interface desktop (cadastro do projeto → botão "gerar pacote")
- [ ] Pré-preenchimento da ART (CREA) e do pedido de acesso

**Manual por ora** (sem API pública): emissão da ART no CREA, protocolo do
pedido de acesso e de vistoria na Equatorial. A ferramenta entrega o pacote
pronto para protocolar.
