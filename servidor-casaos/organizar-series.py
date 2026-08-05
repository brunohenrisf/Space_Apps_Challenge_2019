#!/usr/bin/env python3
"""Organiza episódios na estrutura de pastas que o Jellyfin entende.

USO PRINCIPAL — dentro da pasta da série, com as temporadas soltas dentro:

    Z:\\Media\\Series\\Modern Family\\
    ├── Temporada 01\\S01E01 - Pilot.mp4
    ├── Temporada 02\\Ep01-2.mp4
    └── 3ª Temporada 720p\\T03E01 - Quero ser Cawboy.mp4

    cd "Z:\\Media\\Series\\Modern Family"
    python organizar-series.py                  # simula
    python organizar-series.py --aplicar        # arruma

    Z:\\Media\\Series\\Modern Family\\
    ├── Season 01\\Modern Family S01E01.mp4
    ├── Season 02\\Modern Family S02E01.mp4
    └── Season 03\\Modern Family S03E01.mp4

Também funciona numa pasta com VÁRIAS séries misturadas (Downloads): nesse
caso ele cria uma pasta por série. O modo é detectado sozinho; force com
--modo serie ou --modo biblioteca se precisar.

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

# Número da temporada quando ele está só na PASTA ("Temporada 02", "Season 2")
TEMPORADA_SO_NA_PASTA = re.compile(
    r"(?:temporada|season)\s*(\d{1,2})\b|\b(\d{1,2})\s*[ªaº°]\s*temporada",
    re.IGNORECASE,
)

ANO = re.compile(r"[\(\[\s._-](19\d{2}|20\d{2})[\)\]\s._-]")

# Lixo típico de nome de release, cortado do título da série.
RUIDO = re.compile(
    r"\b(1080p|2160p|720p|480p|4k|uhd|hdr|bluray|blu-ray|brrip|bdrip|webrip|"
    r"web-?dl|hdtv|dvdrip|remux|x264|x265|h264|h265|hevc|avc|aac|ac3|dts|"
    r"ddp?5[\s._-]?1|atmos|dual|dublado|legendado|nacional|leg|multi|"
    r"proper|repack|extended|internal|complete)\b",
    re.IGNORECASE,
)

# Marcação de temporada no nome da pasta, que não faz parte do nome da série.
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
    """Transforma 'Modern Family 3ª Temporada 720p - YTSBR.COM' em 'Modern Family'."""
    texto = SITE.sub("", bruto)                         # antes de trocar "." por " "
    texto = re.sub(r"[._]+", " ", texto)
    texto = RUIDO.sub("", texto)
    texto = TEMPORADA_NA_PASTA.sub("", texto)
    texto = re.sub(r"[\(\[].*?[\)\]]", " ", texto)      # remove (2008), [GRUPO]
    texto = re.sub(r"[-–—]+\s*$", "", texto)
    texto = re.sub(r"\s{2,}", " ", texto).strip(" -._")
    # Ano solto no fim vira a pasta "Nome (Ano)" — não deve ficar no título
    texto = re.sub(r"\s+(19\d{2}|20\d{2})$", "", texto).strip()
    return texto.title() if texto.islower() or texto.isupper() else texto


def temporada_da_pasta(caminho: Path, raiz: Path) -> int | None:
    """Procura o número da temporada nas pastas entre o arquivo e a raiz."""
    pasta = caminho.parent
    while True:
        m = TEMPORADA_SO_NA_PASTA.search(pasta.name)
        if m:
            return int(m.group(1) or m.group(2))
        if pasta == raiz or pasta == pasta.parent:
            return None
        pasta = pasta.parent


def analisar(caminho: Path, raiz: Path, forcado: dict | None = None) -> dict | None:
    """Extrai série, temporada e episódio do arquivo ou das pastas acima dele."""
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
            # "Temporada 01" limpa para vazio, então continua até a pasta da série.
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

    # Nome sem padrão nenhum ("Ep01.mp4"): a temporada pode estar só na pasta.
    numero = re.search(r"(\d{1,3})", caminho.stem)
    if numero:
        temporada = (forcado or {}).get("temporada")
        if temporada is None:
            temporada = temporada_da_pasta(caminho, raiz)
        serie = (forcado or {}).get("serie") or limpar_titulo(pai) or limpar_titulo(avo)
        if temporada is not None and serie:
            ano_m = ANO.search(pai) or ANO.search(avo)
            return {
                "serie": serie,
                "ano": (forcado or {}).get("ano") or (ano_m.group(1) if ano_m else None),
                "temporada": temporada,
                "episodio": int(numero.group(1)),
                "episodio_final": None,
            }
    return None


def idioma_da_legenda(caminho: Path) -> str | None:
    """Detecta '.pt-BR' em 'Serie S01E01.pt-BR.srt'."""
    partes = caminho.stem.lower().split(".")
    if len(partes) > 1:
        return IDIOMAS.get(partes[-1])
    return None


def destino_do(info: dict, base: Path, extensao: str, idioma: str | None,
               criar_pasta_da_serie: bool) -> Path:
    episodio = f"S{info['temporada']:02d}E{info['episodio']:02d}"
    if info["episodio_final"]:
        episodio += f"-E{info['episodio_final']:02d}"

    nome = f"{info['serie']} {episodio}"
    if idioma:
        nome += f".{idioma}"

    temporada = "Season 00" if info["temporada"] == 0 else f"Season {info['temporada']:02d}"

    destino = base
    if criar_pasta_da_serie:
        destino /= f"{info['serie']} ({info['ano']})" if info["ano"] else info["serie"]
    return destino / temporada / f"{nome}{extensao}"


def limpar_pastas_vazias(raiz: Path) -> int:
    """Remove as pastas de origem que ficaram vazias depois da mudança."""
    removidas = 0
    for pasta in sorted(raiz.rglob("*"), key=lambda p: len(p.parts), reverse=True):
        if pasta.is_dir() and not any(pasta.iterdir()):
            pasta.rmdir()
            removidas += 1
    return removidas


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("origem", type=Path, nargs="?", default=Path("."),
                   help="Pasta a organizar (padrão: pasta atual)")
    p.add_argument("--destino", type=Path, default=None,
                   help="Onde criar a estrutura (padrão: a própria pasta de origem)")
    p.add_argument("--modo", choices=("auto", "serie", "biblioteca"), default="auto",
                   help="serie: a pasta atual É a série, cria só Season NN dentro dela. "
                        "biblioteca: cria uma pasta por série. auto (padrão): decide "
                        "pelo número de séries encontradas")
    p.add_argument("--aplicar", action="store_true", help="Executa (sem isto, só simula)")
    p.add_argument("--copiar", action="store_true", help="Copia em vez de mover")
    p.add_argument("--serie", help="Força o nome da série (sobrescreve o detectado)")
    p.add_argument("--temporada", type=int, help="Força a temporada de todos os arquivos")
    p.add_argument("--ano", help="Força o ano, ex.: 2009. Mantém todas as temporadas "
                                 "na mesma pasta da série")
    args = p.parse_args()

    # Caminho absoluto: rodando com "." o nome da pasta pai viria vazio,
    # e é dela que sai o título quando o arquivo começa direto no episódio.
    args.origem = args.origem.resolve()
    args.destino = args.destino.resolve() if args.destino else args.origem

    if not args.origem.is_dir():
        print(f"Pasta não encontrada: {args.origem}")
        return 1

    forcado = {"serie": args.serie, "temporada": args.temporada, "ano": args.ano}

    arquivos = sorted(
        c for c in args.origem.rglob("*")
        if c.is_file() and c.suffix.lower() in VIDEOS | LEGENDAS
    )
    if not arquivos:
        print(f"Nenhum vídeo ou legenda em {args.origem}")
        return 0

    # 1ª passagem: entender o que há na pasta antes de decidir a estrutura.
    analisados: list[tuple[Path, dict]] = []
    nao_reconhecidos: list[Path] = []
    for arquivo in arquivos:
        info = analisar(arquivo, args.origem, forcado)
        if not info:
            nao_reconhecidos.append(arquivo)
            continue
        if args.serie:
            info["serie"] = args.serie
        if args.ano:
            info["ano"] = args.ano
        if args.temporada is not None:
            info["temporada"] = args.temporada
        analisados.append((arquivo, info))

    series = {i["serie"] for _, i in analisados}

    if args.modo == "serie":
        criar_pasta_da_serie = False
    elif args.modo == "biblioteca":
        criar_pasta_da_serie = True
    else:
        # Uma série só e o destino é a própria pasta dela → não aninha de novo.
        criar_pasta_da_serie = not (len(series) == 1 and args.destino == args.origem)

    if analisados and not criar_pasta_da_serie:
        # Nome consistente para todos os arquivos, tirado da pasta quando possível.
        nome = args.serie or limpar_titulo(args.origem.name) or next(iter(series))
        for _, info in analisados:
            info["serie"] = nome
        print(f"Série: {nome}   (as temporadas vão direto para {args.destino})\n")
    elif analisados:
        print(f"{len(series)} série(s) encontrada(s); cada uma vai para a sua pasta.\n")

    # 2ª passagem: mover.
    movidos = ignorados = 0
    for arquivo, info in analisados:
        idioma = idioma_da_legenda(arquivo) if arquivo.suffix.lower() in LEGENDAS else None
        alvo = destino_do(info, args.destino, arquivo.suffix.lower(), idioma,
                          criar_pasta_da_serie)

        if alvo == arquivo or alvo.exists():
            ignorados += 1
            continue

        print(f"  →  {arquivo.relative_to(args.origem)}\n"
              f"     {'copiar' if args.copiar else 'mover'} para "
              f"{alvo.relative_to(args.destino)}")

        if args.aplicar:
            alvo.parent.mkdir(parents=True, exist_ok=True)
            if args.copiar:
                shutil.copy2(arquivo, alvo)
            else:
                shutil.move(str(arquivo), str(alvo))
        movidos += 1

    for arquivo in nao_reconhecidos:
        print(f"  ?  não reconheci: {arquivo.relative_to(args.origem)}")

    print(f"\n{movidos} arquivo(s) organizados, "
          f"{ignorados} já no lugar, {len(nao_reconhecidos)} não reconhecidos.")

    if args.aplicar and movidos and not args.copiar:
        vazias = limpar_pastas_vazias(args.origem)
        if vazias:
            print(f"{vazias} pasta(s) vazia(s) removida(s).")

    if movidos and not args.aplicar:
        print("Isto foi só uma simulação. Rode de novo com --aplicar para valer.")
    elif movidos:
        print("Agora escaneie a biblioteca no Jellyfin: Painel > Escanear todas as bibliotecas.")
    if nao_reconhecidos:
        print("Para os não reconhecidos, informe --serie e --temporada.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except BrokenPipeError:
        sys.exit(0)
    except KeyboardInterrupt:
        print("\nInterrompido.")
        sys.exit(130)
