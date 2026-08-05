"""Ferramentas de memória de longo prazo e lista de tarefas."""

from anthropic import beta_tool

import memory
from contexto import chat_atual


@beta_tool
def lembrar(fato: str) -> str:
    """Guarda um fato sobre o usuário para consultar em conversas futuras.

    Chame sempre que aparecer algo durável: preferências, nomes de pessoas,
    contexto de trabalho, decisões tomadas. Não guarde o que já está na
    conversa atual nem informação passageira ("estou com fome agora").
    Nunca guarde senhas, tokens ou dados de cartão.

    Args:
        fato: O fato, escrito de forma autocontida — ex.: "Trabalha com engenharia
            elétrica na Volttex", não "trabalha lá".
    """
    if len(fato) > 500:
        return "Fato muito longo. Resuma em uma ou duas frases."
    mid = memory.salvar_memoria(chat_atual.get(), fato.strip())
    return f"Guardado (memória #{mid})."


@beta_tool
def consultar_memorias() -> str:
    """Lista tudo que já foi guardado sobre o usuário. Use quando precisar de
    contexto que pode ter vindo de conversas anteriores.
    """
    linhas = memory.listar_memorias(chat_atual.get())
    if not linhas:
        return "Nenhuma memória guardada ainda."
    return "\n".join(f"#{l['id']} {l['texto']}" for l in linhas)


@beta_tool
def esquecer(memoria_id: int) -> str:
    """Apaga uma memória que ficou errada ou obsoleta.

    Args:
        memoria_id: O número da memória, obtido com consultar_memorias.
    """
    ok = memory.apagar_memoria(chat_atual.get(), memoria_id)
    return "Memória apagada." if ok else f"Não encontrei a memória #{memoria_id}."


@beta_tool
def criar_tarefa(descricao: str, prazo: str = "") -> str:
    """Adiciona uma tarefa à lista do usuário.

    Args:
        descricao: O que precisa ser feito.
        prazo: Data ou data e hora em ISO (ex.: "2026-08-10" ou
            "2026-08-10T14:00"). Vazio se não houver prazo.
    """
    tid = memory.criar_tarefa(chat_atual.get(), descricao.strip(), prazo.strip() or None)
    return f"Tarefa #{tid} criada."


@beta_tool
def listar_tarefas(incluir_concluidas: bool = False) -> str:
    """Lista as tarefas do usuário.

    Args:
        incluir_concluidas: True para mostrar também o que já foi concluído.
    """
    linhas = memory.listar_tarefas(chat_atual.get(), incluir_concluidas)
    if not linhas:
        return "Nenhuma tarefa pendente."
    saida = []
    for l in linhas:
        marca = "[x]" if l["concluida"] else "[ ]"
        prazo = f" (prazo {l['prazo']})" if l["prazo"] else ""
        saida.append(f"{marca} #{l['id']} {l['descricao']}{prazo}")
    return "\n".join(saida)


@beta_tool
def concluir_tarefa(tarefa_id: int) -> str:
    """Marca uma tarefa como concluída.

    Args:
        tarefa_id: O número da tarefa, obtido com listar_tarefas.
    """
    ok = memory.concluir_tarefa(chat_atual.get(), tarefa_id)
    return "Tarefa concluída." if ok else f"Não encontrei a tarefa #{tarefa_id}."


FERRAMENTAS = [
    lembrar,
    consultar_memorias,
    esquecer,
    criar_tarefa,
    listar_tarefas,
    concluir_tarefa,
]
