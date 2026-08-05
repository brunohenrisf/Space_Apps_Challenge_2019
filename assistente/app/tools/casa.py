"""Ferramentas de casa inteligente (Home Assistant)."""

import httpx
from anthropic import beta_tool

from config import HA_TOKEN, HA_URL

TIMEOUT = 15

# Domínios que o assistente pode controlar. Sensores e câmeras ficam de fora
# de propósito — são só leitura.
CONTROLAVEIS = ("switch", "light", "fan", "input_boolean", "scene", "script")


def _cabecalhos() -> dict[str, str]:
    return {"Authorization": f"Bearer {HA_TOKEN}", "Content-Type": "application/json"}


def _estados() -> list[dict]:
    r = httpx.get(f"{HA_URL}/api/states", headers=_cabecalhos(), timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


def _nome(estado: dict) -> str:
    return estado.get("attributes", {}).get("friendly_name") or estado["entity_id"]


@beta_tool
def listar_dispositivos(filtro: str = "") -> str:
    """Lista os dispositivos da casa e o estado atual de cada um.

    Use antes de ligar ou desligar algo, para descobrir o entity_id correto.

    Args:
        filtro: Texto opcional para filtrar por nome ou entity_id (ex.: "cozinha",
            "luz"). Vazio lista tudo que é controlável ou sensor.
    """
    try:
        estados = _estados()
    except Exception as e:
        return f"Erro ao consultar o Home Assistant: {e}"

    filtro = filtro.lower().strip()
    linhas = []
    for e in estados:
        eid = e["entity_id"]
        dominio = eid.split(".")[0]
        if dominio not in CONTROLAVEIS + ("sensor", "binary_sensor", "weather"):
            continue
        nome = _nome(e)
        if filtro and filtro not in nome.lower() and filtro not in eid.lower():
            continue
        unidade = e.get("attributes", {}).get("unit_of_measurement", "")
        linhas.append(f"{eid} | {nome} | {e['state']}{unidade}")

    if not linhas:
        return "Nenhum dispositivo encontrado com esse filtro."
    return "entity_id | nome | estado\n" + "\n".join(sorted(linhas))


@beta_tool
def acionar_dispositivo(entity_id: str, ligar: bool) -> str:
    """Liga ou desliga um dispositivo da casa.

    Confirme o entity_id com listar_dispositivos antes de usar. Para o portão,
    avise o usuário do que vai acontecer antes de acionar.

    Args:
        entity_id: Identificador completo, ex.: "switch.iluminacao_1_interruptor_1".
        ligar: True para ligar, False para desligar.
    """
    dominio = entity_id.split(".")[0]
    if dominio not in CONTROLAVEIS:
        return (
            f"Não posso acionar '{entity_id}': só controlo {', '.join(CONTROLAVEIS)}. "
            "Sensores são somente leitura."
        )

    servico = "turn_on" if ligar else "turn_off"
    try:
        r = httpx.post(
            f"{HA_URL}/api/services/homeassistant/{servico}",
            headers=_cabecalhos(),
            json={"entity_id": entity_id},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
    except Exception as e:
        return f"Erro ao acionar {entity_id}: {e}"

    return f"{entity_id} {'ligado' if ligar else 'desligado'}."


@beta_tool
def estado_da_casa() -> str:
    """Resumo rápido da casa: quantas luzes estão ligadas, temperatura, umidade
    e estado do portão. Use quando o usuário perguntar algo geral como
    "como está a casa?" ou "esqueci alguma luz acesa?".
    """
    try:
        estados = _estados()
    except Exception as e:
        return f"Erro ao consultar o Home Assistant: {e}"

    ligados, sensores, portao = [], [], []
    for e in estados:
        eid = e["entity_id"]
        dominio = eid.split(".")[0]
        if "porta" in eid or "portao" in eid or "fechadura" in eid:
            portao.append(f"{_nome(e)}: {e['state']}")
        elif dominio in ("switch", "light") and e["state"] == "on":
            ligados.append(_nome(e))
        elif dominio == "sensor" and any(
            t in eid for t in ("temperatura", "umidade", "humidade", "temperature")
        ):
            unidade = e.get("attributes", {}).get("unit_of_measurement", "")
            sensores.append(f"{_nome(e)}: {e['state']}{unidade}")

    partes = [f"Ligados agora ({len(ligados)}): " + (", ".join(ligados) or "nenhum")]
    if sensores:
        partes.append("Ambiente: " + "; ".join(sensores))
    if portao:
        partes.append("Acesso: " + "; ".join(portao))
    return "\n".join(partes)


FERRAMENTAS = [listar_dispositivos, acionar_dispositivo, estado_da_casa]
