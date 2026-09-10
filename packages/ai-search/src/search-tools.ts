/**
 * Search backends for the editors' main processes: reads ai-settings.json
 * live and turns the ChatOffice search settings into the local web/image
 * search chain’s gate — the ChatOffice CLI serves queries when the account
 * is signed in and cloud tools are on; otherwise the keyed/free backends run
 * (Serper/Tavily via env keys, then DuckDuckGo).
 */

import { activeSearchProvider, cloudToolsEnabled, type AiSettings } from '@chatoffice/ai-provider'
import { imageSearch, webSearch } from './index'
import { readAiSettingsFile } from './media-tools'

/** true = let the ChatOffice CLI serve the query (signed in + cloud tools on) */
export function useChatOfficeBackend(settings: AiSettings): boolean {
  return activeSearchProvider(settings) === 'chatoffice' && cloudToolsEnabled(settings)
}

export function webSearchTool(settingsPath: string, query: string, maxResults = 6) {
  return webSearch(query, maxResults, useChatOfficeBackend(readAiSettingsFile(settingsPath)))
}

export function imageSearchTool(settingsPath: string, query: string, maxResults = 8) {
  return imageSearch(query, maxResults, useChatOfficeBackend(readAiSettingsFile(settingsPath)))
}
