/**
 * Form ② dev: BFF + web host + the five editor renderer dev servers.
 * Ports: server 52587, host 5180, editors 5173–5177 (same as the Electron
 * dev shell, so editors never know which host they run in).
 */

import { spawn } from 'node:child_process'

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'

const jobs = [
  { name: 'server', color: 'red', cmd: ['run', 'dev', '-w', '@chatoffice/server'] },
  { name: 'web', color: 'magenta', cmd: ['run', 'dev', '-w', '@chatoffice/web'] },
  { name: 'docs', color: 'blue', cmd: ['run', 'dev:renderer', '-w', '@chatoffice/docs'] },
  { name: 'sheets', color: 'green', cmd: ['run', 'dev:renderer', '-w', '@chatoffice/sheets'] },
  { name: 'slides', color: 'yellow', cmd: ['run', 'dev:renderer', '-w', '@chatoffice/slides'] },
  { name: 'pdf', color: 'cyan', cmd: ['run', 'dev:renderer', '-w', '@chatoffice/pdf'] },
  { name: 'markdown', color: 'white', cmd: ['run', 'dev:renderer', '-w', '@chatoffice/markdown'] },
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
      console.log(lines.join('\n'))
      void isError
    })
  }
  pipe(child.stdout)
  pipe(child.stderr, true)
  child.on('exit', (code) => {
    console.error(`${tag}exited with ${code}`)
  })
  children.push(child)
}

console.log(`
ChatOffice web dev (form 2):
  host    http://localhost:5180
  bff     http://localhost:52587/healthz
  editors http://localhost:5173..5177
`)

const shutdown = () => {
  for (const child of children) child.kill()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
