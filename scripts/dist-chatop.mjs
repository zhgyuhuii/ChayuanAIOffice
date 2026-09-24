/**
 * Form ③ packaging: the bundle the chatop desktop (chayuan-harness) embeds.
 *
 * Produces dist/chatop-chatoffice-<version>/ containing the same embedded
 * sidecar as the dsh plugin plus an integration README describing the two
 * hookup points in chayuan-harness:
 *
 *   1. desktop/ packaging: copy this directory into the app resources and
 *      stage/self-heal it like other bundled plugins (userData/plugins).
 *   2. desktop main: spawn the sidecar at startup via the same contract as
 *      dsh-plugin/src/host-side.cjs (start → { origin, stop }).
 *
 * The web SPA the desktop windows load is the form-② bundle: run
 * `npm run build:web` too when updating the editors.
 */

import { execSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const dist = join(root, 'dist')
const out = join(dist, `chatop-chatoffice-${version}`)

console.log('step 1: embedded sidecar')
execSync('node scripts/package-embedded.mjs', {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
cpSync(join(root, 'dsh-plugin', 'embedded'), join(out, 'embedded'), { recursive: true })
// host-side 逻辑已并入 dist/host.js（宿主半内），不再单独分发

writeFileSync(
  join(out, 'README.md'),
  `# chatop × ChatOffice bundle (v${version})

This bundle gives the chatop desktop (chayuan-harness) a fully offline
ChatOffice suite (plan v2.1, form 3).

\`\`\`
embedded/     self-contained BFF sidecar (run: node --import tsx
              embedded/apps/server/src/main.ts, env HOST/PORT/CHATOFFICE_DATA_DIR,
              CHATOFFICE_AUTH=off)
host-side.cjs lifecycle adapter: start(ctx) -> { origin, port, stop() }
\`\`\`

Integration (chayuan-harness side):

1. Ship this directory as an app resource; stage it into userData/plugins with
   the same integrity self-heal the bundled chatop-shell plugin uses.
2. In desktop main, call host-side.cjs \`start({ pluginDir, runtimeDir, log })\`
   at startup and load the returned \`origin\` in the ChatOffice app windows.
3. The editor SPA: either point windows at the form-2 web bundle shipped
   alongside (\`npm run build:web\` output) or at the SaaS origin when online.

Login-only cloud features (cloud documents, sync) route to the cloud BFF;
the embedded sidecar serves everything else offline.
`,
)

console.log(`\nchatop bundle ready: ${out}`)
