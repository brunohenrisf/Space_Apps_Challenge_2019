"""Contexto da requisição atual.

As ferramentas de memória e tarefas precisam saber de qual conversa vieram,
mas isso não é decisão do modelo — então viaja por contextvar em vez de
virar um parâmetro visível na assinatura da ferramenta.
"""

from contextvars import ContextVar

chat_atual: ContextVar[int] = ContextVar("chat_atual", default=0)
