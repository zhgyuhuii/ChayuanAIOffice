# GenOffice BFF — single artifact for the SaaS and private deployments alike
# (plan v2.1, decision #9). Build context: repository root.
#
#   docker build -f apps/server/Dockerfile -t genoffice-server .

FROM node:22-bookworm-slim

WORKDIR /app

# Workspace manifests first for layer caching, then sources.
COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/storage-adapter/package.json packages/storage-adapter/package.json
COPY packages/service-core/package.json packages/service-core/package.json
COPY packages/project-store/package.json packages/project-store/package.json

RUN npm install --no-audit --no-fund --workspace @genoffice/server --workspace @genoffice/service-core --workspace @genoffice/storage-adapter --workspace @genoffice/project-store --include-workspace-root

COPY tsconfig.base.json ./
COPY packages packages
COPY apps/server apps/server

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    GENOFFICE_DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 8787
CMD ["node", "--experimental-strip-types", "apps/server/src/main.ts"]
