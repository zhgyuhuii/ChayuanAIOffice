#!/usr/bin/env node
/** Test double for the Rust xlsx sidecar: same stdio JSON-lines protocol.
 *  open → one session with a tiny snapshot; read_range → canned cells;
 *  close → ack; unknown → error. */
const readline = require('node:readline')

let sessionSeq = 0
const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let req
  try {
    req = JSON.parse(line)
  } catch {
    return
  }
  const reply = (ok, result, error) => {
    process.stdout.write(JSON.stringify({ version: 1, requestId: req.requestId, ok, ...(ok ? { result } : { error }) }) + '\n')
  }
  if (req.command === 'open') {
    sessionSeq += 1
    reply(true, {
      sessionId: `sess-${sessionSeq}`,
      sheets: [{ id: 's1', name: 'Sheet1' }],
      snapshot: { sheetData: { s1: {} }, name: req.path },
    })
  } else if (req.command === 'read_range') {
    reply(true, { cells: [['A1', 'ok']] })
  } else if (req.command === 'close') {
    reply(true, { closed: true })
  } else if (req.command === 'explode') {
    reply(false, undefined, { code: 'bad', message: 'boom' })
  } else if (req.command === 'die') {
    process.exit(3)
  } else {
    reply(false, undefined, { code: 'unknown', message: `unknown command ${req.command}` })
  }
})
