// A minimal stdio MCP server used as the spawn target in external-client
// tests: one tool (stdio_echo) that prefixes and echoes its input. Runs on the
// repo's hoisted @modelcontextprotocol/sdk + zod (resolved from this path).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'echo-stdio', version: '1.0.0' })

server.registerTool(
  'stdio_echo',
  {
    description: 'echo the text back over stdio',
    inputSchema: { text: z.string() },
  },
  async ({ text }) => ({ content: [{ type: 'text', text: `stdio:${text}` }] }),
)

server.registerTool('stdio_ping', { description: 'always replies pong' }, async () => ({
  content: [{ type: 'text', text: 'pong' }],
}))

await server.connect(new StdioServerTransport())
