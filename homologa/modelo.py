"""
Modelo de dados central do projeto de homologação.

TODA a informação do projeto vive aqui. Os cálculos (calculos.py) e os
geradores de documentos (geradores/) consomem estes objetos — ninguém digita
o mesmo dado duas vezes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# --------------------------------------------------------------------------- #
# Enums de domínio                                                             #
# --------------------------------------------------------------------------- #
class TipoLigacao(str, Enum):
    MONOFASICO = "Monofásico"
    BIFASICO = "Bifásico"
    TRIFASICO = "Trifásico"

    @property
    def n_fases(self) -> int:
        return {"Monofásico": 1, "Bifásico": 2, "Trifásico": 3}[self.value]


class ClasseConsumo(str, Enum):
    RESIDENCIAL = "Residencial"
    COMERCIAL = "Comercial"
    INDUSTRIAL = "Industrial"
    RURAL = "Rural"
    PODER_PUBLICO = "Poder Público"


class TipoPessoa(str, Enum):
    FISICA = "Física"
    JURIDICA = "Jurídica"


# --------------------------------------------------------------------------- #
# Cadastro                                                                     #
# --------------------------------------------------------------------------- #
@dataclass
class Titular:
    """Cliente que assina a ART e a autorização de representação técnica."""
    nome: str = ""
    tipo_pessoa: TipoPessoa = TipoPessoa.FISICA
    cpf_cnpj: str = ""
    rg: str = ""
    orgao_emissor: str = ""
    email: str = ""
    telefone: str = ""


@dataclass
class Endereco:
    logradouro: str = ""
    numero: str = ""
    complemento: str = ""
    bairro: str = ""
    cidade: str = ""
    uf: str = "MA"
    cep: str = ""
    # Coordenadas para a planta de situação (graus decimais)
    latitude: Optional[float] = None
    longitude: Optional[float] = None

    def uma_linha(self) -> str:
        partes = [self.logradouro]
        if self.numero:
            partes.append(f"nº {self.numero}")
        if self.complemento:
            partes.append(self.complemento)
        if self.bairro:
            partes.append(self.bairro)
        cidade_uf = ", ".join(p for p in [self.cidade, self.uf] if p)
        if cidade_uf:
            partes.append(cidade_uf)
        if self.cep:
            partes.append(f"CEP {self.cep}")
        return ", ".join(p for p in partes if p)


@dataclass
class UnidadeConsumidora:
    """Unidade geradora (matriz) — onde o sistema é instalado."""
    numero_uc: str = ""
    numero_medidor: str = ""
    classe: ClasseConsumo = ClasseConsumo.RESIDENCIAL
    tipo_ligacao: TipoLigacao = TipoLigacao.TRIFASICO
    tensao_v: float = 380.0            # tensão de linha da ligação (V)
    disjuntor_entrada_a: float = 0.0   # corrente do disjuntor de entrada (A)
    endereco: Endereco = field(default_factory=Endereco)
    titular: Titular = field(default_factory=Titular)


@dataclass
class Beneficiaria:
    """Unidade que recebe crédito do sistema de compensação (rateio)."""
    numero_uc: str = ""
    titular_nome: str = ""
    endereco: Endereco = field(default_factory=Endereco)
    percentual_rateio: float = 0.0     # % do excedente destinado a esta UC


# --------------------------------------------------------------------------- #
# Gerador fotovoltaico                                                         #
# --------------------------------------------------------------------------- #
@dataclass
class Modulo:
    """Módulo (placa) fotovoltaico."""
    fabricante: str = ""
    modelo: str = ""
    potencia_wp: float = 0.0           # potência de pico por módulo (Wp)
    quantidade: int = 0
    # Elétricos opcionais (para o memorial e diagramas)
    voc_v: Optional[float] = None      # tensão de circuito aberto
    isc_a: Optional[float] = None      # corrente de curto-circuito

    @property
    def potencia_total_wp(self) -> float:
        return self.potencia_wp * self.quantidade


@dataclass
class Inversor:
    """Inversor / microinversor."""
    fabricante: str = ""
    modelo: str = ""
    potencia_ca_w: float = 0.0         # potência nominal de saída CA por unidade (W)
    quantidade: int = 0
    n_mppt: Optional[int] = None
    tensao_saida_v: Optional[float] = None
    corrente_saida_max_a: Optional[float] = None

    @property
    def potencia_total_ca_w(self) -> float:
        return self.potencia_ca_w * self.quantidade


@dataclass
class Gerador:
    """Conjunto de módulos e inversores do sistema."""
    modulos: list[Modulo] = field(default_factory=list)
    inversores: list[Inversor] = field(default_factory=list)


# --------------------------------------------------------------------------- #
# Responsável técnico e concessionária                                         #
# --------------------------------------------------------------------------- #
@dataclass
class ResponsavelTecnico:
    """Engenheiro responsável — dados que vão na ART e na autorização."""
    nome: str = ""
    titulo: str = "Engenheiro Eletricista"
    crea: str = ""
    art: str = ""                      # número da ART emitida
    email: str = ""
    telefone: str = ""
    empresa: str = ""
    cnpj_empresa: str = ""


@dataclass
class Concessionaria:
    nome: str = "Equatorial Maranhão"
    uf: str = "MA"


# --------------------------------------------------------------------------- #
# Projeto (raiz)                                                               #
# --------------------------------------------------------------------------- #
@dataclass
class Projeto:
    """Raiz do cadastro — agrega todo o pacote de homologação."""
    identificador: str = ""            # ex.: "2026-001" ou nome do cliente
    unidade_geradora: UnidadeConsumidora = field(default_factory=UnidadeConsumidora)
    beneficiarias: list[Beneficiaria] = field(default_factory=list)
    gerador: Gerador = field(default_factory=Gerador)
    responsavel_tecnico: ResponsavelTecnico = field(default_factory=ResponsavelTecnico)
    concessionaria: Concessionaria = field(default_factory=Concessionaria)
    data_emissao: str = ""             # preenchida na geração (passada de fora)

    @property
    def titular(self) -> Titular:
        return self.unidade_geradora.titular
