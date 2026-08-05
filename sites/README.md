# Hospedagem no servidor de casa

Publica sites e aplicações rodando no seu servidor, acessíveis pela internet com HTTPS — **sem abrir nenhuma porta no roteador** e sem expor seu IP residencial.

```
Internet ──HTTPS──► Cloudflare ──túnel de saída──► servidor em casa
                                                      │
                                              ┌───────┴────────┐
                                              │  nginx (web)   │
                                              └───┬────────┬───┘
                                     site estático│        │aplicação
                                    /DATA/Sites/… │        │ contêiner
```

O `cloudflared` abre a conexão **de dentro para fora**. Não há porta escutando, não há o que varrer, e seu IP não aparece no DNS.

---

## Instalação (uma vez)

### 1. Domínio na Cloudflare

Registre um domínio (`.com.br` ~R$40/ano no [Registro.br](https://registro.br)) e adicione-o na Cloudflare (plano gratuito), apontando os nameservers do registrador para os que ela indicar.

### 2. Criar o túnel

No painel: **Zero Trust → Networks → Tunnels → Create a tunnel** → escolha *Cloudflared* → dê um nome. Ele mostra um comando de instalação contendo um **token** longo — copie só o token.

### 3. Subir no servidor

```bash
sudo docker network create proxy          # rede compartilhada, uma vez só

mkdir -p /DATA/compose && cd /DATA/compose
git clone <este-repo> repo && cd repo/sites
cp .env.example .env
nano .env                                  # cole o TUNNEL_TOKEN
sudo docker compose up -d
```

---

## Cenário 1 — Site estático

HTML/CSS/JS, ou o resultado de um build (React, Vue, Astro, Hugo).

```bash
sudo ./novo-site.sh meusite.com.br          # site comum
sudo ./novo-site.sh meuapp.com.br --spa     # SPA com rotas no cliente
```

O script cria a pasta em `/DATA/Sites/meusite.com.br/`, uma página inicial e o `.conf` do nginx. Depois:

```bash
sudo docker exec web nginx -t && sudo docker exec web nginx -s reload
```

E na Cloudflare, em **Public Hostnames** do túnel:

| Campo | Valor |
|---|---|
| Subdomain / Domain | `meusite.com.br` |
| Service | `HTTP` → `web:80` |

Pronto — `https://meusite.com.br` no ar, com certificado válido.

**Para publicar o conteúdo**, jogue os arquivos em `/DATA/Sites/meusite.com.br/`. Pela pasta de rede do CasaOS/ZimaOS, ou por linha de comando:

```bash
# do seu PC
rsync -av --delete ./dist/ usuario@10.0.0.103:/DATA/Sites/meusite.com.br/
```

> A diferença entre `--spa` e o modo comum é o que acontece com uma URL que não existe como arquivo: site comum devolve 404; SPA devolve o `index.html` para o roteador do JavaScript resolver. Usar SPA num site comum esconde erros 404 reais.

---

## Cenário 2 — Aplicação em contêiner

Node, Python, PHP, WordPress, uma API — qualquer coisa que escute numa porta.

A diferença: o nginx **não serve arquivos**, ele repassa a requisição para o contêiner da aplicação. Os dois se enxergam pela rede `proxy`, usando o **nome do serviço** como endereço.

### 2.1 O compose da aplicação

Fica numa pasta própria, com ciclo de vida independente — veja [`exemplo-aplicacao/docker-compose.yml`](./exemplo-aplicacao/docker-compose.yml):

```yaml
services:
  meu-app:
    build: .
    container_name: meu-app
    restart: unless-stopped
    volumes:
      - /DATA/AppData/meu-app:/dados
    env_file: .env
    networks: [proxy]
    # SEM "ports:" — só o nginx precisa alcançar a aplicação

  banco:
    image: postgres:16-alpine
    volumes:
      - /DATA/AppData/meu-app-db:/var/lib/postgresql/data
    networks: [interna]        # fora da rede proxy: isolado do nginx

networks:
  proxy: { external: true }
  interna:
```

Três decisões que valem explicação:

- **Sem `ports:` na aplicação.** Publicar a porta na rede local não é necessário e amplia a superfície de ataque — quem conversa com ela é o nginx, pela rede interna do Docker.
- **Banco numa rede separada.** Só a aplicação o alcança; nem o nginx nem o túnel.
- **Dados em `/DATA/AppData/`.** Sem volume, tudo se perde ao atualizar a imagem.

### 2.2 A configuração do nginx

Copie [`nginx/conf.d/app-exemplo.com.br.conf`](./nginx/conf.d/app-exemplo.com.br.conf) trocando o domínio e o `proxy_pass`:

```nginx
proxy_pass http://meu-app:3000;   # nome do serviço : porta interna
```

Recarregue e adicione o hostname na Cloudflare apontando para `web:80`, igual ao site estático.

### 2.3 Detalhes que costumam morder

| Sintoma | Causa | Correção |
|---|---|---|
| Upload falha acima de 1 MB | Limite padrão do nginx | `client_max_body_size 50m;` (já está no modelo) |
| WebSocket/chat/HMR não conecta | Faltam cabeçalhos de upgrade | Já estão no modelo |
| App gera links `http://` | Não sabe que está atrás de HTTPS | `X-Forwarded-Proto https` (no modelo) + configurar a aplicação para confiar no proxy |
| Timeout em operação longa | Padrão de 60s | `proxy_read_timeout 300s;` (no modelo) |
| `host not found in upstream` | App não está na rede `proxy` | Adicione `networks: [proxy]` no compose dela |

---

## Rotas alternativas

Você **não precisa** do nginx no meio. A Cloudflare pode apontar direto para o contêiner da aplicação (`http://meu-app:3000` no Public Hostname). O nginx vale a pena quando você quer, num lugar só: cabeçalhos de segurança, cache de estáticos, limite de upload, logs unificados e vários sites no mesmo host.

---

## Segurança

**O que já está resolvido nesta configuração:**

- Nenhuma porta aberta no roteador
- IP residencial oculto atrás da Cloudflare
- Domínio desconhecido recebe `444` (conexão fechada sem resposta) — o servidor não responde por domínios que não são seus
- Arquivos ocultos (`.git`, `.env`) bloqueados
- Cabeçalhos de segurança e IP real do visitante nos logs

**O que fica com você:**

```bash
sudo apt install -y fail2ban unattended-upgrades
```

E três regras: **nunca** ative DMZ no roteador; mantenha **painel, qBittorrent e Home Assistant fora do túnel** (esses só por ZeroTier/Tailscale); se a aplicação tiver login, senha forte e 2FA.

Para restringir um hostname a você mesmo, a Cloudflare tem **Zero Trust → Access**: exige login (Google, e-mail com código) antes de a requisição chegar ao servidor. Útil para painéis internos que você quer alcançar de fora sem VPN.

---

## Manutenção

```bash
sudo docker compose logs -f cloudflared      # estado do túnel
sudo docker exec web nginx -t                # validar config antes de recarregar
sudo docker exec web nginx -s reload         # aplicar sem derrubar conexões
sudo docker exec web tail -f /var/log/nginx/access.log
```

**Sempre rode `nginx -t` antes do reload.** Configuração inválida com reload derruba todos os sites de uma vez; o `-t` pega o erro antes.

---

## Estrutura

```
sites/
├── docker-compose.yml            # nginx + cloudflared
├── novo-site.sh                  # cria pasta + config de um site novo
├── .env.example                  # TUNNEL_TOKEN
├── nginx/
│   ├── cloudflare-real-ip.conf   # IP real do visitante nos logs
│   └── conf.d/
│       ├── 000-default.conf      # 444 para domínio desconhecido
│       ├── exemplo.com.br.conf   # modelo: site estático
│       └── app-exemplo.com.br.conf  # modelo: aplicação em contêiner
└── exemplo-aplicacao/
    └── docker-compose.yml        # modelo: app + banco isolado
```
