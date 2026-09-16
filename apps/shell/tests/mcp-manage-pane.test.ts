/**
 * @vitest-environment jsdom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type {
  ExternalMcpServerConfig,
  ExternalMcpVerifyResult,
  McpClientApi,
} from '../src/shared/mcp-client-api'
import { McpManagePane } from '../src/renderer/src/McpManagePane'

/**
 * Settings → MCP 管理 pane: add-form draft → online verify → save, then the
 * server list (expand → tools, enable toggle, two-step delete) against a fully
 * mocked chatOfficeMcp bridge.
 */

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

let saveServer: Mock
let deleteServer: Mock
let setServerEnabled: Mock
let verifyServer: Mock
let verifyDraft: Mock
let servers: ExternalMcpServerConfig[]

function makeServer(patch: Partial<ExternalMcpServerConfig> = {}): ExternalMcpServerConfig {
  return {
    id: 'srv-1',
    name: 'Demo',
    transport: 'http',
    url: 'http://127.0.0.1:3999/mcp',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    lastVerify: null,
    ...patch,
  }
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  servers = []
  saveServer = vi.fn(async (config: ExternalMcpServerConfig) => {
    const next = servers.some((s) => s.id === config.id)
      ? servers.map((s) => (s.id === config.id ? { ...s, ...config } : s))
      : [...servers, config]
    servers = next as ExternalMcpServerConfig[]
    return servers
  })
  deleteServer = vi.fn(async (id: string) => {
    servers = servers.filter((s) => s.id !== id)
    return servers
  })
  setServerEnabled = vi.fn(async (id: string, enabled: boolean) => {
    servers = servers.map((s) => (s.id === id ? { ...s, enabled } : s))
    return servers
  })
  verifyServer = vi.fn(async (): Promise<ExternalMcpVerifyResult> => ({
    ok: true,
    tools: [
      { name: 'echo', description: 'echo text' },
      { name: 'add', description: 'add numbers' },
    ],
  }))
  verifyDraft = vi.fn(async (): Promise<ExternalMcpVerifyResult> => ({
    ok: true,
    tools: [
      { name: 'echo', description: 'echo text' },
      { name: 'add', description: 'add numbers' },
    ],
  }))
  window.chatOfficeMcp = {
    listServers: async () => servers,
    saveServer,
    deleteServer,
    setServerEnabled,
    verifyServer,
    verifyDraft,
    listAgentTools: async () => [],
    callTool: async () => ({ ok: true, output: '' }),
  } as McpClientApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  delete window.chatOfficeMcp
})

async function renderPane(): Promise<void> {
  const t = (key: string, params?: Record<string, string>): string => {
    if (key === 'mcpMgVerifyOk') return `Connected — ${params?.n ?? ''} tools`
    if (key === 'mcpMgToolsCount') return `${params?.n ?? ''} tools`
    return key
  }
  await act(async () => {
    root.render(createElement(McpManagePane, { t }))
    await Promise.resolve()
  })
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(host.querySelectorAll<HTMLButtonElement>('button')).find((b) =>
    b.textContent?.includes(label),
  )
  expect(found, `button "${label}"`).toBeDefined()
  return found!
}

async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await Promise.resolve()
  })
}

function input(id: string): HTMLInputElement {
  const el = host.querySelector<HTMLInputElement>(`#${id}`)
  expect(el, `input #${id}`).toBeDefined()
  return el!
}

async function type(el: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    // React ignores direct value writes; go through the native setter
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

describe('MCP 管理 pane', () => {
  it('starts empty with an add button', async () => {
    await renderPane()
    expect(host.textContent).toContain('mcpMgEmpty')
    expect(host.textContent).toContain('mcpMgAdd')
    expect(host.querySelector('.set-mcpm-server')).toBeNull()
  })

  it('add form: verify online previews the tools, save persists the server', async () => {
    await renderPane()
    await click(button('mcpMgAdd'))

    await type(input('mcpm-name'), 'Demo')
    await type(input('mcpm-url'), 'http://127.0.0.1:3999/mcp')

    await click(button('mcpMgVerify'))
    expect(verifyDraft).toHaveBeenCalledWith({
      name: 'Demo',
      transport: 'http',
      url: 'http://127.0.0.1:3999/mcp',
      headers: {},
    })
    // the preview lists every tool the server exposes
    expect(host.querySelector('[data-testid="mcpm-verify"]')?.textContent).toContain(
      'Connected — 2 tools',
    )
    expect(host.textContent).toContain('echo')

    await click(button('mcpMgSave'))
    expect(saveServer).toHaveBeenCalledTimes(1)
    const saved = saveServer.mock.calls[0]![0] as ExternalMcpServerConfig
    expect(saved.name).toBe('Demo')
    expect(saved.transport).toBe('http')
    expect(saved.enabled).toBe(true)
    // the list now shows the saved server with the verified tool count
    expect(host.querySelector('.set-mcpm-server .set-mcpm-name')?.textContent).toBe('Demo')
    expect(host.querySelector('.set-mcpm-server')?.textContent).toContain('2 tools')
  })

  it('blocks save on invalid input without calling the bridge', async () => {
    await renderPane()
    await click(button('mcpMgAdd'))
    await click(button('mcpMgSave'))
    expect(saveServer).not.toHaveBeenCalled()
    expect(host.textContent).toContain('mcpMgErrName')

    await type(input('mcpm-name'), 'Demo')
    await type(input('mcpm-url'), 'notaurl')
    await click(button('mcpMgSave'))
    expect(saveServer).not.toHaveBeenCalled()
    expect(host.textContent).toContain('mcpMgErrUrl')
  })

  it('expand lists the tools grouped under the server, toggle and delete round-trip', async () => {
    servers = [makeServer()]
    await renderPane()

    // click the group header: expands and fetches the live tool list
    await click(host.querySelector('.set-mcpm-head')!)
    expect(verifyServer).toHaveBeenCalledWith('srv-1')
    expect(host.querySelector('.set-mcpm-tools')?.textContent).toContain('echo')
    expect(host.querySelector('.set-mcpm-tools')?.textContent).toContain('add numbers')

    // collapse on a second click
    await click(host.querySelector('.set-mcpm-head')!)
    expect(host.querySelector('.set-mcpm-tools')).toBeNull()

    // enable toggle
    await click(host.querySelector<HTMLButtonElement>('.set-mcpm-server .set-switch')!)
    expect(setServerEnabled).toHaveBeenCalledWith('srv-1', false)

    // delete is two-step
    await click(button('mcpMgDelete'))
    expect(deleteServer).not.toHaveBeenCalled()
    await click(button('mcpMgConfirmDelete'))
    expect(deleteServer).toHaveBeenCalledWith('srv-1')
    expect(host.querySelector('.set-mcpm-server')).toBeNull()
  })
})
