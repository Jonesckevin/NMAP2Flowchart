ARG NODE_VERSION=24-alpine
ARG NGINX_VERSION=1.31-alpine

FROM node:${NODE_VERSION} AS build

WORKDIR /app

# Build as the image's own unprivileged user: nothing in the toolchain needs root.
RUN chown node:node /app
USER node

COPY --chown=node:node App/package.json App/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY --chown=node:node App/tsconfig.json App/tsconfig.app.json App/tsconfig.node.json App/vite.config.ts App/index.html ./
COPY --chown=node:node App/public ./public
COPY --chown=node:node App/src ./src

RUN npm run build

FROM nginxinc/nginx-unprivileged:${NGINX_VERSION} AS runtime

LABEL org.opencontainers.image.title="NMAP2Flowchart" \
      org.opencontainers.image.description="Turn nmap scans into editable network diagrams" \
      org.opencontainers.image.licenses="MIT"

# The nginx tag trails the Alpine point release, so the base image ships an older
# musl / brotli / expat / zlib / libxslt / curl than the fixed ones. Pull the
# patched packages at build time instead of waiting for a new nginx tag; the base
# image already runs as `nginx`, so apk needs root for these two lines only.
USER root
RUN apk upgrade --no-cache
USER nginx

COPY --chown=101:101 docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
