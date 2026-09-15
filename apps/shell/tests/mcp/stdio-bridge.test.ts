import { afterEach, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { z } from 'zod'
import { McpServerService } from '../../src/main/mcp/mcp-server'

/**
 * M5: the shipped stdio bridge against a live server — the exact path a
 * stdio-only client (Claude Desktop, Cursor) takes.
 */

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url))
const bridgePath = join(repoRoot, 'scripts', 'mcp-stdio-bridge.js')

let service: McpServerService | undefined
let child: ChildProcess | undefined

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(() => resolve(port))
    })
  })
}

afterEach(async () => {
  child?.kill()
  child = undefined
  await service?.stop()
  service = undefined
})

describe('stdio bridge', () => {
  it('relays a tools/list request from stdin to the server and back', async () => {
    const port = await freePort()
    service = new McpServerService({
      port,
      tools: [
        {
          name: 'ping',
          description: 'ping',
          inputSchema: { text: z.string() },
          handler: (args) => ({ pong: String(args.text) }),
        },
      ],
    })
    await service.start()

    child = spawn(process.execPath, [bridgePath, '--port', String(port)], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stdout: string[] = []
    child.stdout!.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) if (line.trim()) stdout.push(line.trim())
    })

    // give the bridge a moment to establish its SSE session
    await new Promise((resolve) => setTimeout(resolve, 1500))
    child.stdin!.write(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }) + '\n',
    )

    // poll for the response on stdout
    const deadline = Date.now() + 8000
    let parsed: { result?: { tools?: Array<{ name: string }> }; id?: number } | undefined
    while (Date.now() < deadline && !parsed) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      for (const line of stdout) {
        try {
          const msg = JSON.parse(line) as {
            id?: number
            result?: { tools?: Array<{ name: string }> }
          }
          if (msg.id === 1 && msg.result) parsed = msg
        } catch {
          // non-JSON bridge chatter never reaches stdout, but guard anyway
        }
      }
    }

    expect(parsed, `no tools/list response; stdout=${JSON.stringify(stdout)}`).toBeDefined()
    expect(parsed!.result!.tools!.map((t) => t.name)).toContain('ping')
  }, 20000)
})
