# Imagem da central Nexo.
#
# Multi-arch por natureza: node:22-alpine existe para arm64 (Pi 4/5) e
# amd64, então o MESMO Dockerfile roda no Pi e na máquina de
# desenvolvimento. `docker compose build` no próprio Pi resolve — não
# há registry para depender.
#
# Deliberadamente sem devDependencies, sem compilador, sem toolchain:
# as duas dependências (mqtt, ws) são JS puro, e é isso que faz o build
# num Pi levar um minuto em vez de vinte.

FROM node:22-alpine

# tzdata: sem ele o contêiner vive em UTC e as automações por horário e
# por sol disparam na hora errada. O fuso vem do TZ no compose.
RUN apk add --no-cache tzdata

WORKDIR /opt/nexo
ENV NODE_ENV=production

# Dependências primeiro: enquanto o package-lock não mudar, esta camada
# fica em cache e o rebuild de código é questão de segundos.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

COPY tools ./tools
COPY app ./app
COPY casa ./casa
COPY server ./server

# Pré-comprime a interface: a central serve o .gz pronto e o Pi não
# gasta CPU comprimindo a cada acesso.
# --so-app: os JSONs de casa/ NÃO entram em app/ (que é servido estático,
# sem autenticação) — a configuração chega por bind mount em /opt/nexo/casa.
RUN node tools/build.mjs --so-app && cp -r dist/sd/. app/ && rm -rf dist

# Estado da casa (chaves, contas, histórico, aprendizado) vive num
# volume montado aqui — nunca dentro da imagem.
RUN mkdir -p /dados && chown -R node:node /dados /opt/nexo
USER node

ENV NEXO_DADOS=/dados \
    NEXO_MQTT_URL=mqtt://mosquitto:1883 \
    NEXO_PORTA=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/nexo.mjs"]
