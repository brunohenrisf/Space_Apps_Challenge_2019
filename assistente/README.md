# Assistente pessoal

Assistente de IA que roda no seu servidor CasaOS, conversa por **Telegram** e usa o **Claude** na nuvem para raciocinar. Controla a casa, consulta agenda e e-mail, guarda memórias e tarefas, e monitora o servidor.

```
Telegram  ──►  assistente (contêiner no servidor)  ──►  API do Claude
                      │
                      ├─ Home Assistant   (luzes, tomadas, portão)
                      ├─ Google           (Calendar, Gmail)
                      ├─ SQLite           (memórias, tarefas, histórico)
                      └─ Servidor         (disco, Docker, Jellyfin, qBittorrent)
```

Só o servidor fala com a nuvem — **nenhuma porta é aberta**. O bot faz long polling de saída, então funciona atrás do NAT sem expor nada à internet.

---

## Por que Telegram e não WhatsApp

A API do WhatsApp tem dois caminhos e nenhum é confortável para uso pessoal: a **oficial** (Meta Cloud API) exige conta business, webhook HTTPS público e um número de telefone dedicado que não pode estar no app normal; as **bibliotecas não-oficiais** (Baileys, whatsapp-web.js) usam seu número mas violam os Termos de Uso e podem levar a banimento.

O Telegram tem API oficial, gratuita, sem risco e configurável em dois minutos. Se um dia o WhatsApp for obrigatório, o `main.py` é a única parte que muda — o agente e as ferramentas são os mesmos.

---

## Instalação

### 1. Criar o bot no Telegram

Fale com o [@BotFather](https://t.me/BotFather) → `/newbot` → escolha nome e usuário. Ele devolve um token tipo `123456:ABC-DEF...`.

### 2. Preparar os arquivos no servidor

```bash
mkdir -p /DATA/AppData/assistente
cd /DATA/compose && git clone <este-repo> assistente && cd assistente/assistente
cp .env.example .env
nano .env
```

### 3. Preencher o `.env`

| Variável | Onde conseguir |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) → API Keys |
| `TELEGRAM_TOKEN` | O token do BotFather |
| `USUARIOS_AUTORIZADOS` | Veja o passo 5 |
| `HA_TOKEN` | Home Assistant → seu perfil → Segurança → **Tokens de acesso de longa duração** |
| `JELLYFIN_API_KEY` | Jellyfin → Painel → Avançado → Chaves de API |
| `QBITTORRENT_SENHA` | A senha que você definiu na interface web |

### 4. Subir

```bash
sudo docker compose up -d --build
sudo docker compose logs -f
```

### 5. Descobrir seu ID e liberar o acesso

Mande `/id` para o seu bot no Telegram. Ele responde com o número. Coloque em `USUARIOS_AUTORIZADOS` no `.env` e reinicie:

```bash
sudo docker compose restart
```

> ⚠️ **Este passo não é opcional.** Sem a lista de IDs, qualquer pessoa que descobrir o nome do bot controla suas luzes, seu portão e seu servidor.

### 6. Autorizar o Google (opcional, para agenda e e-mail)

No [Google Cloud Console](https://console.cloud.google.com): crie um projeto, ative **Google Calendar API** e **Gmail API**, crie uma credencial OAuth do tipo *Aplicativo da Web* com o redirecionamento `http://10.0.0.103:8765/`, baixe o JSON e salve como `/DATA/AppData/assistente/google_credentials.json`. Então:

```bash
sudo docker compose exec assistente python /autorizar_google.py
```

Abra o link que aparecer, autorize, e reinicie o contêiner. O token é renovado sozinho a partir daí.

---

## Usando

Converse normalmente — sem comandos:

- *apaga as luzes da sala e o spot*
- *o que tenho na agenda amanhã?*
- *lembra que o wifi novo é VOLTTEX_5G*
- *cria uma tarefa: comprar SSD, prazo sexta*
- *como está o disco do servidor?*
- *tem algum e-mail importante hoje?*
- *o Interestelar está na biblioteca?*

Comandos disponíveis: `/start`, `/limpar` (apaga o histórico da conversa, preserva memórias e tarefas), `/id`.

---

## O que ele pode fazer

| Área | Ferramentas |
|---|---|
| **Casa** | `listar_dispositivos`, `acionar_dispositivo`, `estado_da_casa` |
| **Memória** | `lembrar`, `consultar_memorias`, `esquecer` |
| **Tarefas** | `criar_tarefa`, `listar_tarefas`, `concluir_tarefa` |
| **Servidor** | `saude_do_servidor`, `listar_conteineres`, `buscar_na_biblioteca`, `listar_downloads` |
| **Google** | `ver_agenda`, `criar_evento`, `ler_emails`, `preparar_email` |

Decisões de segurança embutidas no código, não só no prompt:

- **Sensores são somente leitura** — `acionar_dispositivo` recusa qualquer coisa fora de `switch`, `light`, `fan`, `input_boolean`, `scene`, `script`.
- **E-mail nunca é enviado** — `preparar_email` só cria rascunho no Gmail; você revisa e envia.
- **Docker montado somente leitura** — as ferramentas consultam contêineres, não podem parar nem remover.
- **Sem portas publicadas** — nada do assistente é acessível pela rede.

---

## Custo

Cada mensagem gasta tokens da API. Com o Claude Opus 5 ($5 por milhão de entrada, $25 de saída) e cache de prompt ativo, uma conversa típica sai por poucos centavos. Duas alavancas se quiser reduzir:

```bash
MODELO=claude-sonnet-5   # bem mais barato, ótimo para assistente do dia a dia
ESFORCO=low              # menos raciocínio, respostas mais rápidas
```

O prompt de sistema e as definições das ferramentas ficam em cache entre mensagens, então a partir da segunda eles custam ~10% do preço normal. Acompanhe o consumo nos logs (`tokens: entrada=... cache_leitura=... saída=...`).

---

## Manutenção

```bash
sudo docker compose logs -f              # acompanhar
sudo docker compose restart              # reiniciar
sudo docker compose up -d --build        # aplicar mudanças no código
sqlite3 /DATA/AppData/assistente/assistente.db "SELECT * FROM memoria;"
```

**Backup** — tudo que importa está em `/DATA/AppData/assistente`:

```bash
sudo tar -czf /DATA/backup-assistente-$(date +%F).tar.gz /DATA/AppData/assistente
```

---

## Estrutura

```
assistente/
├── docker-compose.yml
├── Dockerfile
├── requirements.txt
├── .env.example
├── autorizar_google.py       # OAuth do Google, roda uma vez
└── app/
    ├── main.py               # bot do Telegram (autorização, fatiamento, digitando…)
    ├── agent.py              # chamada ao Claude + prompt de sistema
    ├── config.py             # variáveis de ambiente
    ├── memory.py             # SQLite: histórico, memórias, tarefas
    ├── contexto.py           # contextvar com o chat atual
    └── tools/
        ├── casa.py           # Home Assistant
        ├── notas.py          # memórias e tarefas
        ├── servidor.py       # disco, Docker, Jellyfin, qBittorrent
        └── agenda.py         # Google Calendar e Gmail
```

**Para adicionar uma ferramenta nova:** escreva a função com o decorador `@beta_tool`, com docstring descrevendo *quando* usá-la (o modelo lê isso para decidir), e acrescente à lista `FERRAMENTAS` do módulo. O schema é gerado automaticamente a partir da assinatura.

---

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Bot não responde | Token errado no `.env`, ou seu ID não está em `USUARIOS_AUTORIZADOS` (mande `/id`) |
| "Erro ao consultar o Home Assistant" | `HA_TOKEN` vazio ou expirado; gere um novo token de longa duração |
| "Google não autorizado ainda" | Falta rodar `autorizar_google.py` (passo 6) |
| "Docker não está acessível" | O socket não foi montado — confira o volume no `docker-compose.yml` |
| Respostas muito longas | Baixe `ESFORCO` para `low`, ou ajuste a seção "Como responder" em `agent.py` |
| Respostas rasas em tarefas difíceis | Suba `ESFORCO` para `high` |
