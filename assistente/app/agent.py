"""O agente: monta o contexto, chama o Claude e executa as ferramentas."""

import logging
from datetime import datetime
from zoneinfo import ZoneInfo

import anthropic

import memory
from config import ANTHROPIC_API_KEY, ESFORCO, FUSO, MAX_TOKENS, MODELO
from contexto import chat_atual
from tools import TODAS

log = logging.getLogger(__name__)

cliente = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# Recursos que dependem da versão do SDK / do modelo. Se a primeira chamada
# recusar, desligamos e seguimos sem — nada quebra por causa disso.
_usar_fallback = True
_usar_system_no_meio = True

INSTRUCOES = """\
Você é o assistente pessoal do Bruno. Conversa com ele pelo Telegram, então \
escreve como uma pessoa escreveria numa mensagem — não como um relatório.

# Contexto
Bruno é engenheiro e mantém um servidor doméstico (CasaOS num notebook Lenovo, \
IP 10.0.0.103) rodando Jellyfin, qBittorrent e Home Assistant. A casa tem \
lâmpadas, tomadas e portão automatizados. Você ajuda tanto na vida pessoal \
quanto no trabalho dele.

# Como responder
Vá direto ao ponto. Primeira frase responde a pergunta; detalhe vem depois, \
e só se ajudar. Nada de repetir a pergunta, listar o que você vai fazer antes \
de fazer, ou fechar com "quer que eu faça mais alguma coisa?".

Em mensagem de celular, um parágrafo curto vale mais que uma lista com \
títulos. Use listas apenas quando os itens forem realmente uma enumeração \
(tarefas, compromissos, resultados de busca).

Sem markdown pesado: negrito ocasional serve, títulos e tabelas não — o \
Telegram renderiza mal e ninguém lê tabela no celular.

# Ferramentas
Consulte as ferramentas em vez de responder de memória sempre que a pergunta \
depender do estado atual da casa, do servidor, da agenda ou do e-mail. Antes \
de ligar ou desligar qualquer coisa, confirme o entity_id com \
listar_dispositivos — não adivinhe.

Guarde com `lembrar` o que for durável (preferências, pessoas, decisões, \
contexto de trabalho) e consulte as memórias quando faltar contexto. Nunca \
guarde senhas, tokens ou dados bancários.

# Limites
Faça o que foi pedido, no tamanho que foi pedido. Se achar que o pedido está \
errado ou existe caminho melhor, diga em uma frase e siga com o que foi \
pedido — não mude o escopo por conta própria. Termine o que começou: só diga \
que está pronto quando estiver, e se algo não deu, diga o que faltou e por quê.

Ações difíceis de desfazer — abrir o portão, apagar arquivo, mandar e-mail — \
pergunte antes. E-mail você só prepara como rascunho, nunca envia.

Se uma ferramenta falhar, diga o que aconteceu com as palavras do erro; não \
invente que deu certo nem tente de novo em loop.
"""


def _contexto_temporal() -> str:
    agora = datetime.now(ZoneInfo(FUSO))
    dias = ["segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo"]
    return (
        f"Agora são {agora.strftime('%H:%M')} de {dias[agora.weekday()]}-feira, "
        f"{agora.strftime('%d/%m/%Y')} ({FUSO})."
    )


def _sistema() -> list[dict]:
    # cache_control mantém o prompt de sistema em cache entre mensagens:
    # a partir da segunda, esses tokens custam ~10% do preço normal.
    return [
        {
            "type": "text",
            "text": INSTRUCOES,
            "cache_control": {"type": "ephemeral"},
        }
    ]


def _extrair_texto(mensagem) -> str:
    return "\n".join(
        bloco.text for bloco in mensagem.content if bloco.type == "text"
    ).strip()


def _parametros(mensagens: list[dict]) -> dict:
    params = {
        "model": MODELO,
        "max_tokens": MAX_TOKENS,
        "system": _sistema(),
        "messages": mensagens,
        "tools": TODAS,
        "thinking": {"type": "adaptive"},
        "output_config": {"effort": ESFORCO},
    }
    if _usar_fallback:
        # Se os classificadores de segurança recusarem o pedido, a API refaz a
        # chamada num modelo alternativo em vez de devolver a recusa.
        params["betas"] = ["server-side-fallback-2026-07-01"]
        params["fallbacks"] = "default"
    return params


def responder(chat_id: int, texto: str) -> str:
    """Processa uma mensagem do usuário e devolve a resposta do assistente."""
    global _usar_fallback, _usar_system_no_meio

    chat_atual.set(chat_id)

    historico = memory.carregar_historico(chat_id)
    mensagem_usuario = {"role": "user", "content": texto}
    mensagens = [*historico, mensagem_usuario]

    if _usar_system_no_meio:
        # A data/hora entra DEPOIS do histórico, não no prompt de sistema —
        # assim o prefixo em cache continua idêntico a cada mensagem.
        mensagens.append({"role": "system", "content": _contexto_temporal()})
    else:
        mensagens[-1] = {
            "role": "user",
            "content": f"[{_contexto_temporal()}]\n\n{texto}",
        }

    final = None
    try:
        runner = cliente.beta.messages.tool_runner(**_parametros(mensagens))
        for mensagem in runner:
            final = mensagem
            for bloco in mensagem.content:
                if bloco.type == "tool_use":
                    log.info("ferramenta: %s(%s)", bloco.name, bloco.input)

    except TypeError:
        # Versão do SDK sem suporte a fallbacks — desliga e refaz.
        if not _usar_fallback:
            raise
        log.warning("SDK sem suporte a fallbacks; seguindo sem.")
        _usar_fallback = False
        return responder(chat_id, texto)

    except anthropic.BadRequestError as e:
        if _usar_system_no_meio and "system" in str(e).lower():
            log.warning("Modelo sem suporte a system no meio da conversa; seguindo sem.")
            _usar_system_no_meio = False
            return responder(chat_id, texto)
        log.exception("Requisição inválida")
        return f"A API recusou a requisição: {e}"

    except anthropic.RateLimitError:
        return "Estou no limite de uso da API agora. Tenta de novo em alguns minutos."

    except anthropic.APIConnectionError:
        return "Não consegui falar com a API do Claude. Verifique a internet do servidor."

    except anthropic.APIStatusError as e:
        log.exception("Erro da API")
        return f"Erro da API ({e.status_code}). Tenta de novo daqui a pouco."

    if final is None:
        return "Não recebi resposta do modelo. Tenta de novo."

    if final.stop_reason == "refusal":
        return "Não consigo ajudar com isso — o pedido foi recusado pelos filtros de segurança."

    resposta = _extrair_texto(final)

    if final.stop_reason == "max_tokens":
        resposta += "\n\n(resposta cortada no limite de tokens)"

    if not resposta:
        return "Terminei, mas não gerei texto de resposta. Pode reformular?"

    # Guarda só o par usuário/assistente — o contexto temporal é recriado
    # a cada chamada e não precisa ficar no histórico.
    memory.gravar_mensagem(chat_id, "user", texto)
    memory.gravar_mensagem(chat_id, "assistant", resposta)

    if final.usage:
        log.info(
            "tokens: entrada=%s cache_leitura=%s saída=%s",
            final.usage.input_tokens,
            getattr(final.usage, "cache_read_input_tokens", 0),
            final.usage.output_tokens,
        )

    return resposta
