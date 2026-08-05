#!/usr/bin/env python3
"""Organiza episódios soltos na estrutura de pastas que o Jellyfin entende.

    Nome da Série (Ano)/Season 01/Nome da Série S01E01.mkv

Uso:
    ./organizar-series.py /DATA/Downloads                      # simulação
    ./organizar-series.py /DATA/Downloads --aplicar            # move de verdade
    ./organizar-series.py /DATA/Downloads --destino /DATA/Media/Shows --aplicar
    ./organizar-series.py /DATA/Downloads --copiar --aplicar   # copia em vez de mover

Por segurança, sem --aplicar ele só mostra o que faria.
"""

import argparse
import re
import shutil
import sys
from pathlib import Path

VIDEOS = {".mkv", ".mp4", ".avi", ".m4v", ".mov", ".wmv", ".ts"}
LEGENDAS = {".srt", ".ass", ".ssa", ".sub", ".vtt"}

# Padrões de episódio, do mais específico para o mais genérico.
PADROES = [
    # S01E01, S01E01E02 e a variante brasileira T03E01 (T de Temporada)
    re.compile(r"[SsTt](\d{1,2})[\s._-]*[Ee](\d{1,3})(?:[\s._-]*[Ee](\d{1,3}))?"),
    re.compile(r"(\d{1,2})x(\d{1,3})"),                                            # 1x01
    re.compile(r"[Tt]emporada[\s._-]*(\d{1,2}).*?[Ee]pis[oó]dio[\s._-]*(\d{1,3})"),
]

ANO = re.compile(r"[\(\[\s._-](19\d{2}|20\d{2})[\)\]\s._-]")

# Lixo típico de nome de release, cortado do título da série.
RUIDO = re.compile(
    r"\b(1080p|2160p|720p|480p|4k|uhd|hdr|bluray|blu-ray|brrip|bdrip|webrip|"
    r"web-?dl|hdtv|dvdrip|remux|x264|x265|h264|h265|hevc|avc|aac|ac3|dts|"
    r"ddp?5[\s._-]?1|atmos|dual|dublado|legendado|nacional|leg|multi|"
    r"proper|repack|extended|internal|complete)\b",
    re.IGNORECASE,
)

# Marcação de temporada no nome da PASTA ("3ª Temporada", "Season 2"), que
# não faz parte do nome da série — a temporada já vira a pasta Season NN.
TEMPORADA_NA_PASTA = re.compile(
    r"\b\d{1,2}\s*[ªaº°]?\s*temporada\b|\btemporada\s*\d{1,2}\b|\bseason\s*\d{1,2}\b",
    re.IGNORECASE,
)

# Assinatura de site de release: "- YTSBR.COM", "www.exemplo.net"
SITE = re.compile(r"\b(?:www\.)?[\w-]+\.(?:com|net|org|tv|to|me|info)(?:\.br)?\b",
                  re.IGNORECASE)

IDIOMAS = {
    "pt-br": "pt-BR", "ptbr": "pt-BR", "pob": "pt-BR", "portuguese": "pt-BR",
    "por": "pt-BR", "pt": "pt", "en": "en", "eng": "en", "english": "en",
    "es": "es", "spa": "es", "spanish": "es",
}


def limpar_titulo(bruto: str) -> str:
    """Transforma 'Breaking.Bad.2008' em 'Breaking Bad'."""
    texto = SITE.sub("", bruto)                         # antes de trocar "." por " "
    texto = re.sub(r"[._]+", " ", texto)
    texto = RUIDO.sub("", texto)
    texto = TEMPORADA_NA_PASTA.sub("", texto)
    texto = re.sub(r"[\(\[].*?[\)\]]", " ", texto)      # remove (2008), [GRUPO]
    texto = re.sub(r"[-–—]+\s*$", "", texto)
    texto = re.sub(r"\s{2,}", " ", texto).strip(" -._")
    # Ano solto no fim vira a pasta "Nome (Ano)" — não deve ficar no título também
    texto = re.sub(r"\s+(19\d{2}|20\d{2})$", "", texto).strip()
    return texto.title() if texto.islower() or texto.isupper() else texto


def analisar(caminho: Path, forcado: dict | None = None) -> dict | None:
    """Extrai série, temporada e episódio do nome do arquivo (ou da pasta pai).

    Se `forcado` vier preenchido (--serie/--temporada), nomes que não seguem
    nenhum padrão conhecido caem num modo simples: o primeiro número do nome
    é o episódio. Serve para lotes tipo "Ep01.mp4", "01.mkv", "cap 1.avi".
    """
    pai = caminho.parent.name
    avo = caminho.parent.parent.name

    for nivel, origem in enumerate((caminho.stem, pai)):
        for padrao in PADROES:
            m = padrao.search(origem)
            if not m:
                continue
            # O título é o que vem antes do "S01E01". Quando o nome começa
            # direto no episódio ("S01E01 - Pilot.mp4"), sobe na árvore de
            # pastas até achar um nome que sobre algo depois da limpeza —
            # "Temporada 01" limpa para vazio, então continua até "Modern Family".
            titulo = limpar_titulo(origem[: m.start()])
            if not titulo:
                for candidato in ((pai, avo) if nivel == 0 else (avo,)):
                    titulo = limpar_titulo(candidato)
                    if titulo:
                        break
            if not titulo:
                continue

            ano_m = ANO.search(origem) or ANO.search(pai) or ANO.search(avo)
            grupos = m.groups()
            return {
                "serie": titulo,
                "ano": ano_m.group(1) if ano_m else None,
                "temporada": int(grupos[0]),
                "episodio": int(grupos[1]),
                "episodio_final": int(grupos[2]) if len(grupos) > 2 and grupos[2] else None,
            }

    if forcado:
        m = re.search(r"(\d{1,3})", caminho.stem)
        if m:
            return {
                "serie": forcado["serie"],
                "ano": forcado["ano"],
                "temporada": forcado["temporada"],
                "episodio": int(m.group(1)),
                "episodio_final": None,
            }
    return None


def idioma_da_legenda(caminho: Path) -> str | None:
    """Detecta '.pt-BR' em 'Serie S01E01.pt-BR.srt'."""
    partes = caminho.stem.lower().split(".")
    if len(partes) > 1:
        return IDIOMAS.get(partes[-1])
    return None


def destino_do(info: dict, base: Path, extensao: str, idioma: str | None) -> Path:
    pasta_serie = f"{info['serie']} ({info['ano']})" if info["ano"] else info["serie"]
    episodio = f"S{info['temporada']:02d}E{info['episodio']:02d}"
    if info["episodio_final"]:
        episodio += f"-E{info['episodio_final']:02d}"

    nome = f"{info['serie']} {episodio}"
    if idioma:
        nome += f".{idioma}"

    temporada = "Season 00" if info["temporada"] == 0 else f"Season {info['temporada']:02d}"
    return base / pasta_serie / temporada / f"{nome}{extensao}"


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("origem", type=Path, nargs="?", default=Path("."),
                   help="Pasta com os arquivos bagunçados (padrão: pasta atual)")
    p.add_argument("--destino", type=Path, default=None,
                   help="Onde criar a estrutura (padrão: a própria pasta de origem)")
    p.add_argument("--aplicar", action="store_true", help="Executa (sem isto, só simula)")
    p.add_argument("--copiar", action="store_true", help="Copia em vez de mover")
    p.add_argument("--serie", help="Força o nome da série (sobrescreve o detectado)")
    p.add_argument("--temporada", type=int,
                   help="Força a temporada. Junto com --serie, também permite "
                        "organizar nomes sem padrão (o 1o número vira o episódio)")
    p.add_argument("--ano", help="Força o ano, ex.: 2009. Use para manter todas as "
                                 "temporadas na mesma pasta da série")
    args = p.parse_args()

    # O recuo "primeiro número = episódio" só é seguro sabendo série e temporada.
    forcado = (
        {"serie": args.serie, "temporada": args.temporada, "ano": args.ano}
        if args.serie and args.temporada is not None else None
    )

    # Caminho absoluto: rodando com "." o nome da pasta pai viria vazio,
    # e é dela que sai o título quando o arquivo começa direto no episódio.
    args.origem = args.origem.resolve()

    # Sem --destino, organiza ali mesmo: as pastas das séries nascem
    # dentro da própria pasta onde os arquivos estão.
    if args.destino is None:
        args.destino = args.origem
    else:
        args.destino = args.destino.resolve()

    if not args.origem.is_dir():
        print(f"Pasta não encontrada: {args.origem}")
        return 1

    arquivos = sorted(
        c for c in args.origem.rglob("*")
        if c.is_file() and c.suffix.lower() in VIDEOS | LEGENDAS
    )
    if not arquivos:
        print(f"Nenhum vídeo ou legenda em {args.origem}")
        return 0

    movidos = ignorados = 0
    for arquivo in arquivos:
        info = analisar(arquivo, forcado)
        if info:
            # O que o usuário informou explicitamente vence o que foi detectado.
            if args.serie:
                info["serie"] = args.serie
            if args.ano:
                info["ano"] = args.ano
            if args.temporada is not None:
                info["temporada"] = args.temporada
        if not info:
            print(f"  ?  não reconheci: {arquivo.name}")
            ignorados += 1
            continue

        idioma = idioma_da_legenda(arquivo) if arquivo.suffix.lower() in LEGENDAS else None
        alvo = destino_do(info, args.destino, arquivo.suffix.lower(), idioma)

        if alvo.exists():
            print(f"  =  já existe:     {alvo.relative_to(args.destino)}")
            ignorados += 1
            continue

        acao = "copiar" if args.copiar else "mover"
        print(f"  →  {arquivo.name}\n     {acao} para {alvo.relative_to(args.destino)}")

        if args.aplicar:
            alvo.parent.mkdir(parents=True, exist_ok=True)
            if args.copiar:
                shutil.copy2(arquivo, alvo)
            else:
                shutil.move(str(arquivo), str(alvo))
        movidos += 1

    print(f"\n{movidos} arquivo(s) organizados, {ignorados} ignorados.")
    if movidos and not args.aplicar:
        print("Isto foi só uma simulação. Rode de novo com --aplicar para valer.")
    elif movidos:
        print("Agora escaneie a biblioteca no Jellyfin: Painel > Escanear todas as bibliotecas.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        # Acontece ao encanar a saída para `head`/`more` e fechar antes do fim.
        sys.exit(0)
    except KeyboardInterrupt:
        print("\nInterrompido.")
        sys.exit(130)
