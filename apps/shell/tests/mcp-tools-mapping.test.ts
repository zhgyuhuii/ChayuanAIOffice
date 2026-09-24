import { describe, expect, it } from 'vitest'
import {
  buildMcpToolDefs,
  mcpSystemSection,
  slugSegment,
} from '../src/renderer/src/home-chat/mcp-tools'

/** namespacespacing of external MCP tools for the home chat agent */

describe('slugSegment', () => {
  it('keeps identifier chars, collapses the rest, and never returns empty', () => {
    expect(slugSegment('Amap Maps!')).toBe('Amap-Maps')
    expect(slugSegment('a---b')).toBe('a-b')
    expect(slugSegment('高德地图')).toBe('x')
    expect(slugSegment('')).toBe('x')
  })
})

describe('buildMcpToolDefs', () => {
  it('namespaces tools per server and keeps original names in bindings', () => {
    const { tools, bindings } = buildMcpToolDefs([
      {
        serverId: 's1',
        serverName: 'Amap Maps',
        tools: [
          { name: 'geocode', description: '地点转坐标', inputSchema: { type: 'object' } },
          { name: 'weather', description: '查天气' },
        ],
      },
    ])
    expect(tools.map((t) => t.name)).toEqual(['mcp__Amap-Maps__geocode', 'mcp__Amap-Maps__weather'])
    expect(tools[0]!.description).toContain('Amap Maps')
    expect(tools[0]!.inputSchema).toEqual({ type: 'object' })
    // missing schema falls back to a permissive object so the tool stays callable
    expect(tools[1]!.inputSchema).toEqual({ type: 'object', properties: {} })
    expect(bindings.get('mcp__Amap-Maps__geocode')).toEqual({
      serverId: 's1',
      serverName: 'Amap Maps',
      toolName: 'geocode',
    })
  })

  it('de-duplicates colliding slugs across servers and inside one server', () => {
    const { tools } = buildMcpToolDefs([
      {
        serverId: 'a',
        serverName: 'demo',
        tools: [
          { name: 'run' },
          { name: 'run' }, // same tool name twice on one server
        ],
      },
      {
        serverId: 'b',
        serverName: 'demo', // same server name, different id
        tools: [{ name: 'run' }],
      },
    ])
    expect(new Set(tools.map((t) => t.name)).size).toBe(3)
    expect(tools.map((t) => t.name).sort()).toEqual([
      'mcp__demo-2__run',
      'mcp__demo__run',
      'mcp__demo__run-2',
    ])
  })

  it('ignores malformed entries instead of throwing', () => {
    const { tools } = buildMcpToolDefs([
      { serverId: 'a', serverName: 'x', tools: [{ name: '' }, null, { name: 'ok' }] as never },
      null,
    ])
    expect(tools.map((t) => t.name)).toEqual(['mcp__x__ok'])
  })
})

describe('mcpSystemSection', () => {
  it('groups tools by server and stays empty without tools', () => {
    expect(mcpSystemSection(new Map())).toBe('')
    const { bindings } = buildMcpToolDefs([
      { serverId: 'a', serverName: 'maps', tools: [{ name: 'geocode' }] },
      { serverId: 'b', serverName: 'search', tools: [{ name: 'query' }] },
    ])
    const section = mcpSystemSection(bindings)
    expect(section).toContain('## External MCP tools')
    expect(section).toContain('### maps')
    expect(section).toContain('mcp__maps__geocode → geocode')
    expect(section).toContain('### search')
  })
})
