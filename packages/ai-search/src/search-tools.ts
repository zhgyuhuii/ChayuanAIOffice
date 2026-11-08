/**
 * Search backends for the editors' main processes: reads ai-settings.json
 * live and dispatches to the configured web/image search provider chain
 * (Serper / Tavily / Linkup / SearxNG / DuckDuckGo / Bing / Openverse).
 */

import { activeSearchProvider, type AiSettings } from '@chaoffice/ai-provider'
import { imageSearch, webSearch } from './index'
import { readAiSettingsFile } from './media-tools'

function resolveSearchKeys(settings: AiSettings) {
  const search = settings.search
  if (!search) return undefined
  const providers = search.providers as Record<string, { apiKey?: string }> | undefined
  const keys: {
    serper?: string
    searchapi?: string
    tavily?: string
    linkup?: string
    searxngBaseUrl?: string
    parallelKey?: string
    keenable?: string
  } = {}
  const serper = providers?.serper?.apiKey
  if (serper) keys.serper = serper
  const tavily = providers?.tavily?.apiKey
  if (tavily) keys.tavily = tavily
  const linkup = providers?.linkup?.apiKey
  if (linkup) keys.linkup = linkup
  const searxng = providers?.searxng?.apiKey
  if (searxng) keys.searxngBaseUrl = searxng
  const parallel = providers?.parallel?.apiKey
  if (parallel) keys.parallelKey = parallel
  const keenable = providers?.keenable?.apiKey
  if (keenable) keys.keenable = keenable
  const searchapi = providers?.searchapi?.apiKey
  if (searchapi) keys.searchapi = searchapi
  const provider = activeSearchProvider(settings)
  const prefer = provider !== 'duckduckgo' ? provider : undefined
  return { keys: Object.keys(keys).length ? keys : undefined, prefer }
}

export async function webSearchTool(settingsPath: string, query: string, maxResults = 6) {
  const settings = readAiSettingsFile(settingsPath)
  const { keys, prefer } = resolveSearchKeys(settings) ?? { keys: undefined, prefer: undefined }
  return webSearch(query, maxResults, false, keys, prefer)
}

export async function imageSearchTool(settingsPath: string, query: string, maxResults = 8) {
  const settings = readAiSettingsFile(settingsPath)
  const serperKey = (settings.search?.providers as Record<string, { apiKey?: string }> | undefined)
    ?.serper?.apiKey
  return imageSearch(query, maxResults, false, serperKey)
}
