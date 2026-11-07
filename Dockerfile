# nearpay-console image: the Vite build served by unprivileged nginx (read-only root, /tmp tmpfs).
# The deploy wiring (Compose service / Traefik router for ops.<domain>) lives in nearpay-deploy.
# Build: docker build --build-arg NP_REGISTRY_URL=http://host.docker.internal:4873 -t nearpay/console:local .

FROM node:22.23.4-bookworm-slim AS build
ARG NP_REGISTRY_URL=http://127.0.0.1:4873
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-lock.yaml .npmrc ./
RUN sed -i "s#http://127.0.0.1:4873/#${NP_REGISTRY_URL%/}/#g" .npmrc && pnpm install --frozen-lockfile
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
RUN pnpm build

FROM nginxinc/nginx-unprivileged:1.29.8-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/headers.conf /etc/nginx/snippets/headers.conf
COPY --from=build /src/dist /usr/share/nginx/html
USER 101
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
