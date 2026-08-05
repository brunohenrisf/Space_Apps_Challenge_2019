#!/usr/bin/env python3
"""Autorização única do Google (Calendar + Gmail).

Rode uma vez no servidor. Ele imprime um link, você abre no navegador do seu
PC, autoriza, e o token fica salvo em /dados/google_token.json — o assistente
renova sozinho a partir daí.

Antes de rodar, no Google Cloud Console:
  1. Crie um projeto e ative as APIs "Google Calendar API" e "Gmail API".
  2. Em "Credenciais", crie um ID do cliente OAuth do tipo "Aplicativo da Web".
  3. Em "URIs de redirecionamento autorizados", adicione:
         http://10.0.0.103:8765/
     (troque pelo IP do seu servidor, se for outro)
  4. Baixe o JSON e salve como google_credentials.json na pasta de dados.
"""

import os
import sys
from pathlib import Path

from google_auth_oauthlib.flow import InstalledAppFlow

ESCOPOS = [
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",
]

CREDENCIAIS = os.getenv("GOOGLE_CREDENCIAIS", "/dados/google_credentials.json")
TOKEN = os.getenv("GOOGLE_TOKEN", "/dados/google_token.json")
PORTA = int(os.getenv("PORTA_OAUTH", "8765"))


def main() -> int:
    if not Path(CREDENCIAIS).exists():
        print(f"Não encontrei {CREDENCIAIS}.")
        print("Baixe o JSON do cliente OAuth no Google Cloud Console e salve aí.")
        return 1

    fluxo = InstalledAppFlow.from_client_secrets_file(CREDENCIAIS, ESCOPOS)
    print(f"\nAbra o link abaixo no navegador do seu computador e autorize.\n")

    credenciais = fluxo.run_local_server(
        host="0.0.0.0",
        port=PORTA,
        open_browser=False,
        prompt="consent",          # garante que venha um refresh_token
        access_type="offline",
    )

    Path(TOKEN).parent.mkdir(parents=True, exist_ok=True)
    Path(TOKEN).write_text(credenciais.to_json())
    os.chmod(TOKEN, 0o600)
    print(f"\nPronto. Token salvo em {TOKEN}. Reinicie o assistente.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
