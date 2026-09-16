import { ipcMain } from 'electron'
import type { ExternalMcpManager } from './external-client'
import { MCP_CLIENT_CHANNELS } from '../../shared/mcp-client-api'

/** wire the manager to the MCP_CLIENT_CHANNELS ipcMain handlers */
export function registerMcpClientIpc(manager: ExternalMcpManager): void {
  ipcMain.handle(MCP_CLIENT_CHANNELS.listServers, () => manager.listServers())

  ipcMain.handle(MCP_CLIENT_CHANNELS.saveServer, (_event, config: unknown) =>
    manager.saveServer(config),
  )

  ipcMain.handle(MCP_CLIENT_CHANNELS.deleteServer, (_event, id: unknown) => {
    if (typeof id !== 'string' || !id) throw new Error('Invalid server id.')
    return manager.deleteServer(id)
  })

  ipcMain.handle(MCP_CLIENT_CHANNELS.setServerEnabled, (_event, id: unknown, enabled: unknown) => {
    if (typeof id !== 'string' || !id) throw new Error('Invalid server id.')
    if (typeof enabled !== 'boolean') throw new Error('enabled must be a boolean')
    return manager.setServerEnabled(id, enabled)
  })

  ipcMain.handle(MCP_CLIENT_CHANNELS.verifyServer, (_event, id: unknown) => {
    if (typeof id !== 'string' || !id) throw new Error('Invalid server id.')
    return manager.verifySaved(id)
  })

  ipcMain.handle(MCP_CLIENT_CHANNELS.verifyDraft, (_event, draft: unknown) =>
    manager.verifyDraft(draft),
  )

  ipcMain.handle(MCP_CLIENT_CHANNELS.listAgentTools, () => manager.listAgentTools())

  ipcMain.handle(
    MCP_CLIENT_CHANNELS.callTool,
    (_event, id: unknown, toolName: unknown, args: unknown) => {
      if (typeof id !== 'string' || !id) throw new Error('Invalid server id.')
      if (typeof toolName !== 'string' || !toolName) throw new Error('Invalid tool name.')
      if (!args || typeof args !== 'object' || Array.isArray(args)) {
        throw new Error('Invalid tool arguments.')
      }
      return manager.callTool(id, toolName, args as Record<string, unknown>)
    },
  )
}
