// ── External MCP servers (the app as a CLIENT) ────────────────
// Settings → MCP 管理: the user registers third-party MCP servers; the app
// connects to them as a client and exposes their tools to the home chat agent.
// The local MCP *server* (this app exposing its own tools) is separate and
// lives under Settings → 集成.

/** transport used to reach an external MCP server */
export type ExternalMcpTransport = 'http' | 'sse' | 'stdio'

/** one registered external server (persisted in userData/app-settings.json) */
export interface ExternalMcpServerConfig {
  id: string
  name: string
  transport: ExternalMcpTransport
  /** http/sse: endpoint URL */
  url?: string
  /** http/sse: extra request headers (auth tokens etc.) */
  headers?: Record<string, string>
  /** stdio: executable to launch */
  command?: string
  /** stdio: command arguments */
  args?: string[]
  /** stdio: extra environment merged over the app's own */
  env?: Record<string, string>
  /** disabled servers keep their config but are excluded from the agent */
  enabled: boolean
  createdAt: number
  updatedAt: number
  /** outcome of the last verification (null when never verified) */
  lastVerify: { at: number; ok: boolean; toolCount: number; error?: string } | null
}

/** a tool offered by an external server (JSON-Schema input, like AgentToolDef) */
export interface ExternalMcpToolInfo {
  name: string
  description?: string
  inputSchema?: Record<string, unknown>
}

/** live tools of one enabled server, for the home chat agent */
export interface ExternalMcpServerTools {
  serverId: string
  serverName: string
  tools: ExternalMcpToolInfo[]
}

export interface ExternalMcpVerifyResult {
  ok: boolean
  /** connection failure description when !ok */
  error?: string
  tools: ExternalMcpToolInfo[]
}

export interface ExternalMcpCallResult {
  ok: boolean
  /** text form of the tool result (model-facing); error description when !ok */
  output: string
}

export interface McpClientApi {
  /** all registered servers (no tools; verify/expand fetches those live) */
  listServers(): Promise<ExternalMcpServerConfig[]>
  /** create or update one server; returns the full list after the change */
  saveServer(config: ExternalMcpServerConfig): Promise<ExternalMcpServerConfig[]>
  deleteServer(id: string): Promise<ExternalMcpServerConfig[]>
  /** flip a server's enabled flag (disabled drops its live connection) */
  setServerEnabled(id: string, enabled: boolean): Promise<ExternalMcpServerConfig[]>
  /** connect a saved server and list its tools; persists the lastVerify stamp */
  verifyServer(id: string): Promise<ExternalMcpVerifyResult>
  /** connect an unsaved draft (the add/edit form) without touching storage */
  verifyDraft(draft: {
    name?: string
    transport?: string
    url?: string
    headers?: Record<string, string>
    command?: string
    args?: string[]
    env?: Record<string, string>
  }): Promise<ExternalMcpVerifyResult>
  /** live tools of every enabled server; unreachable servers are skipped */
  listAgentTools(): Promise<ExternalMcpServerTools[]>
  /** run one tool on a registered server */
  callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ExternalMcpCallResult>
}

export const MCP_CLIENT_CHANNELS = {
  listServers: 'mcp-client:list-servers',
  saveServer: 'mcp-client:save-server',
  deleteServer: 'mcp-client:delete-server',
  setServerEnabled: 'mcp-client:set-server-enabled',
  verifyServer: 'mcp-client:verify-server',
  verifyDraft: 'mcp-client:verify-draft',
  listAgentTools: 'mcp-client:list-agent-tools',
  callTool: 'mcp-client:call-tool',
} as const
