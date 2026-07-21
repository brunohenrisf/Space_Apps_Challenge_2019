# ConectaVoucher — imagem de produção (backend Node/TS que serve portal + painel + /api)
# Contexto de build: a pasta voucher-saas/ (backend + prototype juntos).
FROM node:22-alpine
WORKDIR /app/backend

# dependências (inclui dev: TypeScript para o build)
COPY backend/package.json backend/package-lock.json* ./
RUN npm ci

# código do backend + build (tsc -> dist)
COPY backend/ ./
RUN npm run build

# o backend serve o portal/painel a partir de ../../prototype (=> /app/prototype)
COPY prototype /app/prototype

ENV NODE_ENV=production PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/health >/dev/null 2>&1 || exit 1
CMD ["node", "dist/server.js"]
