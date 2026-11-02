ARG NODE_VERSION=24-alpine
ARG NGINX_VERSION=1.31-alpine

FROM node:${NODE_VERSION} AS build

WORKDIR /app

COPY App/package.json App/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY App/tsconfig.json App/tsconfig.app.json App/tsconfig.node.json App/vite.config.ts App/index.html ./
COPY App/public ./public
COPY App/src ./src
RUN npm run build

FROM nginxinc/nginx-unprivileged:${NGINX_VERSION} AS runtime

LABEL org.opencontainers.image.title="NMAP2Flowchart" \
      org.opencontainers.image.description="Turn nmap scans into editable network diagrams" \
      org.opencontainers.image.licenses="MIT"

COPY --chown=101:101 docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build --chown=101:101 /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
