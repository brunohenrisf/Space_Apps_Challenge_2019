"""
Interface desktop (Tkinter) para cadastrar o projeto e gerar o pacote.

Rode:  python3 -m homologa      (ou python3 app.py)

A janela tem abas para Titular/UC, Gerador (módulos e inversores),
Beneficiárias (rateio) e Responsável técnico. O botão "Gerar pacote" valida,
mostra os cálculos e grava os documentos na pasta escolhida.

A lógica "formulário → Projeto" fica isolada (montar_projeto) para ser testável
sem abrir a tela.
"""

from __future__ import annotations

import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from .calculos import calcular, validar
from .modelo import (
    Beneficiaria, ClasseConsumo, Endereco, Gerador, Inversor, Modulo,
    Projeto, ResponsavelTecnico, TipoLigacao, TipoPessoa, Titular,
    UnidadeConsumidora,
)
from .pacote import gerar_pacote

# Tensões usuais por tipo de ligação (V) — apenas sugestão inicial
TENSAO_PADRAO = {
    TipoLigacao.MONOFASICO: 220.0,
    TipoLigacao.BIFASICO: 220.0,
    TipoLigacao.TRIFASICO: 380.0,
}


def _f(valor: str, padrao: float = 0.0) -> float:
    """Converte texto em float aceitando vírgula decimal; vazio → padrão."""
    if valor is None:
        return padrao
    valor = str(valor).strip().replace(".", "").replace(",", ".") \
        if valor.count(",") == 1 and valor.count(".") >= 1 else str(valor).strip().replace(",", ".")
    try:
        return float(valor)
    except ValueError:
        return padrao


def _i(valor: str, padrao: int = 0) -> int:
    try:
        return int(float(str(valor).strip().replace(",", ".")))
    except (ValueError, TypeError):
        return padrao


# --------------------------------------------------------------------------- #
# Widget auxiliar: tabela dinâmica (linhas com botão +/-)                      #
# --------------------------------------------------------------------------- #
class TabelaDinamica(ttk.Frame):
    """Tabela onde o usuário adiciona/remove linhas de campos."""

    def __init__(self, master, colunas: list[tuple[str, int]]):
        super().__init__(master)
        self.colunas = colunas          # [(rótulo, largura), ...]
        self.linhas: list[list[tk.Entry]] = []

        self._cab = ttk.Frame(self)
        self._cab.pack(fill="x")
        for texto, larg in colunas:
            ttk.Label(self._cab, text=texto, width=larg,
                      anchor="w").pack(side="left", padx=2)
        ttk.Label(self._cab, text="", width=4).pack(side="left")

        self._corpo = ttk.Frame(self)
        self._corpo.pack(fill="x")

        ttk.Button(self, text="+ adicionar linha",
                   command=self.adicionar).pack(anchor="w", pady=(4, 0))

    def adicionar(self, valores: list[str] | None = None) -> None:
        linha = ttk.Frame(self._corpo)
        linha.pack(fill="x", pady=1)
        entries: list[tk.Entry] = []
        for i, (_, larg) in enumerate(self.colunas):
            e = ttk.Entry(linha, width=larg)
            if valores and i < len(valores):
                e.insert(0, valores[i])
            e.pack(side="left", padx=2)
            entries.append(e)
        ttk.Button(linha, text="✕", width=3,
                   command=lambda: self._remover(linha, entries)).pack(side="left")
        self.linhas.append(entries)

    def _remover(self, linha_frame, entries) -> None:
        if entries in self.linhas:
            self.linhas.remove(entries)
        linha_frame.destroy()

    def valores(self) -> list[list[str]]:
        return [[e.get() for e in linha] for linha in self.linhas]


# --------------------------------------------------------------------------- #
# Aplicação principal                                                          #
# --------------------------------------------------------------------------- #
class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Homologa — Pacote de Homologação FV (Equatorial MA)")
        self.geometry("880x680")
        self.vars: dict[str, tk.Variable] = {}

        nb = ttk.Notebook(self)
        nb.pack(fill="both", expand=True, padx=8, pady=8)

        self._aba_titular_uc(nb)
        self._aba_gerador(nb)
        self._aba_beneficiarias(nb)
        self._aba_responsavel(nb)

        rodape = ttk.Frame(self)
        rodape.pack(fill="x", padx=8, pady=(0, 8))
        ttk.Button(rodape, text="Pré-visualizar cálculos",
                   command=self.previa).pack(side="left")
        ttk.Button(rodape, text="Gerar pacote",
                   command=self.gerar).pack(side="right")
        self.saida_var = tk.StringVar(value=str(Path.cwd() / "saida"))
        ttk.Button(rodape, text="Pasta de saída…",
                   command=self._escolher_pasta).pack(side="right", padx=6)

    # -- helpers de campo -------------------------------------------------- #
    def _campo(self, master, rotulo, chave, largura=32, valor=""):
        linha = ttk.Frame(master)
        linha.pack(fill="x", pady=2)
        ttk.Label(linha, text=rotulo, width=26, anchor="w").pack(side="left")
        var = tk.StringVar(value=valor)
        ttk.Entry(linha, textvariable=var, width=largura).pack(side="left")
        self.vars[chave] = var
        return var

    def _combo(self, master, rotulo, chave, valores, valor):
        linha = ttk.Frame(master)
        linha.pack(fill="x", pady=2)
        ttk.Label(linha, text=rotulo, width=26, anchor="w").pack(side="left")
        var = tk.StringVar(value=valor)
        ttk.Combobox(linha, textvariable=var, values=valores, width=30,
                     state="readonly").pack(side="left")
        self.vars[chave] = var
        return var

    # -- abas -------------------------------------------------------------- #
    def _aba_titular_uc(self, nb):
        f = ttk.Frame(nb, padding=10)
        nb.add(f, text="Titular / UC")

        ttk.Label(f, text="Titular", font=("", 10, "bold")).pack(anchor="w")
        self._campo(f, "Nome", "tit_nome")
        self._combo(f, "Tipo de pessoa", "tit_tipo",
                    [t.value for t in TipoPessoa], TipoPessoa.FISICA.value)
        self._campo(f, "CPF/CNPJ", "tit_doc")
        self._campo(f, "RG", "tit_rg")
        self._campo(f, "E-mail", "tit_email")
        self._campo(f, "Telefone", "tit_tel")

        ttk.Separator(f).pack(fill="x", pady=8)
        ttk.Label(f, text="Unidade geradora (matriz)",
                  font=("", 10, "bold")).pack(anchor="w")
        self._campo(f, "Nº da UC", "uc_numero")
        self._campo(f, "Nº do medidor", "uc_medidor")
        self._combo(f, "Classe", "uc_classe",
                    [c.value for c in ClasseConsumo], ClasseConsumo.RESIDENCIAL.value)
        self._combo(f, "Tipo de ligação", "uc_ligacao",
                    [t.value for t in TipoLigacao], TipoLigacao.TRIFASICO.value)
        self._campo(f, "Tensão (V)", "uc_tensao", valor="380")
        self._campo(f, "Disjuntor de entrada (A)", "uc_disjuntor")

        ttk.Separator(f).pack(fill="x", pady=8)
        ttk.Label(f, text="Endereço da instalação",
                  font=("", 10, "bold")).pack(anchor="w")
        self._campo(f, "Logradouro", "end_log")
        self._campo(f, "Número", "end_num", largura=12)
        self._campo(f, "Bairro", "end_bairro")
        self._campo(f, "Cidade", "end_cidade")
        self._campo(f, "UF", "end_uf", largura=6, valor="MA")
        self._campo(f, "CEP", "end_cep", largura=14)
        self._campo(f, "Latitude", "end_lat", largura=14)
        self._campo(f, "Longitude", "end_lon", largura=14)

    def _aba_gerador(self, nb):
        f = ttk.Frame(nb, padding=10)
        nb.add(f, text="Gerador")
        ttk.Label(f, text="Módulos fotovoltaicos",
                  font=("", 10, "bold")).pack(anchor="w")
        self.tab_modulos = TabelaDinamica(
            f, [("Fabricante", 20), ("Modelo", 20), ("Pot. (Wp)", 10), ("Qtd.", 8)])
        self.tab_modulos.pack(fill="x", pady=4)

        ttk.Separator(f).pack(fill="x", pady=10)
        ttk.Label(f, text="Inversores", font=("", 10, "bold")).pack(anchor="w")
        self.tab_inversores = TabelaDinamica(
            f, [("Fabricante", 20), ("Modelo", 20), ("Pot. CA (W)", 12), ("Qtd.", 8)])
        self.tab_inversores.pack(fill="x", pady=4)

    def _aba_beneficiarias(self, nb):
        f = ttk.Frame(nb, padding=10)
        nb.add(f, text="Beneficiárias (rateio)")
        ttk.Label(f, text="Deixe vazio se não houver rateio. A soma deve dar 100%.",
                  foreground="#555").pack(anchor="w", pady=(0, 6))
        self.tab_benef = TabelaDinamica(
            f, [("Nº da UC", 18), ("Titular", 28), ("Rateio (%)", 12)])
        self.tab_benef.pack(fill="x")

    def _aba_responsavel(self, nb):
        f = ttk.Frame(nb, padding=10)
        nb.add(f, text="Responsável técnico")
        self._campo(f, "Nome", "rt_nome")
        self._campo(f, "Título", "rt_titulo", valor="Engenheiro Eletricista")
        self._campo(f, "CREA", "rt_crea")
        self._campo(f, "ART", "rt_art")
        self._campo(f, "E-mail", "rt_email")
        self._campo(f, "Empresa", "rt_empresa")
        ttk.Separator(f).pack(fill="x", pady=8)
        self._campo(f, "Identificador do projeto", "proj_id", valor="")
        self._campo(f, "Data de emissão", "proj_data", valor="")

    # -- construção do Projeto (testável) ---------------------------------- #
    def montar_projeto(self) -> Projeto:
        v = {k: var.get() for k, var in self.vars.items()}

        titular = Titular(
            nome=v["tit_nome"], tipo_pessoa=TipoPessoa(v["tit_tipo"]),
            cpf_cnpj=v["tit_doc"], rg=v["tit_rg"],
            email=v["tit_email"], telefone=v["tit_tel"],
        )
        endereco = Endereco(
            logradouro=v["end_log"], numero=v["end_num"], bairro=v["end_bairro"],
            cidade=v["end_cidade"], uf=v["end_uf"], cep=v["end_cep"],
            latitude=_f(v["end_lat"]) or None, longitude=_f(v["end_lon"]) or None,
        )
        uc = UnidadeConsumidora(
            numero_uc=v["uc_numero"], numero_medidor=v["uc_medidor"],
            classe=ClasseConsumo(v["uc_classe"]),
            tipo_ligacao=TipoLigacao(v["uc_ligacao"]),
            tensao_v=_f(v["uc_tensao"]), disjuntor_entrada_a=_f(v["uc_disjuntor"]),
            endereco=endereco, titular=titular,
        )
        modulos = [
            Modulo(fabricante=r[0], modelo=r[1],
                   potencia_wp=_f(r[2]), quantidade=_i(r[3]))
            for r in self.tab_modulos.valores() if any(c.strip() for c in r)
        ]
        inversores = [
            Inversor(fabricante=r[0], modelo=r[1],
                     potencia_ca_w=_f(r[2]), quantidade=_i(r[3]))
            for r in self.tab_inversores.valores() if any(c.strip() for c in r)
        ]
        beneficiarias = [
            Beneficiaria(numero_uc=r[0], titular_nome=r[1],
                         percentual_rateio=_f(r[2]))
            for r in self.tab_benef.valores() if any(c.strip() for c in r)
        ]
        rt = ResponsavelTecnico(
            nome=v["rt_nome"], titulo=v["rt_titulo"], crea=v["rt_crea"],
            art=v["rt_art"], email=v["rt_email"], empresa=v["rt_empresa"],
        )
        return Projeto(
            identificador=v["proj_id"], unidade_geradora=uc,
            beneficiarias=beneficiarias, gerador=Gerador(modulos, inversores),
            responsavel_tecnico=rt, data_emissao=v["proj_data"],
        )

    # -- ações ------------------------------------------------------------- #
    def _escolher_pasta(self):
        pasta = filedialog.askdirectory(initialdir=self.saida_var.get() or ".")
        if pasta:
            self.saida_var.set(pasta)

    def previa(self):
        projeto = self.montar_projeto()
        res = calcular(projeto)
        problemas = validar(projeto, res)
        msg = (
            f"Potência de geração: {res.potencia_geracao_kwp:.2f} kWp\n"
            f"Potência instalada CA: {res.potencia_instalada_kw:.2f} kW\n"
            f"Relação FV/inversor: {res.relacao_fv_inversor:.2f}\n"
            f"Corrente de saída: {res.corrente_saida_a:.2f} A\n"
            f"Disjuntor do gerador: {res.disjuntor_gerador_comercial_a} A\n"
            f"Classificação: {res.classificacao}\n"
        )
        if problemas:
            msg += "\nAtenção:\n" + "\n".join(f"• {p}" for p in problemas)
        messagebox.showinfo("Pré-visualização dos cálculos", msg)

    def gerar(self):
        projeto = self.montar_projeto()
        problemas = validar(projeto)
        if problemas:
            seguir = messagebox.askyesno(
                "Validação",
                "Foram encontrados problemas:\n\n"
                + "\n".join(f"• {p}" for p in problemas)
                + "\n\nGerar mesmo assim?")
            if not seguir:
                return
        r = gerar_pacote(projeto, self.saida_var.get(), ignorar_validacao=True)
        nomes = "\n".join(f"• {c.name}" for c in r["arquivos"].values())
        messagebox.showinfo(
            "Pacote gerado",
            f"Gerado em:\n{r['pasta']}\n\nArquivos:\n{nomes}")


def main():
    App().mainloop()


if __name__ == "__main__":
    main()
