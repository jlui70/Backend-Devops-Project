# --- Estágio 1: Build ---
FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 g++ make curl git \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable

COPY . .

RUN yarn install --frozen-lockfile || yarn install
RUN yarn tsc
RUN yarn --cwd packages/backend build

# --- Estágio 2: Imagem Final ---
FROM node:22-bookworm-slim AS final

WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable

# 1. Copia arquivos de configuração do Yarn se existirem no projeto
COPY --from=build /app/.yarnrc* ./
COPY --from=build /app/.yarn ./.yarn

# 2. Copia yarn.lock, package.json e extrai a estrutura do skeleton
COPY --from=build /app/yarn.lock /app/package.json /app/packages/backend/dist/skeleton.tar.gz ./
RUN tar xzf skeleton.tar.gz && rm skeleton.tar.gz

# 3. Instala apenas as dependências de produção (comando correto para Yarn Berry)
RUN yarn workspaces focus --all --production

# 4. Copia e extrai o bundle da aplicação
COPY --from=build /app/packages/backend/dist/bundle.tar.gz ./
RUN tar xzf bundle.tar.gz && rm bundle.tar.gz

# 5. Copia as configurações do app e os exemplos do catálogo/scaffolder
#    (examples/ é referenciado pelas locations do catalog em app-config, ex.:
#    examples/template/template.yaml para o botão "Create" funcionar)
COPY app-config.yaml ./
COPY --from=build /app/examples ./examples
RUN chown -R node:node /app

USER node

CMD ["node", "packages/backend/dist/index.cjs.js", "--config", "app-config.yaml"]
