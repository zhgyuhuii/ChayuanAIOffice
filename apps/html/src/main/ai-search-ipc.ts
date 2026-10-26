/**
 * Standalone search IPC for the html main process: the shared ai:* channels are
 * registered app-wide by docs-main registerAiIpc in shell mode, so tab mode
 * must not register them again (a second handler for the same channel throws).
 * Standalone html has no shell or docs process, so startHtmlStandalone wires
 * the search tools here — same source as sheets-main (keyed providers with the
 * DuckDuckGo fallback, configured through V2 ai-settings.json; the web tier
 * reads provider keys from the settings file with env fallbacks).
 */
import { app, ipcMain } from 'electron'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { imageSearch, webSearch } from '@chaoffice/ai-search'

const AI_SETTINGS_PATH = () => join(app.getPath('userData'), 'ai-settings.json')

interface RawSearchSettings {
  search?: {
    provider?: string
    providers?: Record<string, { apiKey?: string } | undefined>
  }
}

let searchIpcRegistered = false

async function readSearchSettings(): Promise<RawSearchSettings | null> {
  try {
    return JSON.parse(await readFile(AI_SETTINGS_PATH(), 'utf8')) as RawSearchSettings
  } catch {
    return null
  }
}

/** Same key resolution as sheets-main's ai:web-search handler. */
function searchKeys(s: RawSearchSettings | null) {
  const providers = s?.search?.providers
  return {
    serper: providers?.serper?.apiKey || process.env.SERPER_API_KEY || undefined,
    tavily: providers?.tavily?.apiKey || process.env.TAVILY_API_KEY || undefined,
    linkup: providers?.linkup?.apiKey || process.env.LINKUP_API_KEY || undefined,
    exa: providers?.exa?.apiKey || process.env.EXA_API_KEY || undefined,
    firecrawl: providers?.firecrawl?.apiKey || process.env.FIRECRAWL_API_KEY || undefined,
    keenable: providers?.keenable?.apiKey || process.env.KEENABLE_API_KEY || undefined,
    searxngBaseUrl: providers?.searxng?.apiKey || undefined,
  }
}

export function registerHtmlAiSearchIpc(): void {
  if (searchIpcRegistered) return
  searchIpcRegistered = true

  // Shared search tools (content + images): same shape as sheets-main /
  // docs-main / slides ai-ipc
  ipcMain.handle('ai:web-search', async (_event, query: unknown, maxResults?: unknown) => {
    try {
      const s = await readSearchSettings()
      return await webSearch(
        String(query),
        typeof maxResults === 'number' ? maxResults : 6,
        false,
        searchKeys(s),
        s?.search?.provider,
      )
    } catch (err) {
      return { results: [], method: 'error', error: String(err) }
    }
  })
  ipcMain.handle('ai:image-search', async (_event, query: unknown, maxResults?: unknown) => {
    try {
      return await imageSearch(String(query), typeof maxResults === 'number' ? maxResults : 8, false)
    } catch (err) {
      return { images: [], method: 'error', error: String(err) }
    }
  })
}
