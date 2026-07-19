"""
Motor de cálculos de engenharia.

Deriva todas as grandezas técnicas a partir do cadastro (modelo.Projeto):
potências, corrente de saída, dimensionamento do disjuntor do gerador,
classificação micro/minigeração e validação do rateio.

Base normativa: Lei 14.300/2022 (marco legal da GD) e REN ANEEL 1.000/2021.
Os limiares ficam parametrizados em constantes para facilitar ajuste.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from .modelo import Projeto, TipoLigacao

# Limites de classificação (kW) — Lei 14.300/2022
LIMITE_MICROGERACAO_KW = 75.0
LIMITE_MINIGERACAO_KW = 5000.0  # fonte solar (não despachável)

# Fator de dimensionamento do disjuntor do gerador sobre a corrente nominal
FATOR_DISJUNTOR = 1.25

# Série comercial de disjuntores (A) para arredondamento para cima
SERIE_DISJUNTORES_A = [
    6, 10, 16, 20, 25, 32, 40, 50, 63, 70, 80, 100,
    125, 150, 175, 200, 225, 250, 300, 350, 400, 500, 630,
]


@dataclass
class ResultadoCalculo:
    """Todas as grandezas derivadas — consumidas pelos geradores de documento."""
    potencia_geracao_kwp: float        # soma dos módulos (CC)
    potencia_instalada_kw: float       # soma dos inversores (CA) — classifica GD
    n_modulos: int
    n_inversores: int
    relacao_fv_inversor: float         # oversizing CC/CA
    corrente_saida_a: float            # corrente nominal de saída CA
    disjuntor_gerador_calc_a: float    # corrente × fator
    disjuntor_gerador_comercial_a: int # arredondado para série comercial
    classificacao: str                 # "Microgeração" / "Minigeração" / fora de faixa
    tensao_v: float
    tipo_ligacao: TipoLigacao


def _arredonda_disjuntor(corrente_a: float) -> int:
    for valor in SERIE_DISJUNTORES_A:
        if valor >= corrente_a:
            return valor
    return SERIE_DISJUNTORES_A[-1]


def corrente_saida(potencia_ca_w: float, tensao_v: float,
                   ligacao: TipoLigacao, fator_potencia: float = 1.0) -> float:
    """
    Corrente nominal de saída CA do gerador.

    - Monofásico / Bifásico: I = P / (V · fp)
    - Trifásico:             I = P / (√3 · V · fp)
    """
    if tensao_v <= 0 or fator_potencia <= 0:
        return 0.0
    if ligacao == TipoLigacao.TRIFASICO:
        return potencia_ca_w / (math.sqrt(3) * tensao_v * fator_potencia)
    return potencia_ca_w / (tensao_v * fator_potencia)


def classifica_gd(potencia_instalada_kw: float) -> str:
    if potencia_instalada_kw <= 0:
        return "Não informada"
    if potencia_instalada_kw <= LIMITE_MICROGERACAO_KW:
        return "Microgeração"
    if potencia_instalada_kw <= LIMITE_MINIGERACAO_KW:
        return "Minigeração"
    return "Acima do limite de minigeração"


def calcular(projeto: Projeto, fator_potencia: float = 1.0) -> ResultadoCalculo:
    ger = projeto.gerador
    uc = projeto.unidade_geradora

    potencia_wp = sum(m.potencia_total_wp for m in ger.modulos)
    potencia_ca_w = sum(i.potencia_total_ca_w for i in ger.inversores)
    n_modulos = sum(m.quantidade for m in ger.modulos)
    n_inversores = sum(i.quantidade for i in ger.inversores)

    potencia_geracao_kwp = potencia_wp / 1000.0
    potencia_instalada_kw = potencia_ca_w / 1000.0

    relacao = (potencia_wp / potencia_ca_w) if potencia_ca_w else 0.0

    corrente = corrente_saida(potencia_ca_w, uc.tensao_v, uc.tipo_ligacao,
                              fator_potencia)
    disj_calc = corrente * FATOR_DISJUNTOR
    disj_comercial = _arredonda_disjuntor(disj_calc)

    return ResultadoCalculo(
        potencia_geracao_kwp=round(potencia_geracao_kwp, 3),
        potencia_instalada_kw=round(potencia_instalada_kw, 3),
        n_modulos=n_modulos,
        n_inversores=n_inversores,
        relacao_fv_inversor=round(relacao, 3),
        corrente_saida_a=round(corrente, 2),
        disjuntor_gerador_calc_a=round(disj_calc, 2),
        disjuntor_gerador_comercial_a=disj_comercial,
        classificacao=classifica_gd(potencia_instalada_kw),
        tensao_v=uc.tensao_v,
        tipo_ligacao=uc.tipo_ligacao,
    )


# --------------------------------------------------------------------------- #
# Validação                                                                    #
# --------------------------------------------------------------------------- #
def validar(projeto: Projeto, resultado: ResultadoCalculo | None = None) -> list[str]:
    """
    Retorna lista de problemas encontrados (vazia = tudo certo).
    Roda ANTES de gerar o pacote para não protocolar documento com erro.
    """
    if resultado is None:
        resultado = calcular(projeto)

    problemas: list[str] = []

    # Rateio deve somar 100% quando há beneficiárias
    if projeto.beneficiarias:
        total = sum(b.percentual_rateio for b in projeto.beneficiarias)
        if abs(total - 100.0) > 0.01:
            problemas.append(
                f"Rateio soma {total:.2f}% — deve somar exatamente 100%."
            )

    # Disjuntor de entrada precisa comportar o gerador
    disj_entrada = projeto.unidade_geradora.disjuntor_entrada_a
    if disj_entrada and resultado.disjuntor_gerador_comercial_a > disj_entrada:
        problemas.append(
            f"Disjuntor do gerador ({resultado.disjuntor_gerador_comercial_a} A) "
            f"maior que o de entrada ({disj_entrada:.0f} A) — verificar."
        )

    # Faixa de potência
    if resultado.classificacao == "Acima do limite de minigeração":
        problemas.append(
            f"Potência instalada {resultado.potencia_instalada_kw} kW acima do "
            f"limite de minigeração ({LIMITE_MINIGERACAO_KW:.0f} kW)."
        )

    # Oversizing muito alto costuma ser erro de digitação
    if resultado.relacao_fv_inversor > 1.6:
        problemas.append(
            f"Relação FV/inversor {resultado.relacao_fv_inversor:.2f} muito alta "
            f"— conferir quantidades de módulos/inversores."
        )

    # Campos mínimos para os documentos
    if not projeto.titular.nome:
        problemas.append("Nome do titular não preenchido.")
    if not projeto.unidade_geradora.numero_uc:
        problemas.append("Número da unidade consumidora (matriz) não preenchido.")
    if not projeto.gerador.modulos:
        problemas.append("Nenhum módulo cadastrado.")
    if not projeto.gerador.inversores:
        problemas.append("Nenhum inversor cadastrado.")

    return problemas
