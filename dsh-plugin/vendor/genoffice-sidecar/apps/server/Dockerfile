# GenOffice BFF + Web — single artifact for the SaaS and private deployments
# alike (plan v2.1, decision #9). One image serves the API, the web host and
# the five editor bundles on one port.
#
#   docker build -f apps/server/Dockerfile -t genoffice-server .
#   docker run -p 52587:8787 -v genoffice-data:/data genoffice-server

# ── builder: full toolchain, produces dist/web ────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps apps
COPY packages packages
COPY scripts scripts
COPY tools tools
COPY tsconfig.base.json vitest.config.ts ./

# Only the renderers are built here; Electron binaries are never needed, so
# package scripts are skipped (electron's installer would download a runtime)
# and the ones the build actually needs are run by hand.
RUN npm ci --no-audit --no-fund --ignore-scripts \
 && node node_modules/esbuild/install.js

# build:web = 5 editor renderer builds + web host + config.js
RUN node scripts/build-web.mjs

# Drop the build toolchain; runtime needs only workspace prod deps (+tsx)
RUN npm prune --omit=dev

# ── runtime: sources + prod deps + web bundle, nothing else ───────────────
FROM node:22-bookworm-slim

WORKDIR /app
COPY --from=builder /repo/package.json package.json
COPY --from=builder /repo/node_modules node_modules
COPY --from=builder /repo/apps/server apps/server
# slides/sheets main sources: the server's pptx + save pipelines import them
COPY --from=builder /repo/apps/slides/src apps/slides/src
COPY --from=builder /repo/apps/sheets/src apps/sheets/src
COPY --from=builder /repo/packages packages
COPY tsconfig.base.json ./
COPY --from=builder /repo/dist/web dist/web

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=52587 \
    GENOFFICE_DATA_DIR=/data \
    GENOFFICE_STATIC_DIR=/app/dist/web
VOLUME ["/data"]

EXPOSE 52587
# tsx-assets.cjs: register require.extensions for `?asset` imports (slides
# main sources pulled in by the pptx pipeline import harfbuzz.wasm / .ttf)
CMD ["node", "--import", "tsx", "--import", "./apps/server/src/tsx-assets.cjs", "apps/server/src/main.ts"]
