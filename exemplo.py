"""
Exemplo de uso — cria um projeto fictício e gera o pacote completo.

Rode:  python3 exemplo.py
Saída: pasta ./saida/<projeto>/ com memorial, autorização, rateio e unifilar.
"""

from homologa.modelo import (
    Beneficiaria, ClasseConsumo, Endereco, Gerador, Inversor, Modulo,
    Projeto, ResponsavelTecnico, TipoLigacao, Titular, UnidadeConsumidora,
)
from homologa.pacote import gerar_pacote


def projeto_exemplo() -> Projeto:
    titular = Titular(
        nome="João da Silva",
        cpf_cnpj="123.456.789-00",
        rg="1234567 SSP-MA",
        email="joao@exemplo.com",
        telefone="(98) 99999-0000",
    )
    endereco = Endereco(
        logradouro="Rua das Palmeiras", numero="100", bairro="Centro",
        cidade="São Luís", uf="MA", cep="65000-000",
        latitude=-2.53, longitude=-44.30,
    )
    uc = UnidadeConsumidora(
        numero_uc="000123456", numero_medidor="MED987654",
        classe=ClasseConsumo.RESIDENCIAL, tipo_ligacao=TipoLigacao.TRIFASICO,
        tensao_v=380.0, disjuntor_entrada_a=63.0,
        endereco=endereco, titular=titular,
    )
    gerador = Gerador(
        modulos=[Modulo("Canadian Solar", "CS7N-660MS", 660.0, 18)],
        inversores=[Inversor("Growatt", "MIN 10000TL-X", 10000.0, 1, n_mppt=2)],
    )
    rt = ResponsavelTecnico(
        nome="Maria Engenheira", crea="MA-12345/D", art="MA20260001234",
        email="maria@volttex.com", empresa="Volttex Engenharia",
    )
    beneficiarias = [
        Beneficiaria("000222333", "João da Silva", percentual_rateio=60.0),
        Beneficiaria("000444555", "Loja do João ME", percentual_rateio=40.0),
    ]
    return Projeto(
        identificador="2026-001",
        unidade_geradora=uc, beneficiarias=beneficiarias,
        gerador=gerador, responsavel_tecnico=rt,
        data_emissao="19 de julho de 2026",
    )


if __name__ == "__main__":
    projeto = projeto_exemplo()
    r = gerar_pacote(projeto, "saida")
    if not r["ok"]:
        print("Validação falhou:")
        for p in r["problemas"]:
            print(f"  - {p}")
    else:
        res = r["resultado"]
        print(f"Pacote gerado em: {r['pasta']}")
        print(f"  Potência geração: {res.potencia_geracao_kwp:.2f} kWp")
        print(f"  Potência CA:      {res.potencia_instalada_kw:.2f} kW")
        print(f"  Classificação:    {res.classificacao}")
        print(f"  Corrente saída:   {res.corrente_saida_a:.2f} A")
        print(f"  Disjuntor gerador:{res.disjuntor_gerador_comercial_a} A")
        print("  Arquivos:")
        for nome, caminho in r["arquivos"].items():
            print(f"    - {nome}: {caminho.name}")
        if r["problemas"]:
            print("  Avisos:")
            for p in r["problemas"]:
                print(f"    - {p}")
