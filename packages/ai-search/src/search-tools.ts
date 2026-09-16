/**
 * Search backends for the editors' main processes: reads ai-settings.json
 * live and dispatches to the configured web/image search provider chain
 * (Serper / Tavily / Linkup / SearxNG / DuckDuckGo / Bing / Openverse).
 */

import { type AiSettings } from '@chatoffice/ai-provider'
import { imageSearch, webSearch } from './index'
import { readAiSettingsFile } from './media-tools'

function resolveSearchKeys(settings: AiSettings) {
  const search = settings.search
  if (!search) return undefined
  const providers = search.providers as Record<string, { apiKey?: string }> | undefined
  const keys: {
    serper?: string
    tavily?: string
    linkup?: string
    searxngBaseUrl?: string
  } = {}
  const serper = providers?.serper?.apiKey
  if (serper) keys.serper = serper
  const tavily = providers?.tavily?.apiKey
  if (tavily) keys.tavily = tavily
  const linkup = providers?.linkup?.apiKey
  if (linkup) keys.linkup = linkup
  const searxng = providers?.searxng?.apiKey
  if (searxng) keys.searxngBaseUrl = searxng
  return Object.keys(keys).length ? keys : undefined
}

export async function webSearchTool(settingsPath: string, query: string, maxResults = 6) {
  const settings = readAiSettingsFile(settingsPath)
  const keys = resolveSearchKeys(settings)
  return webSearch(query, maxResults, false, keys)
}

export async function imageSearchTool(settingsPath: string, query: string, maxResults = 8) {
  const settings = readAiSettingsFile(settingsPath)
  const serperKey = (settings.search?.providers as Record<string, { apiKey?: string }> | undefined)
    ?.serper?.apiKey
  return imageSearch(query, maxResults, false, serperKey)
}
