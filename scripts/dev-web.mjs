/**
 * Form ② dev: BFF + web host + the five editor renderer dev servers.
 * Ports: server 8787, host 5180, editors 5173–5177 (same as the Electron
 * dev shell, so editors never know which host they run in).
 */

import { spawn } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const jobs = [
  { name: 'server', color: 'red', cmd: ['run', 'dev', '-w', '@genoffice/server'] },
  { name: 'web', color: 'magenta', cmd: ['run', 'dev', '-w', '@genoffice/web'] },
  { name: 'docs', color: 'blue', cmd: ['run', 'dev:renderer', '-w', '@genoffice/docs'] },
  { name: 'sheets', color: 'green', cmd: ['run', 'dev:renderer', '-w', '@genoffice/sheets'] },
  { name: 'slides', color: 'yellow', cmd: ['run', 'dev:renderer', '-w', '@genoffice/slides'] },
  { name: 'pdf', color: 'cyan', cmd: ['run', 'dev:renderer', '-w', '@genoffice/pdf'] },
  { name: 'markdown', color: 'white', cmd: ['run', 'dev:renderer', '-w', '@genoffice/markdown'] },
]

const colors = {
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  blue: '\x1b[34m', magenta: '\x1b[35m', cyan: '\x1b[36m', white: '\x1b[37m',
}

const children = []
for (const job of jobs) {
  const child = spawn(npm, job.cmd, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32', // .cmd shims need a shell on Windows
  })
  const tag = `${colors[job.color]}[${job.name}]\x1b[0m `
  const pipe = (stream, isError) => {
    stream.setEncoding('utf8')
    let rest = ''
    stream.on('data', (chunk) => {
      rest = (rest + chunk).split('\n').map((l) => (l ? tag + l : l)).join('\n')
      const lines = rest.split('\n')
      rest = lines.pop() ?? ''
      // eslint-disable-next-line no-console
      console.log(lines.join('\n'))
      void isError
    })
  }
  pipe(child.stdout)
  pipe(child.stderr, true)
  child.on('exit', (code) => {
    // eslint-disable-next-line no-console
    console.error(`${tag}exited with ${code}`)
  })
  children.push(child)
}

console.log(`
GenOffice web dev (form 2):
  host    http://localhost:5180
  bff     http://localhost:8787/healthz
  editors http://localhost:5173..5177
`)

const shutdown = () => {
  for (const child of children) child.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
