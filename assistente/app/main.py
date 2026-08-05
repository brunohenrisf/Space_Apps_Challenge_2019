"""Bot do Telegram — a porta de entrada do assistente."""

import asyncio
import logging

from telegram import Update
from telegram.constants import ChatAction
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

import agent
import memory
from config import TELEGRAM_TOKEN, USUARIOS_AUTORIZADOS

logging.basicConfig(
    format="%(asctime)s %(levelname)s %(name)s — %(message)s", level=logging.INFO
)
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("assistente")

LIMITE_TELEGRAM = 4000  # o limite real é 4096; a folga evita erro de borda


def autorizado(update: Update) -> bool:
    return bool(update.effective_user) and update.effective_user.id in USUARIOS_AUTORIZADOS


async def _negar(update: Update) -> None:
    uid = update.effective_user.id if update.effective_user else "?"
    log.warning("Acesso negado para o usuário %s", uid)
    await update.message.reply_text(
        f"Você não tem acesso a este assistente.\nSeu ID do Telegram é {uid}."
    )


def _fatiar(texto: str) -> list[str]:
    """Quebra a resposta em pedaços que cabem numa mensagem do Telegram."""
    if len(texto) <= LIMITE_TELEGRAM:
        return [texto]

    pedacos, atual = [], ""
    for linha in texto.split("\n"):
        if len(atual) + len(linha) + 1 > LIMITE_TELEGRAM:
            if atual:
                pedacos.append(atual)
            # Linha única gigante: corta na força bruta.
            while len(linha) > LIMITE_TELEGRAM:
                pedacos.append(linha[:LIMITE_TELEGRAM])
                linha = linha[LIMITE_TELEGRAM:]
            atual = linha
        else:
            atual = f"{atual}\n{linha}" if atual else linha
    if atual:
        pedacos.append(atual)
    return pedacos


# ─── Comandos ──────────────────────────────────────────────────────────

async def cmd_id(update: Update, _: ContextTypes.DEFAULT_TYPE) -> None:
    """Funciona para qualquer um — é como você descobre seu ID na instalação."""
    await update.message.reply_text(f"Seu ID do Telegram é {update.effective_user.id}")


async def cmd_start(update: Update, _: ContextTypes.DEFAULT_TYPE) -> None:
    if not autorizado(update):
        return await _negar(update)
    await update.message.reply_text(
        "Pronto. Pode falar comigo normalmente.\n\n"
        "Eu cuido da casa, da sua agenda e e-mail, das suas tarefas e do "
        "servidor. Alguns exemplos:\n"
        "• apaga as luzes da sala\n"
        "• o que tenho na agenda amanhã?\n"
        "• lembra que o wifi novo é VOLTTEX_5G\n"
        "• como está o disco do servidor?\n\n"
        "/limpar apaga o histórico da conversa."
    )


async def cmd_limpar(update: Update, _: ContextTypes.DEFAULT_TYPE) -> None:
    if not autorizado(update):
        return await _negar(update)
    memory.limpar_conversa(update.effective_chat.id)
    await update.message.reply_text(
        "Histórico apagado. Suas memórias e tarefas continuam salvas."
    )


# ─── Mensagens ─────────────────────────────────────────────────────────

async def mensagem(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    if not autorizado(update):
        return await _negar(update)

    chat_id = update.effective_chat.id
    texto = update.message.text or ""
    log.info("[%s] %s", chat_id, texto[:120])

    parar = asyncio.Event()

    async def digitando() -> None:
        """Mantém o 'digitando...' vivo enquanto o agente trabalha."""
        while not parar.is_set():
            await context.bot.send_chat_action(chat_id, ChatAction.TYPING)
            try:
                await asyncio.wait_for(parar.wait(), timeout=5)
            except asyncio.TimeoutError:
                pass

    tarefa = asyncio.create_task(digitando())
    try:
        # O agente é síncrono e pode levar dezenas de segundos — vai para uma
        # thread para não travar o loop de eventos do bot.
        resposta = await asyncio.to_thread(agent.responder, chat_id, texto)
    except Exception:
        log.exception("Falha ao processar a mensagem")
        resposta = "Deu erro aqui do meu lado. Olha os logs do contêiner."
    finally:
        parar.set()
        await tarefa

    for pedaco in _fatiar(resposta):
        await update.message.reply_text(pedaco)


def main() -> None:
    memory.conectar()
    app = Application.builder().token(TELEGRAM_TOKEN).build()
    app.add_handler(CommandHandler("id", cmd_id))
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("limpar", cmd_limpar))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, mensagem))

    log.info("Assistente no ar. Usuários autorizados: %s", USUARIOS_AUTORIZADOS)
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
