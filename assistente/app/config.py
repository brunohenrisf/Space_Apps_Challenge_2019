"""Configuração lida do ambiente (.env)."""

import os


def _lista_ints(valor: str) -> set[int]:
    return {int(x.strip()) for x in valor.split(",") if x.strip()}


# ─── Claude ────────────────────────────────────────────────────────────
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
MODELO = os.getenv("MODELO", "claude-opus-5")

# Esforço de raciocínio: low | medium | high | xhigh | max
# "medium" equilibra qualidade e latência num assistente de mensagens.
# Suba para "high" se notar respostas rasas em tarefas complexas.
ESFORCO = os.getenv("ESFORCO", "medium")

# Teto de tokens por resposta. Precisa de folga: no Opus 5 o raciocínio
# conta junto com o texto da resposta dentro desse limite.
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "8000"))

# ─── Telegram ──────────────────────────────────────────────────────────
TELEGRAM_TOKEN = os.environ["TELEGRAM_TOKEN"]

# Só estes IDs podem falar com o bot. SEM ISSO, qualquer pessoa que
# descobrir o bot controla sua casa e seu servidor.
USUARIOS_AUTORIZADOS = _lista_ints(os.environ["USUARIOS_AUTORIZADOS"])

# ─── Home Assistant ────────────────────────────────────────────────────
HA_URL = os.getenv("HA_URL", "http://10.0.0.103:8123")
HA_TOKEN = os.getenv("HA_TOKEN", "")

# ─── Servidor e mídia ──────────────────────────────────────────────────
JELLYFIN_URL = os.getenv("JELLYFIN_URL", "http://10.0.0.103:8096")
JELLYFIN_API_KEY = os.getenv("JELLYFIN_API_KEY", "")

QBITTORRENT_URL = os.getenv("QBITTORRENT_URL", "http://10.0.0.103:8080")
QBITTORRENT_USER = os.getenv("QBITTORRENT_USER", "admin")
QBITTORRENT_SENHA = os.getenv("QBITTORRENT_SENHA", "")

# ─── Dados ─────────────────────────────────────────────────────────────
BANCO = os.getenv("BANCO", "/dados/assistente.db")
GOOGLE_CREDENCIAIS = os.getenv("GOOGLE_CREDENCIAIS", "/dados/google_credentials.json")
GOOGLE_TOKEN = os.getenv("GOOGLE_TOKEN", "/dados/google_token.json")

FUSO = os.getenv("FUSO", "America/Sao_Paulo")

# Quantas mensagens da conversa manter no contexto antes de descartar as antigas.
HISTORICO_MAX = int(os.getenv("HISTORICO_MAX", "40"))
