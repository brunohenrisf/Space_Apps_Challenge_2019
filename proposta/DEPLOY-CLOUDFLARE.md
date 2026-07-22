# Deploy do site BRC Track no Cloudflare Pages

O site é **estático e autossuficiente** (um único `index.html`, sem build e sem
arquivos externos). A pasta pronta para publicar é:

```
proposta/public/
├── index.html     # o site
├── _headers       # cabeçalhos de segurança + cache
└── _redirects     # redirecionamentos simples
```

Existem duas formas de publicar. Escolha uma.

---

## Opção A — Upload direto (mais rápido, sem Git)

Não precisa conectar repositório. Requer Node.js instalado.

```bash
cd proposta
npx wrangler pages deploy public --project-name=brc-track
```

- Na primeira vez, o Wrangler pede login na sua conta Cloudflare (abre o navegador).
- Ao final ele mostra a URL publicada, algo como `https://brc-track.pages.dev`.
- Para atualizar o site depois, rode o mesmo comando novamente.

---

## Opção B — Conectar o repositório (deploy automático a cada push)

No painel da Cloudflare:

1. **Workers & Pages → Create → Pages → Connect to Git**
2. Selecione este repositório e a branch desejada.
3. Configure o build:
   - **Framework preset:** `None`
   - **Build command:** *(deixe em branco)*
   - **Build output directory:** `proposta/public`
4. **Save and Deploy.**

A cada `git push` na branch escolhida, a Cloudflare republica o site sozinho.

---

## Domínio próprio (opcional)

Depois de publicado, em **Pages → seu projeto → Custom domains**, adicione
`brctrack.com.br` (ou o domínio que tiver) e siga as instruções de DNS.

## Antes de divulgar

Edite em `public/index.html` (ou no `site.html`) os dados de contato reais:
- Número do WhatsApp nos links (troque `href="#"` por `https://wa.me/55DDDNUMERO`)
- Telefone, e-mail e endereço na seção de contato e no rodapé
