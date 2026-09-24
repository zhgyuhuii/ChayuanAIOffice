# ChatOffice BFF + Web — single artifact for the SaaS and private deployments
# alike (plan v2.1, decision #9). One image serves the API, the web host and
# the five editor bundles on one port.
#
#   docker build -f apps/server/Dockerfile -t chatoffice-server .
#   docker run -p 52587:8787 -v chatoffice-data:/data chatoffice-server

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
#
# rollup/esbuild ship their native binaries as os/cpu-gated optionalDependencies
# and npm ci installs strictly from the lock. The repo lock was grown on
# mac/win hosts and carries no linux platform entries, so the builder installs
# the linux-x64 natives explicitly at the versions the resolved rollup/esbuild
# expect (esbuild's install.js also self-heals from the registry, but rollup
# has no fallback and vite dies with MODULE_NOT_FOUND in rollup/dist/native.js).
RUN npm ci --no-audit --no-fund --ignore-scripts \
 && node node_modules/esbuild/install.js \
 && ROLLUP_NATIVE=$(node -p "require('./node_modules/rollup/package.json').optionalDependencies['@rollup/rollup-linux-x64-gnu']") \
 && ESBUILD_NATIVE=$(node -p "require('./node_modules/esbuild/package.json').optionalDependencies['@esbuild/linux-x64']") \
 && npm install --no-save --no-audit --no-fund \
      @rollup/rollup-linux-x64-gnu@$ROLLUP_NATIVE \
      @esbuild/linux-x64@$ESBUILD_NATIVE

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
    CHATOFFICE_DATA_DIR=/data \
    CHATOFFICE_STATIC_DIR=/app/dist/web
VOLUME ["/data"]

EXPOSE 52587
# tsx-assets.cjs: register require.extensions for `?asset` imports (slides
# main sources pulled in by the pptx pipeline import harfbuzz.wasm / .ttf)
CMD ["node", "--import", "tsx", "--import", "./apps/server/src/tsx-assets.cjs", "apps/server/src/main.ts"]
