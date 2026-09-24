import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { McpServerService, type McpToolDefinition } from '../../src/main/mcp/mcp-server'
import { createExternalMcpManager } from '../../src/main/mcp/external-client'
import type { ExternalMcpManager } from '../../src/main/mcp/external-client'

/**
 * External MCP client manager (Settings → MCP 管理): persistence, validation,
 * online verification, agent tool listing and tool-call relay — exercised
 * against the app's own McpServerService running in-process on loopback, plus
 * a spawned stdio server fixture. This is the real handshake, not a mock.
 */

const TOOLS: McpToolDefinition[] = [
  {
    name: 'echo',
    description: 'echo the given text back',
    inputSchema: { text: z.string() },
    handler: (args) => ({ echoed: String(args.text) }),
  },
  {
    name: 'boom',
    description: 'always throws',
    handler: () => {
      throw new Error('tool exploded')
    },
  },
]

let service: McpServerService | undefined
let manager: ExternalMcpManager | undefined
let settingsDir: string

beforeEach(() => {
  settingsDir = mkdtempSync(join(tmpdir(), 'mcp-client-test-'))
})

afterEach(async () => {
  await manager?.shutdown()
  manager = undefined
  await service?.stop()
  service = undefined
  rmSync(settingsDir, { recursive: true, force: true })
})

/** find a free port by binding an ephemeral one, then releasing it */
async function freePort(): Promise<number> {
  const { createServer } = await import('node:http')
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

async function startServer(): Promise<number> {
  const port = await freePort()
  service = new McpServerService({ port, tools: TOOLS })
  await service.start()
  return port
}

function newManager(): ExternalMcpManager {
  manager = createExternalMcpManager({
    settingsPath: () => join(settingsDir, 'app-settings.json'),
  })
  return manager
}

describe('external MCP client manager', () => {
  it('persists servers and round-trips the enabled flag and delete', () => {
    const m = newManager()
    const saved = m.saveServer({ name: 'Demo', transport: 'http', url: 'http://127.0.0.1:9/mcp' })
    expect(saved).toHaveLength(1)
    expect(saved[0]!.name).toBe('Demo')
    expect(saved[0]!.enabled).toBe(true)
    const id = saved[0]!.id

    // a fresh manager over the same settings file sees the same servers
    const reloaded = newManager().listServers()
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0]!.id).toBe(id)

    const toggled = m.setServerEnabled(id, false)
    expect(toggled[0]!.enabled).toBe(false)

    expect(m.deleteServer(id)).toHaveLength(0)
  })

  it('rejects malformed configs', () => {
    const m = newManager()
    expect(() => m.saveServer({ name: '', transport: 'http', url: 'http://x/mcp' })).toThrow()
    expect(() => m.saveServer({ name: 'x', transport: 'bogus' })).toThrow()
    expect(() => m.saveServer({ name: 'x', transport: 'http', url: 'ftp://x/mcp' })).toThrow()
    expect(() => m.saveServer({ name: 'x', transport: 'http', url: 'not a url' })).toThrow()
    expect(() => m.saveServer({ name: 'x', transport: 'stdio', command: '' })).toThrow()
    expect(() =>
      m.saveServer({ name: 'x', transport: 'http', url: 'http://x/mcp', headers: { a: 1 } }),
    ).toThrow()
    expect(m.listServers()).toHaveLength(0)
  })

  it('verifies a saved http server, lists its tools and stamps lastVerify', async () => {
    const port = await startServer()
    const m = newManager()
    const [server] = m.saveServer({
      name: 'Local',
      transport: 'http',
      url: `http://127.0.0.1:${port}/mcp`,
    })

    const result = await m.verifySaved(server!.id)
    expect(result.ok).toBe(true)
    expect(result.tools.map((t) => t.name).sort()).toEqual(['boom', 'echo'])
    expect(result.tools[0]!.inputSchema).toEqual(expect.objectContaining({ type: 'object' }))

    const [after] = m.listServers()
    expect(after!.lastVerify?.ok).toBe(true)
    expect(after!.lastVerify?.toolCount).toBe(2)
  })

  it('verifies drafts without touching storage, and reports unreachable servers', async () => {
    const m = newManager()

    const ok = await m.verifyDraft({
      name: 'ghost draft',
      transport: 'http',
      url: 'http://127.0.0.1:1/mcp',
    })
    expect(ok.ok).toBe(false)
    expect(ok.error).toBeTruthy()
    expect(m.listServers()).toHaveLength(0)

    const bad = await m.verifyDraft({ name: 'x', transport: 'nope' })
    expect(bad.ok).toBe(false)
  })

  it('verifies the legacy SSE transport', async () => {
    const port = await startServer()
    const m = newManager()
    const [server] = m.saveServer({
      name: 'SSE Local',
      transport: 'sse',
      url: `http://127.0.0.1:${port}/sse`,
    })
    const result = await m.verifySaved(server!.id)
    expect(result.ok).toBe(true)
    expect(result.tools.map((t) => t.name)).toContain('echo')
  })

  it('listAgentTools returns enabled servers only; callTool relays results and errors', async () => {
    const port = await startServer()
    const m = newManager()
    const on = m
      .saveServer({ name: 'On', transport: 'http', url: `http://127.0.0.1:${port}/mcp` })
      .find((s) => s.name === 'On')!
    const off = m
      .saveServer({ name: 'Off', transport: 'http', url: `http://127.0.0.1:${port}/mcp` })
      .find((s) => s.name === 'Off')!
    m.setServerEnabled(off.id, false)

    const agentTools = await m.listAgentTools()
    expect(agentTools.map((s) => s.serverName)).toEqual(['On'])
    expect(agentTools[0]!.tools.map((t) => t.name).sort()).toEqual(['boom', 'echo'])

    const echoed = await m.callTool(on.id, 'echo', { text: 'hi' })
    expect(echoed.ok).toBe(true)
    expect(echoed.output).toContain('hi')

    const exploded = await m.callTool(on.id, 'boom', {})
    expect(exploded.ok).toBe(false)
    expect(exploded.output).toContain('tool exploded')

    const disabled = await m.callTool(off.id, 'echo', { text: 'x' })
    expect(disabled.ok).toBe(false)
    expect(disabled.output).toContain('not available')

    const unknown = await m.callTool('missing-id', 'echo', {})
    expect(unknown.ok).toBe(false)
  })

  it('spawns stdio servers, verifies them and relays calls', async () => {
    const m = newManager()
    const fixture = fileURLToPath(new URL('./fixtures/stdio-echo-server.mjs', import.meta.url))
    const [server] = m.saveServer({
      name: 'stdio echo',
      transport: 'stdio',
      command: process.execPath,
      args: [fixture],
    })

    const verified = await m.verifySaved(server!.id)
    expect(verified.ok).toBe(true)
    expect(verified.tools.map((t) => t.name).sort()).toEqual(['stdio_echo', 'stdio_ping'])

    const echoed = await m.callTool(server!.id, 'stdio_echo', { text: 'hi' })
    expect(echoed.ok).toBe(true)
    expect(echoed.output).toBe('stdio:hi')

    // a changed command invalidates the cached connection: next call reconnects
    const [updated] = m.saveServer({ ...server!, command: process.execPath })
    const again = await m.callTool(updated!.id, 'stdio_ping', {})
    expect(again.ok).toBe(true)
    expect(again.output).toBe('pong')
  })
})
