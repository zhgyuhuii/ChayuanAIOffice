#!/usr/bin/env node

/**
 * ChaAI Office MCP stdio bridge.
 *
 * MCP clients that only speak stdio (Claude Desktop, Cursor) can't reach the
 * ChaAI Office localhost server directly. This script bridges stdin/stdout
 * JSON-RPC to the running app's legacy SSE transport (/sse + /messages).
 *
 * The ChaAI Office app must be running with the MCP server enabled
 * (Settings > General > Local MCP server).
 *
 * Usage:
 *   node scripts/mcp-stdio-bridge.js [--port 3093] [--host 127.0.0.1]
 *
 * Example mcp.json entry:
 *   {
 *     "mcpServers": {
 *       "chatoffice": {
 *         "command": "node",
 *         "args": ["/path/to/chatoffice/scripts/mcp-stdio-bridge.js"]
 *       }
 *     }
 *   }
 */

const http = require('node:http')
const readline = require('node:readline')

const DEFAULT_PORT = 3093
const DEFAULT_HOST = '127.0.0.1'

function parseArgs(argv) {
  let port = Number(process.env.GENOFFICE_MCP_PORT) || DEFAULT_PORT
  let host = process.env.GENOFFICE_MCP_HOST || DEFAULT_HOST
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--port' && argv[i + 1]) port = parseInt(argv[++i], 10)
    else if (argv[i] === '--host' && argv[i + 1]) host = argv[++i]
  }
  return { port, host }
}

const config = parseArgs(process.argv)
const baseUrl = `http://${config.host}:${config.port}`

let sessionId = null
let sseConnection = null
let connectingPromise = null
let reconnectTimer = null
let stopping = false

/** stderr only: stdout is the JSON-RPC channel */
function log(message) {
  process.stderr.write(`[chatoffice-mcp-bridge] ${message}\n`)
}

function sendResponse(response) {
  process.stdout.write(JSON.stringify(response) + '\n')
}

function httpRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl)
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => (data += chunk))
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, data: data ? JSON.parse(data) : null })
          } catch {
            resolve({ status: res.statusCode, data })
          }
        })
      },
    )
    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

function connectSSE() {
  if (sessionId && sseConnection && !sseConnection.destroyed) return Promise.resolve(sessionId)
  if (connectingPromise) return connectingPromise

  connectingPromise = new Promise((resolve, reject) => {
    const url = new URL('/sse', baseUrl)
    let settled = false
    let sessionTimeout

    log(`connecting to ${url.href}`)
    const req = http.get(url.href, (res) => {
      if (res.statusCode !== 200) {
        res.resume()
        settled = true
        reject(new Error(`SSE connection failed: ${res.statusCode}`))
        return
      }

      sseConnection = res
      let buffer = ''

      sessionTimeout = setTimeout(() => {
        if (!settled) {
          settled = true
          req.destroy()
          reject(new Error('timed out waiting for the SSE session id'))
        }
      }, 5000)

      res.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              sendResponse(JSON.parse(line.slice(6)))
            } catch {
              // endpoint URL / heartbeat comment: not JSON-RPC
            }
          }
          if (line.includes('sessionId=')) {
            const match = line.match(/sessionId=([a-zA-Z0-9-]+)/)
            if (match) {
              sessionId = match[1]
              log(`session ${sessionId}`)
              if (!settled) {
                settled = true
                clearTimeout(sessionTimeout)
                resolve(sessionId)
              }
            }
          }
        }
      })

      res.on('error', (err) => log(`SSE error: ${err.message}`))
      res.on('close', () => {
        clearTimeout(sessionTimeout)
        sseConnection = null
        sessionId = null
        if (!settled) {
          settled = true
          reject(new Error('SSE connection closed before the session initialized'))
        }
        if (!stopping) scheduleReconnect()
      })
    })

    req.on('error', (error) => {
      clearTimeout(sessionTimeout)
      if (!settled) {
        settled = true
        reject(error)
      }
    })
  }).finally(() => {
    connectingPromise = null
  })

  return connectingPromise
}

function scheduleReconnect() {
  if (stopping || reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    connectSSE().catch((error) => {
      log(`reconnect failed: ${error.message}`)
      scheduleReconnect()
    })
  }, 5000)
}

async function sendToServer(message) {
  if (!sessionId) await connectSSE()
  // legacy SSE delivers responses only on the stream; the POST ack body must
  // not be written to stdout or it corrupts the newline-delimited protocol
  const response = await httpRequest('POST', `/messages?sessionId=${sessionId}`, message)
  if (response.status < 200 || response.status >= 300) {
    const detail = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)
    throw new Error(`server returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`)
  }
}

async function handleRequest(request) {
  try {
    await sendToServer(request)
  } catch (error) {
    sendResponse({
      jsonrpc: '2.0',
      id: request.id,
      error: { code: -32603, message: error.message },
    })
  }
}

async function main() {
  log(`bridging stdio to ${baseUrl}`)
  try {
    const health = await httpRequest('GET', '/health')
    if (health.status === 200) log('ChaAI Office MCP server is reachable')
    else log('warning: unexpected /health response; is ChaAI Office running?')
  } catch {
    log(
      'warning: cannot reach ChaAI Office. Start the app and enable Settings > General > Local MCP server.',
    )
  }

  try {
    await connectSSE()
  } catch (error) {
    log(`SSE connection error: ${error.message}`)
  }

  const rl = readline.createInterface({ input: process.stdin, terminal: false })
  rl.on('line', (line) => {
    if (!line.trim()) return
    try {
      void handleRequest(JSON.parse(line))
    } catch (error) {
      log(`invalid JSON: ${error.message}`)
    }
  })

  const shutdown = (reason) => {
    if (stopping) return
    stopping = true
    log(`${reason}, exiting`)
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (sseConnection) sseConnection.destroy()
    process.exit(0)
  }
  rl.on('close', () => shutdown('stdin closed'))
  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((error) => {
  log(`fatal: ${error.message}`)
  process.exit(1)
})
