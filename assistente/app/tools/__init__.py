"""Reúne todas as ferramentas disponíveis para o assistente."""

from tools import agenda, casa, notas, servidor

TODAS = [
    *casa.FERRAMENTAS,
    *notas.FERRAMENTAS,
    *servidor.FERRAMENTAS,
    *agenda.FERRAMENTAS,
]
