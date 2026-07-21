# ConectaVoucher — imagem de produção (backend Node/TS que serve portal + painel + /api)
# Contexto de build: a pasta voucher-saas/ (backend + prototype juntos).
FROM node:22-alpine
WORKDIR /app/backend

# dependências (inclui dev: TypeScript para o build)
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci

# código do backend
COPY backend/ ./

# troca o provider do Prisma para postgresql (dev usa sqlite) e builda.
# DATABASE_URL placeholder só para o `prisma generate` do build (não conecta).
ENV DATABASE_URL="postgresql://placeholder:placeholder@db:5432/placeholder"
RUN sed -i 's|provider = "sqlite"|provider = "postgresql"|' prisma/schema.prisma \
 && npm run build

# o backend serve o portal/painel a partir de ../../prototype (=> /app/prototype)
COPY prototype /app/prototype

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD wget -qO- http://localhost:3000/health >/dev/null 2>&1 || exit 1
# cria/atualiza o schema no Postgres (db push, idempotente) e sobe o servidor
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/server.js"]
