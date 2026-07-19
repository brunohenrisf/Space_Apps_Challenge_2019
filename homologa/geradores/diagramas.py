"""
Geradores de diagramas em DXF (abrem no AutoCAD).

v0: diagrama UNIFILAR paramétrico — o mais "gerável por regra". Monta a cadeia
gerador FV → inversor(es) → proteção CA (disjuntor + DPS) → medidor bidirecional
→ ponto de conexão, a partir do Projeto e do ResultadoCalculo.

Próximos: multifilar e diagrama em blocos (mesma base ezdxf). Quando você enviar
seus blocos-modelo (.dwg), podemos inseri-los como INSERT em vez de redesenhar.
"""

from __future__ import annotations

from pathlib import Path

import ezdxf

from ..calculos import ResultadoCalculo, calcular
from ..modelo import Projeto


def _texto(msp, x, y, txt, altura=2.2, cor=7, alinhar="LEFT"):
    ent = msp.add_text(txt, dxfattribs={"height": altura, "color": cor})
    ent.set_placement((x, y))
    return ent


def _caixa(msp, x, y, w, h, cor=7):
    msp.add_lwpolyline(
        [(x, y), (x + w, y), (x + w, y + h), (x, y + h), (x, y)],
        dxfattribs={"color": cor},
    )


def gerar_unifilar(projeto: Projeto, destino: str | Path,
                   resultado: ResultadoCalculo | None = None) -> Path:
    if resultado is None:
        resultado = calcular(projeto)

    destino = Path(destino)
    doc = ezdxf.new(dxfversion="R2010", setup=True)
    msp = doc.modelspace()

    # Camadas
    doc.layers.add("EQUIPAMENTOS", color=5)   # azul
    doc.layers.add("CONDUTORES", color=3)      # verde
    doc.layers.add("TEXTO", color=7)           # branco/preto
    doc.layers.add("MOLDURA", color=8)         # cinza

    x = 20.0            # coluna vertical do diagrama
    y = 200.0           # topo, desce a cada bloco
    passo = 40.0

    def bloco(rotulo: str, detalhe: str = ""):
        nonlocal y
        _caixa(msp, x, y, 60, 18, cor=5)
        _texto(msp, x + 30 - len(rotulo) * 0.7, y + 11, rotulo, 2.4, 5)
        if detalhe:
            _texto(msp, x + 30 - len(detalhe) * 0.5, y + 4, detalhe, 1.8, 7)
        # condutor descendo para o próximo
        msp.add_line((x + 30, y), (x + 30, y - (passo - 18)),
                     dxfattribs={"color": 3})
        y -= passo

    # Gerador FV
    bloco("GERADOR FV",
          f"{resultado.n_modulos} mod. — {resultado.potencia_geracao_kwp:.2f} kWp")

    # Inversor(es)
    inv_txt = (f"{resultado.n_inversores}x — "
               f"{resultado.potencia_instalada_kw:.2f} kW CA")
    bloco("INVERSOR", inv_txt)

    # Proteção CA: disjuntor + DPS
    bloco("PROTEÇÃO CA",
          f"Disj. {resultado.disjuntor_gerador_comercial_a} A + DPS")

    # Medidor bidirecional
    bloco("MEDIÇÃO",
          f"Medidor bidir. — {projeto.unidade_geradora.numero_medidor or 's/nº'}")

    # Ponto de conexão / rede
    _caixa(msp, x, y, 60, 18, cor=5)
    lig = projeto.unidade_geradora.tipo_ligacao.value
    _texto(msp, x + 8, y + 11, "REDE / PONTO DE CONEXÃO", 2.4, 5)
    _texto(msp, x + 8, y + 4, f"{lig} — {resultado.tensao_v:.0f} V", 1.8, 7)

    # Legenda / carimbo simplificado
    lx, ly = 120.0, 60.0
    _caixa(msp, lx, ly, 130, 90, cor=8)
    _texto(msp, lx + 4, ly + 80, "DIAGRAMA UNIFILAR", 3.2, 5)
    linhas = [
        f"Titular: {projeto.titular.nome}",
        f"UC: {projeto.unidade_geradora.numero_uc}",
        f"Potência ger.: {resultado.potencia_geracao_kwp:.2f} kWp",
        f"Potência CA: {resultado.potencia_instalada_kw:.2f} kW",
        f"Classificação: {resultado.classificacao}",
        f"Corrente saída: {resultado.corrente_saida_a:.2f} A",
        f"Concessionária: {projeto.concessionaria.nome}",
        f"Resp. téc.: {projeto.responsavel_tecnico.nome}",
        f"CREA: {projeto.responsavel_tecnico.crea}",
    ]
    for i, ln in enumerate(linhas):
        _texto(msp, lx + 4, ly + 70 - i * 7.5, ln, 2.0, 7)

    doc.saveas(destino)
    return destino
