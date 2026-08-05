#!/usr/bin/env bash
# Cria a estrutura de um site novo: pasta, página inicial e configuração do nginx.
#
#   sudo ./novo-site.sh meusite.com.br
#   sudo ./novo-site.sh meusite.com.br --spa     (React/Vue/Svelte com rotas)

set -euo pipefail

DOMINIO="${1:-}"
MODO="${2:-estatico}"
RAIZ="/DATA/Sites"
CONFD="$(cd "$(dirname "$0")" && pwd)/nginx/conf.d"

if [[ -z "$DOMINIO" ]]; then
    echo "Uso: $0 <dominio> [--spa]"
    echo "Exemplo: $0 meusite.com.br"
    exit 1
fi

if [[ ! "$DOMINIO" =~ ^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
    echo "Domínio inválido: $DOMINIO"
    exit 1
fi

if [[ -f "$CONFD/$DOMINIO.conf" ]]; then
    echo "Já existe configuração para $DOMINIO em $CONFD/$DOMINIO.conf"
    exit 1
fi

# Site estático devolve 404 para caminho inexistente; SPA devolve o index.html
# para o roteador do JavaScript resolver.
if [[ "$MODO" == "--spa" ]]; then
    FALLBACK="/index.html"
else
    FALLBACK="=404"
fi

mkdir -p "$RAIZ/$DOMINIO"

if [[ ! -e "$RAIZ/$DOMINIO/index.html" ]]; then
    cat > "$RAIZ/$DOMINIO/index.html" <<EOF
<!doctype html>
<html lang="pt-BR">
<meta charset="utf-8">
<title>$DOMINIO</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font: 16px/1.6 system-ui, sans-serif; max-width: 40rem;
         margin: 15vh auto; padding: 0 1.5rem; color: #222; }
  code { background: #f4f4f5; padding: .15em .4em; border-radius: 4px; }
</style>
<h1>$DOMINIO</h1>
<p>Site no ar. Substitua os arquivos em <code>$RAIZ/$DOMINIO/</code>.</p>
EOF
fi

cat > "$CONFD/$DOMINIO.conf" <<EOF
server {
    listen 80;
    server_name $DOMINIO www.$DOMINIO;
    root /sites/$DOMINIO;
    index index.html index.htm;

    include /etc/nginx/cloudflare-real-ip.conf;

    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript
               text/xml application/xml image/svg+xml;
    gzip_min_length 1024;

    location ~* \.(jpg|jpeg|png|gif|ico|webp|avif|css|js|svg|woff|woff2|ttf)\$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
        access_log off;
    }

    location / {
        try_files \$uri \$uri/ $FALLBACK;
    }

    location ~ /\\. {
        deny all;
    }
}
EOF

chmod -R a+rX "$RAIZ/$DOMINIO"

echo "Criado:"
echo "  conteúdo:      $RAIZ/$DOMINIO/"
echo "  configuração:  $CONFD/$DOMINIO.conf"
echo
echo "Agora:"
echo "  1. docker exec web nginx -t && docker exec web nginx -s reload"
echo "  2. No painel da Cloudflare (Zero Trust > Tunnels > Public Hostnames):"
echo "     $DOMINIO  ->  http://web:80"
