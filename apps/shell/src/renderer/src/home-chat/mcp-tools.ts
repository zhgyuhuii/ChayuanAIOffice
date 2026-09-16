import type { AgentToolDef } from '@chatoffice/agent-core'
import type { ExternalMcpServerTools, ExternalMcpToolInfo } from '../../../shared/mcp-client-api'

/**
 * Namespace mapping for external MCP tools exposed to the home chat agent:
 * wire name `mcp__<server>__<tool>` (ZCode-style) keeps third-party tool names
 * from colliding with the built-in home tools and makes their origin visible
 * in the tool timeline. The tail segment keeps the ORIGINAL tool name, so the
 * binding map (wire → server/tool) is the single source of truth for calls.
 */

export interface McpToolBinding {
  serverId: string
  serverName: string
  toolName: string
}

/** [a-zA-Z0-9_-] only; everything else collapses to '-' */
export function slugSegment(raw: string): string {
  const cleaned = raw
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
  return cleaned || 'x'
}

const MAX_DESCRIPTION_CHARS = 1500

function toolDescription(serverName: string, tool: ExternalMcpToolInfo): string {
  const source = `[MCP server "${serverName}"]`
  const description = (tool.description ?? '').trim()
  const text = description ? `${source} ${description}` : `${source} external MCP tool`
  return text.slice(0, MAX_DESCRIPTION_CHARS)
}

function safeInputSchema(tool: ExternalMcpToolInfo): Record<string, unknown> {
  const schema = tool.inputSchema
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    return { ...schema }
  }
  // providers reject malformed schemas; a permissive object keeps the tool callable
  return { type: 'object', properties: {} }
}

/**
 * Build the namespaced AgentToolDef list plus the wire-name → binding map.
 * Collisions (two servers with the same slug, or a tool named like a built-in)
 * get a numeric suffix; input order is preserved so the agent's tool list is
 * stable across turns.
 */
export function buildMcpToolDefs(servers: ExternalMcpServerTools[]): {
  tools: AgentToolDef[]
  bindings: Map<string, McpToolBinding>
} {
  const tools: AgentToolDef[] = []
  const bindings = new Map<string, McpToolBinding>()
  const usedNames = new Set<string>()
  const usedServerSlugs = new Set<string>()

  const unique = (used: Set<string>, base: string): string => {
    if (!used.has(base)) {
      used.add(base)
      return base
    }
    let n = 2
    while (used.has(`${base}-${n}`)) n++
    const name = `${base}-${n}`
    used.add(name)
    return name
  }

  for (const server of servers) {
    if (!server || !Array.isArray(server.tools)) continue
    // two servers with the same name get a numbered server slug, so their
    // tools stay visually grouped instead of looking like tool variants
    const serverSlug = unique(usedServerSlugs, slugSegment(server.serverName))
    for (const tool of server.tools) {
      if (!tool || typeof tool.name !== 'string' || !tool.name) continue
      const wireName = unique(usedNames, `mcp__${serverSlug}__${slugSegment(tool.name)}`)
      tools.push({
        name: wireName,
        description: toolDescription(server.serverName, tool),
        inputSchema: safeInputSchema(tool),
      })
      bindings.set(wireName, {
        serverId: server.serverId,
        serverName: server.serverName,
        toolName: tool.name,
      })
    }
  }
  return { tools, bindings }
}

/** system-prompt section describing the available external MCP tools */
export function mcpSystemSection(bindings: Map<string, McpToolBinding>): string {
  if (bindings.size === 0) return ''
  const byServer = new Map<string, string[]>()
  for (const [wireName, binding] of bindings) {
    const list = byServer.get(binding.serverName) ?? []
    list.push(`${wireName} → ${binding.toolName}`)
    byServer.set(binding.serverName, list)
  }
  const groups = [...byServer.entries()]
    .map(([serverName, entries]) => `### ${serverName}\n${entries.join('\n')}`)
    .join('\n\n')
  return `## External MCP tools
The user connected external MCP servers; their tools are listed below (wire name → server tool). Use them automatically when the request matches what a tool does — do not ask the user to run anything manually. Tool results come back as text; report them faithfully, including failures.

${groups}`
}
