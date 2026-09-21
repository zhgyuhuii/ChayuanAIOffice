/**
 * Server entry: SaaS (form ②) and embedded sidecar (forms ③④) share this
 * binary; configuration is entirely environment-driven (single-artifact
 * discipline, plan v2.1 decision #9).
 *
 *   PORT                listen port (default 8787)
 *   HOST                bind host (default 127.0.0.1; containers override)
 *   CHATOFFICE_DATA_DIR  storage root (default ./data)
 *   CHATOFFICE_AUTH      'jwt' to enforce Logto tokens, 'off' otherwise
 */

import { resolve } from 'node:path'
import { buildServer } from './app.ts'

const port = Number(process.env.PORT ?? 52587)
const host = process.env.HOST ?? '127.0.0.1'

const { app } = buildServer({
  dataDir: process.env.CHATOFFICE_DATA_DIR,
  staticDir: process.env.CHATOFFICE_STATIC_DIR
    ? resolve(process.env.CHATOFFICE_STATIC_DIR)
    : undefined,
})

app
  .listen({ port, host })
  .then((address) => console.log(`[chatoffice-server] listening on ${address}`))
  .catch((err) => {
    console.error('[chatoffice-server] failed to start:', err)
    process.exit(1)
  })
