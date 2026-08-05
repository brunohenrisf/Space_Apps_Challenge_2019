"""Ferramentas de agenda e e-mail (Google Calendar + Gmail)."""

import base64
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from anthropic import beta_tool

from config import FUSO, GOOGLE_TOKEN

ESCOPOS = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
]

_servicos: dict[str, object] = {}


def _servico(nome: str, versao: str):
    """Cria (uma vez) o cliente da API do Google, renovando o token se preciso."""
    if nome in _servicos:
        return _servicos[nome]

    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build

    if not Path(GOOGLE_TOKEN).exists():
        raise RuntimeError(
            "Google não autorizado ainda. Rode `python autorizar_google.py` "
            "no servidor uma única vez."
        )

    cred = Credentials.from_authorized_user_file(GOOGLE_TOKEN, ESCOPOS)
    if not cred.valid:
        if cred.expired and cred.refresh_token:
            cred.refresh(Request())
            Path(GOOGLE_TOKEN).write_text(cred.to_json())
        else:
            raise RuntimeError(
                "Autorização do Google expirou. Rode `python autorizar_google.py` de novo."
            )

    _servicos[nome] = build(nome, versao, credentials=cred, cache_discovery=False)
    return _servicos[nome]


def _agora() -> datetime:
    return datetime.now(ZoneInfo(FUSO))


# ─── Agenda ────────────────────────────────────────────────────────────

@beta_tool
def ver_agenda(dias: int = 1) -> str:
    """Lista os próximos compromissos do Google Calendar.

    Args:
        dias: Quantos dias à frente olhar. 1 = só hoje, 7 = a semana.
    """
    try:
        servico = _servico("calendar", "v3")
        inicio = _agora()
        fim = inicio + timedelta(days=max(1, dias))
        eventos = (
            servico.events()
            .list(
                calendarId="primary",
                timeMin=inicio.isoformat(),
                timeMax=fim.isoformat(),
                singleEvents=True,
                orderBy="startTime",
                maxResults=50,
            )
            .execute()
            .get("items", [])
        )
    except Exception as e:
        return f"Erro ao consultar a agenda: {e}"

    if not eventos:
        return f"Nenhum compromisso nos próximos {dias} dia(s)."

    linhas = []
    for ev in eventos:
        inicio_ev = ev["start"].get("dateTime", ev["start"].get("date", ""))
        quando = inicio_ev.replace("T", " ")[:16]
        local = f" — {ev['location']}" if ev.get("location") else ""
        linhas.append(f"{quando} | {ev.get('summary', '(sem título)')}{local}")
    return "\n".join(linhas)


@beta_tool
def criar_evento(titulo: str, inicio: str, duracao_minutos: int = 60,
                 local: str = "", descricao: str = "") -> str:
    """Cria um compromisso no Google Calendar.

    Confirme com o usuário a data e o horário antes de criar se houver
    qualquer ambiguidade.

    Args:
        titulo: Nome do compromisso.
        inicio: Data e hora de início em ISO local, ex.: "2026-08-10T14:30".
        duracao_minutos: Duração em minutos.
        local: Endereço ou link da reunião.
        descricao: Detalhes adicionais.
    """
    try:
        dt_inicio = datetime.fromisoformat(inicio).replace(tzinfo=ZoneInfo(FUSO))
    except ValueError:
        return f"Data inválida: '{inicio}'. Use o formato 2026-08-10T14:30."

    dt_fim = dt_inicio + timedelta(minutes=duracao_minutos)
    corpo = {
        "summary": titulo,
        "start": {"dateTime": dt_inicio.isoformat(), "timeZone": FUSO},
        "end": {"dateTime": dt_fim.isoformat(), "timeZone": FUSO},
    }
    if local:
        corpo["location"] = local
    if descricao:
        corpo["description"] = descricao

    try:
        ev = _servico("calendar", "v3").events().insert(
            calendarId="primary", body=corpo
        ).execute()
    except Exception as e:
        return f"Erro ao criar o evento: {e}"

    return f"Criado: {titulo} em {dt_inicio.strftime('%d/%m às %H:%M')} ({ev.get('htmlLink')})"


# ─── E-mail ────────────────────────────────────────────────────────────

@beta_tool
def ler_emails(consulta: str = "is:unread", quantidade: int = 10) -> str:
    """Lista e-mails da caixa de entrada com remetente, assunto e um trecho.

    Args:
        consulta: Busca no formato do Gmail. Ex.: "is:unread",
            "from:banco@x.com", "newer_than:2d".
        quantidade: Quantos e-mails trazer (máximo 25).
    """
    try:
        servico = _servico("gmail", "v1")
        ids = (
            servico.users()
            .messages()
            .list(userId="me", q=consulta, maxResults=min(quantidade, 25))
            .execute()
            .get("messages", [])
        )
    except Exception as e:
        return f"Erro ao consultar o Gmail: {e}"

    if not ids:
        return f"Nenhum e-mail para a busca '{consulta}'."

    linhas = []
    for ref in ids:
        msg = (
            servico.users()
            .messages()
            .get(
                userId="me",
                id=ref["id"],
                format="metadata",
                metadataHeaders=["From", "Subject", "Date"],
            )
            .execute()
        )
        cab = {h["name"]: h["value"] for h in msg["payload"].get("headers", [])}
        linhas.append(
            f"De: {cab.get('From', '?')}\n"
            f"Assunto: {cab.get('Subject', '(sem assunto)')}\n"
            f"Trecho: {msg.get('snippet', '')[:200]}\n"
        )
    return "\n".join(linhas)


@beta_tool
def preparar_email(para: str, assunto: str, corpo: str) -> str:
    """Cria um RASCUNHO de e-mail no Gmail. Não envia — o usuário revisa e
    envia manualmente pelo Gmail.

    Args:
        para: Endereço do destinatário.
        assunto: Assunto do e-mail.
        corpo: Texto do e-mail.
    """
    from email.message import EmailMessage

    mensagem = EmailMessage()
    mensagem["To"] = para
    mensagem["Subject"] = assunto
    mensagem.set_content(corpo)

    bruto = base64.urlsafe_b64encode(mensagem.as_bytes()).decode()
    try:
        _servico("gmail", "v1").users().drafts().create(
            userId="me", body={"message": {"raw": bruto}}
        ).execute()
    except Exception as e:
        return f"Erro ao criar o rascunho: {e}"

    return f"Rascunho para {para} criado no Gmail. Revise antes de enviar."


FERRAMENTAS = [ver_agenda, criar_evento, ler_emails, preparar_email]
