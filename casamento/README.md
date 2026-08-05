# Fotos do casamento

Página para os convidados enviarem, pelo QR Code da mesa, as fotos que tiraram durante o
casamento. As fotos vão direto para os noivos — não existe galeria pública.

- **`/`** — página do convidado: escolher fotos, assinar com o nome, deixar um recado e enviar.
- **`/painel`** — área dos noivos, protegida por senha: ver tudo, ocultar o que não deve
  aparecer, excluir e baixar todas as fotos em um `.zip`.
- **`/qr`** — gerador dos cartões de mesa com o QR Code, pronto para imprimir em A4.

Sem banco de dados, sem serviço externo, sem conta em lugar nenhum: as fotos ficam em
`uploads/` e o índice em `data/photos.json`.

---

## Rodando

```bash
cd casamento
npm install
cp .env.example .env      # edite os nomes, a senha e o endereço público
npm start
```

O console mostra os endereços, inclusive o da rede local — útil para testar pelo celular
antes da festa:

```
  Ana & Bruno — página de fotos do casamento
  ────────────────────────────────────────────
  Convidados:  https://fotos-ana-e-bruno.com.br
  Painel:      https://fotos-ana-e-bruno.com.br/painel
  QR Code:     https://fotos-ana-e-bruno.com.br/qr
  Na rede:     http://192.168.0.14:3000
```

Sem `.env`, o app sobe assim mesmo e imprime uma senha temporária do painel a cada boot.

## Configuração

Tudo pelo `.env` (veja `.env.example`). Os que mais importam:

| Variável | Para que serve |
| --- | --- |
| `COUPLE_NAMES`, `EVENT_DATE`, `WELCOME_MESSAGE` | Textos da página do convidado e dos cartões. |
| `PUBLIC_URL` | Endereço que vai **dentro do QR Code**. Ajuste antes de imprimir. |
| `ADMIN_PASSWORD` | Senha do painel dos noivos. |
| `SESSION_SECRET` | Assina o cookie de sessão. Sem ela, o painel pede a senha de novo a cada reinício. |
| `TRUST_PROXY` | `true` quando houver proxy na frente (Railway, Render, Fly, Nginx, Cloudflare). |
| `MAX_FILE_SIZE_MB` | Tamanho máximo por foto (padrão 30 MB). |
| `DATA_DIR`, `UPLOADS_DIR` | Onde gravar índice e arquivos — aponte para o volume persistente. |

Gere um `SESSION_SECRET`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Publicando

O app é um Node comum (`npm start`, escuta em `PORT`), então roda em Railway, Render, Fly,
VPS, Docker — onde for.

> **As fotos ficam em disco.** Em hospedagem com sistema de arquivos efêmero (o padrão em
> Railway, Render e Fly sem volume), **tudo é apagado a cada deploy ou reinício**. Monte um
> volume persistente e aponte `DATA_DIR` e `UPLOADS_DIR` para dentro dele — por exemplo
> `DATA_DIR=/data/data` e `UPLOADS_DIR=/data/uploads`.

Checklist antes da festa:

1. `ADMIN_PASSWORD` e `SESSION_SECRET` definidos.
2. `PUBLIC_URL` com o endereço final, em HTTPS (a câmera do celular precisa dele para abrir
   direto; e sem HTTPS a senha do painel viaja em texto puro).
3. `TRUST_PROXY=true` se houver proxy na frente.
4. Volume persistente montado, com `DATA_DIR`/`UPLOADS_DIR` apontando para ele.
5. Abra `/qr`, confira o endereço no cartão, imprima e teste lendo o código com o celular.

### Alternativa sem hospedagem

Dá para rodar em um notebook ligado ao Wi-Fi do salão e usar o endereço "Na rede"
(`http://192.168.x.x:3000`) no QR Code. Funciona, mas depende do notebook ficar ligado e de
todos os convidados estarem na mesma rede — teste antes.

## Cartões de mesa

`/qr` monta uma folha A4 com quatro cartões por página, já com nomes, instrução e o QR Code.
Dá para trocar o endereço, escolher a quantidade e imprimir direto do navegador (ou baixar o
código em PNG/SVG para usar na papelaria do casamento).

## Painel dos noivos

- Grade com todas as fotos, mais recentes primeiro, com o nome de quem enviou. O ícone de
  envelope marca as que vieram com recado.
- Clique para ampliar: recado completo, data, tamanho, navegação com ← →.
- **Ocultar** tira a foto da vista sem apagar nada. **Excluir** remove o arquivo do disco de
  vez, sem desfazer.
- **Baixar todas (.zip)** empacota os originais com nomes ordenados, mais um `recados.txt`
  com quem enviou cada foto e o que escreveu. O checkbox "mostrar também as fotos ocultas"
  decide se as ocultas entram no pacote.

## Backup

Tudo que importa está em duas pastas:

```bash
tar czf backup-casamento.tar.gz uploads/ data/
```

Vale copiar para outro lugar durante e depois da festa — não deixe a única cópia das fotos
no servidor.

## Como funciona

- **Envio.** Uma requisição por foto, com barra de progresso e repetição só do que falhou.
  O navegador do convidado gera a miniatura e, se a opção estiver marcada, reduz fotos muito
  grandes para 2560px antes de subir — nos testes, uma foto de 11 MB virou 2,2 MB, o que faz
  diferença no 4G lotado do salão.
- **Validação.** O tipo do arquivo é conferido pelos bytes iniciais, não pelo nome nem pelo
  `Content-Type`: um `.jpg` que na verdade é um script é recusado. O nome em disco é sempre
  gerado pelo servidor.
- **Privacidade.** As fotos só são servidas para quem tem sessão do painel. A página do
  convidado não lista nada.
- **Proteções.** Limite de envios e de tentativas de senha por IP, cookie `HttpOnly` +
  `SameSite=Strict` com HMAC, checagem de origem nas ações do painel e CSP sem scripts
  externos.

## Testes

```bash
npm test
```

Sobe o app em uma porta aleatória com diretórios temporários e cobre envio, validação de
tipo e de tamanho, limites, autenticação, moderação, `.zip` e geração do QR Code.
