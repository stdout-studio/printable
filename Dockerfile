# Web app image for Kerf. Multi-stage build keeps the final image
# small and excludes dev dependencies + source. Compiles better-sqlite3
# from source at install time (needs python + make + g++ in the build stage).

FROM node:22-alpine AS deps
WORKDIR /repo

# Build-time toolchain for native dependencies (better-sqlite3, sharp).
RUN apk add --no-cache python3 make g++

RUN corepack enable && corepack prepare pnpm@11.4.0 --activate

# Copy workspace manifest + per-package manifests first so the layer cache
# only invalidates when a package.json changes.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc ./
COPY apps/web/package.json ./apps/web/
COPY apps/indexer/package.json ./apps/indexer/
COPY packages/shared-types/package.json ./packages/shared-types/

RUN pnpm install --frozen-lockfile --filter @printable/web... --filter @printable/indexer

FROM deps AS build
WORKDIR /repo

COPY tsconfig.base.json ./
COPY apps/web ./apps/web
COPY apps/indexer ./apps/indexer
COPY packages ./packages

RUN pnpm --filter @printable/web build

FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache python3 make g++ \
    && corepack enable \
    && corepack prepare pnpm@11.4.0 --activate

COPY --from=build /repo/pnpm-workspace.yaml /repo/pnpm-lock.yaml /repo/package.json /repo/.npmrc ./
COPY --from=build /repo/apps/web ./apps/web
COPY --from=build /repo/apps/indexer ./apps/indexer
COPY --from=build /repo/packages ./packages

RUN pnpm install --frozen-lockfile --prod --filter @printable/web...

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# Data directory must be writable + persisted. Compose mounts a volume.
ENV STDOUT_DATA_DIR=/app/data
RUN mkdir -p /app/data

CMD ["pnpm", "--filter", "@printable/web", "start"]
