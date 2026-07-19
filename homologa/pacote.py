"""
Orquestrador — gera o pacote de homologação completo em uma pasta organizada.

Roda a validação, calcula as grandezas uma única vez e chama cada gerador.
"""

from __future__ import annotations

from pathlib import Path

from .calculos import calcular, validar
from .geradores.autorizacao import gerar_autorizacao
from .geradores.diagramas import gerar_unifilar
from .geradores.memorial import gerar_memorial
from .geradores.rateio import gerar_rateio
from .modelo import Projeto


def _slug(texto: str) -> str:
    return "".join(c if c.isalnum() else "_" for c in texto).strip("_") or "projeto"


def gerar_pacote(projeto: Projeto, pasta_saida: str | Path,
                 ignorar_validacao: bool = False) -> dict:
    """
    Gera todos os documentos do pacote. Retorna dict com caminhos gerados e
    eventuais problemas de validação.
    """
    resultado = calcular(projeto)
    problemas = validar(projeto, resultado)
    if problemas and not ignorar_validacao:
        return {"ok": False, "problemas": problemas, "arquivos": {}}

    base = Path(pasta_saida) / _slug(projeto.identificador or projeto.titular.nome)
    base.mkdir(parents=True, exist_ok=True)

    arquivos: dict[str, Path] = {}
    arquivos["memorial"] = gerar_memorial(
        projeto, base / "Memorial_Tecnico.docx", resultado)
    arquivos["autorizacao"] = gerar_autorizacao(
        projeto, base / "Autorizacao_Representacao_Tecnica.docx")
    if projeto.beneficiarias:
        arquivos["rateio"] = gerar_rateio(projeto, base / "Lista_Rateio.xlsx")
    arquivos["unifilar"] = gerar_unifilar(
        projeto, base / "Diagrama_Unifilar.dxf", resultado)

    return {
        "ok": True,
        "problemas": problemas,   # avisos, mesmo quando ignorados
        "pasta": base,
        "arquivos": arquivos,
        "resultado": resultado,
    }
