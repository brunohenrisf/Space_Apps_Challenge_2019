"""
Gerador da Lista de Rateio (.xlsx).

Planilha com as UCs beneficiárias e o percentual de crédito de cada uma,
com validação embutida da soma (100%). Quando você enviar seu modelo real,
adaptamos para a formatação/campos exatos da Equatorial MA.
"""

from __future__ import annotations

from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from ..modelo import Projeto

_AZUL = "1F4E79"
_CINZA = "D9D9D9"
_BORDA = Border(*(Side(style="thin", color="999999"),) * 4)


def gerar_rateio(projeto: Projeto, destino: str | Path) -> Path:
    destino = Path(destino)
    wb = Workbook()
    ws = wb.active
    ws.title = "Rateio"

    # Cabeçalho do documento
    ws["A1"] = "LISTA DE RATEIO — SISTEMA DE COMPENSAÇÃO DE ENERGIA"
    ws["A1"].font = Font(bold=True, size=13, color=_AZUL)
    ws.merge_cells("A1:D1")

    ws["A2"] = f"Concessionária: {projeto.concessionaria.nome}"
    ws["A3"] = f"UC geradora (matriz): {projeto.unidade_geradora.numero_uc}"
    ws["A4"] = f"Titular: {projeto.titular.nome}"
    for cell in ("A2", "A3", "A4"):
        ws[cell].font = Font(size=10)

    # Cabeçalho da tabela
    linha_hdr = 6
    colunas = ["Nº", "Unidade Consumidora", "Titular", "Rateio (%)"]
    for col, texto in enumerate(colunas, start=1):
        c = ws.cell(row=linha_hdr, column=col, value=texto)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=_AZUL)
        c.alignment = Alignment(horizontal="center", vertical="center")
        c.border = _BORDA

    # Linhas
    linha = linha_hdr + 1
    for idx, b in enumerate(projeto.beneficiarias, start=1):
        ws.cell(row=linha, column=1, value=idx).border = _BORDA
        ws.cell(row=linha, column=2, value=b.numero_uc).border = _BORDA
        ws.cell(row=linha, column=3, value=b.titular_nome).border = _BORDA
        c = ws.cell(row=linha, column=4, value=b.percentual_rateio)
        c.number_format = "0.00"
        c.border = _BORDA
        linha += 1

    # Total (fórmula viva — recalcula no Excel)
    ws.cell(row=linha, column=3, value="TOTAL").font = Font(bold=True)
    if projeto.beneficiarias:
        total = ws.cell(row=linha, column=4,
                        value=f"=SUM(D{linha_hdr + 1}:D{linha - 1})")
    else:
        total = ws.cell(row=linha, column=4, value=0)
    total.font = Font(bold=True)
    total.number_format = "0.00"
    total.fill = PatternFill("solid", fgColor=_CINZA)
    total.border = _BORDA

    # Largura das colunas
    for col, largura in zip("ABCD", (6, 26, 34, 14)):
        ws.column_dimensions[col].width = largura

    wb.save(destino)
    return destino
