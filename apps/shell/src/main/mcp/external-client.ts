import { randomUUID } from 'node:crypto'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { readAppSettings, writeAppSetting } from '../app-settings'
import type {
  ExternalMcpCallResult,
  ExternalMcpServerConfig,
  ExternalMcpServerTools,
  ExternalMcpToolInfo,
  ExternalMcpVerifyResult,
} from '../../shared/mcp-client-api'

/**
 * External MCP client manager: the app connects OUT to user-registered MCP
 * servers (Settings → MCP 管理) and relays their tools to the home chat agent.
 *
 * The opposite direction (this app exposing its own editor tools as an MCP
 * server) lives in ./app-mcp.ts; the two share nothing but this folder.
 *
 * Storage: the `externalMcpServers` array in userData/app-settings.json.
 * Connections are cached per server id; a config change drops the connection
 * so the next call reconnects with the new settings.
 */

const SETTINGS_KEY = 'externalMcpServers'

const CLIENT_INFO = { name: 'chaoffice', version: '0.1.0' } as const

/** hard ceiling so a hostile/buggy server cannot flood the agent's tool list */
const MAX_SERVERS = 32
const MAX_TOOLS_PER_SERVER = 200
const MAX_TOTAL_AGENT_TOOLS = 400
const CONNECT_TIMEOUT_MS = 15_000
const CALL_TIMEOUT_MS = 120_000

interface LiveConnection {
  client: Client
  /** config fingerprint the connection was opened with; a mismatch reconnects */
  fingerprint: string
  tools: ExternalMcpToolInfo[]
  verifiedAt: number
}

export interface ExternalMcpManager {
  listServers(): ExternalMcpServerConfig[]
  saveServer(input: unknown): ExternalMcpServerConfig[]
  deleteServer(id: string): ExternalMcpServerConfig[]
  setServerEnabled(id: string, enabled: boolean): ExternalMcpServerConfig[]
  verifySaved(id: string): Promise<ExternalMcpVerifyResult>
  verifyDraft(draft: unknown): Promise<ExternalMcpVerifyResult>
  listAgentTools(): Promise<ExternalMcpServerTools[]>
  callTool(
    id: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ExternalMcpCallResult>
  /** drop one cached connection (no-op when absent); resolves when closed */
  disconnect(id: string): Promise<void>
  /** close every cached connection (app shutdown) */
  shutdown(): Promise<void>
}

export function createExternalMcpManager(options: {
  settingsPath: () => string
  log?: (message: string) => void
}): ExternalMcpManager {
  const { settingsPath } = options
  const log = options.log ?? (() => {})
  const connections = new Map<string, LiveConnection>()

  // ── persistence ──────────────────────────────────────────────

  function listServers(): ExternalMcpServerConfig[] {
    const saved = readAppSettings(settingsPath())[SETTINGS_KEY]
    return Array.isArray(saved) ? saved.filter(isServerConfig) : []
  }

  function persist(servers: ExternalMcpServerConfig[]): ExternalMcpServerConfig[] {
    writeAppSetting(settingsPath(), SETTINGS_KEY, servers)
    return servers
  }

  // ── validation (everything crossing IPC is untrusted) ────────

  function isServerConfig(value: unknown): value is ExternalMcpServerConfig {
    if (!value || typeof value !== 'object') return false
    const v = value as Partial<ExternalMcpServerConfig>
    return (
      typeof v.id === 'string' &&
      typeof v.name === 'string' &&
      (v.transport === 'http' || v.transport === 'sse' || v.transport === 'stdio') &&
      typeof v.enabled === 'boolean'
    )
  }

  function sanitizeStringMap(value: unknown, label: string): Record<string, string> {
    if (value === undefined || value === null) return {}
    if (typeof value !== 'object' || Array.isArray(value))
      throw new Error(`${label} must be an object`)
    const out: Record<string, string> = {}
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      if (typeof raw !== 'string') throw new Error(`${label}["${key}"] must be a string`)
      out[key.slice(0, 64)] = raw.slice(0, 4096)
    }
    return out
  }

  /** normalize an untrusted save/verify payload into a valid per-transport config */
  function normalizeConfig(
    input: unknown,
  ): Omit<ExternalMcpServerConfig, 'createdAt' | 'updatedAt'> {
    if (!input || typeof input !== 'object') throw new Error('server config must be an object')
    const raw = input as Record<string, unknown>
    const name = String(raw.name ?? '')
      .trim()
      .slice(0, 64)
    if (!name) throw new Error('name must not be empty')
    const transport = raw.transport
    if (transport !== 'http' && transport !== 'sse' && transport !== 'stdio') {
      throw new Error('transport must be http, sse or stdio')
    }
    const id = typeof raw.id === 'string' && raw.id ? raw.id : randomUUID()
    const headers = sanitizeStringMap(raw.headers, 'headers')
    const config: Omit<ExternalMcpServerConfig, 'createdAt' | 'updatedAt'> = {
      id,
      name,
      transport,
      enabled: raw.enabled !== false,
      lastVerify: null,
    }
    if (transport === 'http' || transport === 'sse') {
      const url = String(raw.url ?? '').trim()
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw new Error('url must be a valid http(s) URL')
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('url must use http or https')
      }
      config.url = url.slice(0, 2048)
      if (Object.keys(headers).length > 0) config.headers = headers
    } else {
      const command = String(raw.command ?? '')
        .trim()
        .slice(0, 512)
      if (!command) throw new Error('command must not be empty for stdio servers')
      config.command = command
      if (Array.isArray(raw.args)) {
        if (raw.args.length > 64) throw new Error('too many arguments')
        config.args = raw.args.map((a) => String(a).slice(0, 2048))
      }
      const env = sanitizeStringMap(raw.env, 'env')
      if (Object.keys(env).length > 0) config.env = env
    }
    return config
  }

  // ── connection handling ──────────────────────────────────────

  function buildTransport(server: ExternalMcpServerConfig) {
    if (server.transport === 'stdio') {
      return new StdioClientTransport({
        command: server.command ?? '',
        args: server.args ?? [],
        env: { ...getDefaultEnvironment(), ...(server.env ?? {}) },
        stderr: 'ignore',
      })
    }
    const url = new URL(server.url ?? 'http://127.0.0.1:0')
    const headers = server.headers ?? {}
    return server.transport === 'sse'
      ? new SSEClientTransport(url, { requestInit: { headers } })
      : new StreamableHTTPClientTransport(url, { requestInit: { headers } })
  }

  function fingerprint(server: ExternalMcpServerConfig): string {
    return JSON.stringify([
      server.transport,
      server.url,
      server.headers,
      server.command,
      server.args,
      server.env,
    ])
  }

  function withTimeout<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      work.then(
        (value) => {
          clearTimeout(timer)
          resolve(value)
        },
        (error) => {
          clearTimeout(timer)
          reject(error)
        },
      )
    })
  }

  async function disconnect(id: string): Promise<void> {
    const live = connections.get(id)
    connections.delete(id)
    if (!live) return
    try {
      await withTimeout(live.client.close(), 3000, 'close')
    } catch {
      // a stuck close must never block the caller
    }
  }

  /** open (or reuse) a live connection and refresh its tool list */
  async function connect(server: ExternalMcpServerConfig): Promise<LiveConnection> {
    const fp = fingerprint(server)
    const existing = connections.get(server.id)
    if (existing && existing.fingerprint === fp) return existing
    await disconnect(server.id)
    const client = new Client(CLIENT_INFO, {})
    try {
      await withTimeout(client.connect(buildTransport(server)), CONNECT_TIMEOUT_MS, 'connect')
      const listed = await withTimeout(client.listTools(), CONNECT_TIMEOUT_MS, 'listTools')
      const tools: ExternalMcpToolInfo[] = []
      for (const tool of listed.tools.slice(0, MAX_TOOLS_PER_SERVER)) {
        if (!tool || typeof tool.name !== 'string' || !tool.name) continue
        tools.push({
          name: tool.name,
          ...(typeof tool.description === 'string' && tool.description
            ? { description: tool.description.slice(0, 2048) }
            : {}),
          ...(tool.inputSchema && typeof tool.inputSchema === 'object'
            ? { inputSchema: tool.inputSchema as Record<string, unknown> }
            : {}),
        })
      }
      const live: LiveConnection = { client, fingerprint: fp, tools, verifiedAt: Date.now() }
      connections.set(server.id, live)
      return live
    } catch (error) {
      try {
        await client.close()
      } catch {
        // closing after a failed connect usually throws the original error
      }
      throw error
    }
  }

  function failure(error: unknown): ExternalMcpVerifyResult {
    const message = error instanceof Error ? error.message : String(error)
    log(`verify failed: ${message}`)
    return { ok: false, error: message, tools: [] }
  }

  /** untrusted lastVerify payload on save (the add-form stamps a fresh verify) */
  function verifyStamp(value: unknown): ExternalMcpServerConfig['lastVerify'] {
    if (!value || typeof value !== 'object') return null
    const v = value as { at?: unknown; ok?: unknown; toolCount?: unknown; error?: unknown }
    if (typeof v.at !== 'number' || typeof v.ok !== 'boolean' || typeof v.toolCount !== 'number') {
      return null
    }
    return {
      at: v.at,
      ok: v.ok,
      toolCount: v.toolCount,
      ...(typeof v.error === 'string' ? { error: v.error } : {}),
    }
  }

  // ── public surface ───────────────────────────────────────────

  const manager: ExternalMcpManager = {
    listServers,

    saveServer(input) {
      const normalized = normalizeConfig(input)
      const servers = listServers()
      const previous = servers.find((s) => s.id === normalized.id)
      if (servers.length >= MAX_SERVERS && !previous) {
        throw new Error(`too many servers (max ${MAX_SERVERS})`)
      }
      const now = Date.now()
      const saved: ExternalMcpServerConfig = {
        ...normalized,
        createdAt: previous?.createdAt ?? now,
        updatedAt: now,
        // the form stamps a verify it just ran; otherwise keep the previous
        // stamp (an edit without re-verifying does not invalidate it)
        lastVerify:
          verifyStamp((input as { lastVerify?: unknown }).lastVerify) ??
          previous?.lastVerify ??
          null,
      }
      const next = previous
        ? servers.map((s) => (s.id === saved.id ? saved : s))
        : [...servers, saved]
      void disconnect(saved.id)
      log(`saved server "${saved.name}" (${saved.transport})`)
      return persist(next)
    },

    deleteServer(id) {
      const next = listServers().filter((s) => s.id !== id)
      void disconnect(id)
      return persist(next)
    },

    setServerEnabled(id, enabled) {
      const servers = listServers()
      const next = servers.map((s) =>
        s.id === id ? { ...s, enabled, updatedAt: Date.now(), lastVerify: s.lastVerify } : s,
      )
      if (!enabled) void disconnect(id)
      return persist(next)
    },

    async verifySaved(id) {
      const server = listServers().find((s) => s.id === id)
      if (!server) return failure(new Error('server not found'))
      let result: ExternalMcpVerifyResult
      try {
        const live = await connect(server)
        result = { ok: true, tools: live.tools }
      } catch (error) {
        result = failure(error)
      }
      const stamp = {
        at: Date.now(),
        ok: result.ok,
        toolCount: result.tools.length,
        ...(result.ok ? {} : { error: result.error }),
      }
      const servers = listServers()
      persist(servers.map((s) => (s.id === id ? { ...s, lastVerify: stamp } : s)))
      return result
    },

    async verifyDraft(draft) {
      let server: ExternalMcpServerConfig
      try {
        const normalized = normalizeConfig(draft)
        server = { ...normalized, createdAt: 0, updatedAt: 0 }
      } catch (error) {
        return failure(error)
      }
      try {
        const live = await connect(server)
        // drafts connect under a throwaway id: keep the cache clean
        await disconnect(server.id)
        return { ok: true, tools: live.tools }
      } catch (error) {
        return failure(error)
      }
    },

    async listAgentTools() {
      const enabled = listServers().filter((s) => s.enabled)
      const settled = await Promise.allSettled(
        enabled.map(async (server) => {
          const live = await connect(server)
          return { serverId: server.id, serverName: server.name, tools: live.tools }
        }),
      )
      const out: ExternalMcpServerTools[] = []
      let total = 0
      for (const entry of settled) {
        if (entry.status !== 'fulfilled') {
          log(`agent tools: server unreachable: ${String(entry.reason?.message ?? entry.reason)}`)
          continue
        }
        if (total >= MAX_TOTAL_AGENT_TOOLS) break
        const value = entry.value
        out.push({
          ...value,
          tools: value.tools.slice(0, Math.max(0, MAX_TOTAL_AGENT_TOOLS - total)),
        })
        total += value.tools.length
      }
      return out
    },

    async callTool(id, toolName, args) {
      const server = listServers().find((s) => s.id === id)
      if (!server || !server.enabled) {
        return { ok: false, output: `MCP server not available: ${server?.name ?? id}` }
      }
      try {
        const live = await connect(server)
        const result = await withTimeout(
          live.client.callTool({ name: toolName, arguments: args }),
          CALL_TIMEOUT_MS,
          `call ${toolName}`,
        )
        return { ok: !result.isError, output: toolResultToText(result as ToolResultShape) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, output: `MCP call failed: ${message}` }
      }
    },

    disconnect: (id) => disconnect(id),

    async shutdown() {
      await Promise.allSettled([...connections.keys()].map((id) => disconnect(id)))
    },
  }

  return manager
}

/** the CallToolResult members this converter reads (keeps the SDK's union at arm's length) */
interface ToolResultShape {
  content?: unknown
  structuredContent?: unknown
}

/** MCP content blocks → model-facing text (text blocks joined, else JSON) */
function toolResultToText(result: ToolResultShape): string {
  const blocks = Array.isArray(result.content) ? result.content : []
  const texts: string[] = []
  for (const block of blocks) {
    if (
      block &&
      typeof block === 'object' &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string'
    ) {
      texts.push((block as { text: string }).text)
    }
  }
  if (texts.length > 0) return texts.join('\n').slice(0, 60_000)
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return JSON.stringify(result.structuredContent).slice(0, 60_000)
  }
  if (blocks.length > 0) return JSON.stringify(blocks).slice(0, 60_000)
  return '(empty result)'
}
