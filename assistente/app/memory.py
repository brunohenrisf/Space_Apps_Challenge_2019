"""Persistência em SQLite: histórico de conversa, memórias e tarefas."""

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from config import BANCO, HISTORICO_MAX

_lock = threading.Lock()
_conexao: sqlite3.Connection | None = None

ESQUEMA = """
CREATE TABLE IF NOT EXISTS conversa (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id   INTEGER NOT NULL,
    papel     TEXT    NOT NULL,   -- user | assistant
    conteudo  TEXT    NOT NULL,   -- JSON dos content blocks
    criado_em TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversa_chat ON conversa (chat_id, id);

CREATE TABLE IF NOT EXISTS memoria (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id   INTEGER NOT NULL,
    texto     TEXT    NOT NULL,
    criado_em TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memoria_chat ON memoria (chat_id);

CREATE TABLE IF NOT EXISTS tarefa (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_id     INTEGER NOT NULL,
    descricao   TEXT    NOT NULL,
    prazo       TEXT,
    concluida   INTEGER NOT NULL DEFAULT 0,
    criado_em   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tarefa_chat ON tarefa (chat_id, concluida);
"""


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def conectar() -> sqlite3.Connection:
    global _conexao
    if _conexao is None:
        Path(BANCO).parent.mkdir(parents=True, exist_ok=True)
        _conexao = sqlite3.connect(BANCO, check_same_thread=False)
        _conexao.row_factory = sqlite3.Row
        _conexao.executescript(ESQUEMA)
        _conexao.commit()
    return _conexao


# ─── Histórico de conversa ─────────────────────────────────────────────

def carregar_historico(chat_id: int) -> list[dict]:
    """Devolve as últimas mensagens no formato esperado pela API."""
    with _lock:
        linhas = conectar().execute(
            "SELECT papel, conteudo FROM conversa WHERE chat_id = ? "
            "ORDER BY id DESC LIMIT ?",
            (chat_id, HISTORICO_MAX),
        ).fetchall()

    mensagens = [
        {"role": l["papel"], "content": json.loads(l["conteudo"])}
        for l in reversed(linhas)
    ]

    # A API exige que a conversa comece com uma mensagem do usuário.
    while mensagens and mensagens[0]["role"] != "user":
        mensagens.pop(0)
    return mensagens


def gravar_mensagem(chat_id: int, papel: str, conteudo) -> None:
    with _lock:
        con = conectar()
        con.execute(
            "INSERT INTO conversa (chat_id, papel, conteudo, criado_em) VALUES (?,?,?,?)",
            (chat_id, papel, json.dumps(conteudo, default=str), _agora()),
        )
        con.commit()


def limpar_conversa(chat_id: int) -> None:
    with _lock:
        con = conectar()
        con.execute("DELETE FROM conversa WHERE chat_id = ?", (chat_id,))
        con.commit()


# ─── Memórias ──────────────────────────────────────────────────────────

def salvar_memoria(chat_id: int, texto: str) -> int:
    with _lock:
        con = conectar()
        cur = con.execute(
            "INSERT INTO memoria (chat_id, texto, criado_em) VALUES (?,?,?)",
            (chat_id, texto, _agora()),
        )
        con.commit()
        return cur.lastrowid


def listar_memorias(chat_id: int) -> list[sqlite3.Row]:
    with _lock:
        return conectar().execute(
            "SELECT id, texto, criado_em FROM memoria WHERE chat_id = ? ORDER BY id",
            (chat_id,),
        ).fetchall()


def apagar_memoria(chat_id: int, memoria_id: int) -> bool:
    with _lock:
        con = conectar()
        cur = con.execute(
            "DELETE FROM memoria WHERE chat_id = ? AND id = ?", (chat_id, memoria_id)
        )
        con.commit()
        return cur.rowcount > 0


# ─── Tarefas ───────────────────────────────────────────────────────────

def criar_tarefa(chat_id: int, descricao: str, prazo: str | None) -> int:
    with _lock:
        con = conectar()
        cur = con.execute(
            "INSERT INTO tarefa (chat_id, descricao, prazo, criado_em) VALUES (?,?,?,?)",
            (chat_id, descricao, prazo, _agora()),
        )
        con.commit()
        return cur.lastrowid


def listar_tarefas(chat_id: int, incluir_concluidas: bool) -> list[sqlite3.Row]:
    sql = "SELECT id, descricao, prazo, concluida FROM tarefa WHERE chat_id = ?"
    if not incluir_concluidas:
        sql += " AND concluida = 0"
    sql += " ORDER BY concluida, COALESCE(prazo, '9999'), id"
    with _lock:
        return conectar().execute(sql, (chat_id,)).fetchall()


def concluir_tarefa(chat_id: int, tarefa_id: int) -> bool:
    with _lock:
        con = conectar()
        cur = con.execute(
            "UPDATE tarefa SET concluida = 1 WHERE chat_id = ? AND id = ?",
            (chat_id, tarefa_id),
        )
        con.commit()
        return cur.rowcount > 0
