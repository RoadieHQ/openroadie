# Stage 1: Extract only package.json files for workspace resolution
# This avoids manually listing every workspace package.json
FROM node:24-slim AS packages

WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases .yarn/releases
COPY packages/ packages/
COPY plugins/ plugins/

# Strip everything except package.json from workspaces
RUN find packages plugins -mindepth 2 ! -name "package.json" -delete 2>/dev/null; \
    find packages plugins -type d -empty -delete 2>/dev/null; \
    true

# Stage 2: Install dependencies, build, and prune
FROM node:24-slim AS build

WORKDIR /app
RUN corepack enable

# Copy package manifests and yarn config (layer caching)
COPY --from=packages /app/ ./

RUN yarn install --immutable

# Copy source and build
COPY packages/ packages/
COPY plugins/ plugins/
COPY tsconfig.json tsconfig.check.json ./
COPY feature-flags.json ./
COPY app-config.yaml app-config.docker.yaml ./
RUN yarn workspace backend build

# Build the frontend SPA so the image serves the full portal (UI + /api) from
# one process. The backend serves packages/app/dist at runtime when
# OPENROADIE_WEB_DIR is set (see serveFrontend). Must run before the production
# focus below, which prunes the devDependencies (vite) the build needs.
#
# The vite app-config plugin bakes the base URLs into the bundle at build time,
# so a temporary app-config.local.yaml pins app + backend baseUrl to the page
# origin (empty string -> relative /api) since the backend serves the app from
# the same host. serveFrontend re-injects the same empty base URLs at runtime.
RUN printf 'app:\n  baseUrl: ""\nbackend:\n  baseUrl: ""\n' > app-config.local.yaml && \
    yarn workspace app build && \
    rm -f app-config.local.yaml

# Remove devDependencies from all workspaces
RUN yarn workspaces focus --all --production

# Remove non-runtime workspaces and source/dist from the rest
# (workspace code is bundled into packages/backend/dist, only
# package.json + runtime files need to remain)
RUN rm -rf packages/e2e packages/ui packages/backend-test-utils && \
    find packages plugins -type d -name src -exec rm -rf {} + 2>/dev/null; \
    find packages plugins -path "*/dist" ! -path "packages/backend/dist" ! -path "packages/app/dist" -exec rm -rf {} + 2>/dev/null; \
    true

# Stage 3: Production runtime
FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY --from=build /app/package.json ./
COPY --from=build /app/feature-flags.json ./
COPY --from=build /app/app-config.yaml /app/app-config.docker.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/plugins ./plugins

ENV NODE_ENV=production
# Serve the bundled frontend from the same process/port as the API.
ENV OPENROADIE_WEB_DIR=/app/packages/app/dist

USER node

EXPOSE 7008

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "packages/backend/dist/index.js", "--config", "app-config.yaml", "--config", "app-config.docker.yaml"]
