"""Ferramentas de servidor e mídia: disco, contêineres, Jellyfin, qBittorrent."""

import shutil
import subprocess

import httpx
from anthropic import beta_tool

from config import (
    JELLYFIN_API_KEY,
    JELLYFIN_URL,
    QBITTORRENT_SENHA,
    QBITTORRENT_URL,
    QBITTORRENT_USER,
)

TIMEOUT = 15


@beta_tool
def saude_do_servidor() -> str:
    """Estado do servidor: espaço em disco, memória e uptime. Use quando o
    usuário perguntar se está tudo bem, se tem espaço, ou se algo está lento.
    """
    partes = []

    uso = shutil.disk_usage("/")
    gb = 1024**3
    pct = uso.used / uso.total * 100
    partes.append(
        f"Disco: {uso.used / gb:.0f} GB de {uso.total / gb:.0f} GB usados "
        f"({pct:.0f}%), {uso.free / gb:.0f} GB livres"
    )

    try:
        with open("/proc/meminfo") as f:
            info = {
                linha.split(":")[0]: int(linha.split()[1])
                for linha in f
                if ":" in linha
            }
        total, disp = info["MemTotal"] / 1024**2, info["MemAvailable"] / 1024**2
        partes.append(
            f"Memória: {total - disp:.1f} GB de {total:.1f} GB em uso "
            f"({(total - disp) / total * 100:.0f}%)"
        )
    except Exception:
        pass

    try:
        with open("/proc/uptime") as f:
            dias = float(f.read().split()[0]) / 86400
        partes.append(f"Ligado há {dias:.1f} dias")
    except Exception:
        pass

    if pct > 85:
        partes.append("⚠️ Disco acima de 85% — vale limpar downloads antigos.")
    return "\n".join(partes)


@beta_tool
def listar_conteineres() -> str:
    """Lista os aplicativos (contêineres Docker) rodando no servidor e o status
    de cada um. Use quando o usuário perguntar se um app está no ar.
    """
    try:
        r = subprocess.run(
            ["docker", "ps", "-a", "--format", "{{.Names}}\t{{.Status}}"],
            capture_output=True,
            text=True,
            timeout=TIMEOUT,
        )
    except FileNotFoundError:
        return "Docker não está acessível a partir do contêiner do assistente."
    except subprocess.TimeoutExpired:
        return "A consulta ao Docker demorou demais."

    if r.returncode != 0:
        return f"Erro ao consultar o Docker: {r.stderr.strip()}"
    return r.stdout.strip() or "Nenhum contêiner encontrado."


@beta_tool
def buscar_na_biblioteca(termo: str) -> str:
    """Procura um filme, série ou música na biblioteca do Jellyfin.

    Args:
        termo: Nome (ou parte do nome) do que procurar.
    """
    if not JELLYFIN_API_KEY:
        return "Jellyfin não configurado (falta JELLYFIN_API_KEY)."
    try:
        r = httpx.get(
            f"{JELLYFIN_URL}/Items",
            params={
                "searchTerm": termo,
                "Recursive": "true",
                "IncludeItemTypes": "Movie,Series,MusicAlbum",
                "Limit": 20,
            },
            headers={"X-Emby-Token": JELLYFIN_API_KEY},
            timeout=TIMEOUT,
        )
        r.raise_for_status()
        itens = r.json().get("Items", [])
    except Exception as e:
        return f"Erro ao consultar o Jellyfin: {e}"

    if not itens:
        return f"Nada encontrado para '{termo}' na biblioteca."
    return "\n".join(
        f"{i.get('Name')} ({i.get('ProductionYear', '?')}) — {i.get('Type')}"
        for i in itens
    )


def _sessao_qbittorrent() -> httpx.Client | None:
    if not QBITTORRENT_SENHA:
        return None
    cliente = httpx.Client(base_url=QBITTORRENT_URL, timeout=TIMEOUT)
    r = cliente.post(
        "/api/v2/auth/login",
        data={"username": QBITTORRENT_USER, "password": QBITTORRENT_SENHA},
        headers={"Referer": QBITTORRENT_URL},
    )
    if r.text.strip() != "Ok.":
        cliente.close()
        return None
    return cliente


@beta_tool
def listar_downloads() -> str:
    """Mostra os downloads em andamento no qBittorrent, com progresso e
    velocidade. Use quando o usuário perguntar "como está o download".
    """
    cliente = _sessao_qbittorrent()
    if cliente is None:
        return "qBittorrent não configurado ou credenciais inválidas."
    try:
        r = cliente.get("/api/v2/torrents/info")
        r.raise_for_status()
        torrents = r.json()
    except Exception as e:
        return f"Erro ao consultar o qBittorrent: {e}"
    finally:
        cliente.close()

    if not torrents:
        return "Nenhum download na fila."

    linhas = []
    for t in torrents[:20]:
        pct = t.get("progress", 0) * 100
        velocidade = t.get("dlspeed", 0) / 1024**2
        eta = t.get("eta", 0)
        falta = f", faltam {eta // 60} min" if 0 < eta < 8640000 else ""
        linhas.append(
            f"{t.get('name')} — {pct:.0f}% ({t.get('state')}), "
            f"{velocidade:.1f} MB/s{falta}"
        )
    return "\n".join(linhas)


FERRAMENTAS = [
    saude_do_servidor,
    listar_conteineres,
    buscar_na_biblioteca,
    listar_downloads,
]
