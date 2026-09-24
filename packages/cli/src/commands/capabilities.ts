import {
  activeMediaProvider,
  activeSearchProvider,
  imageGenerationAvailable,
  mediaAnalysisAvailable,
} from '@chatoffice/ai-provider'
import { hasChatOfficeAuth, readAiSettingsFile } from '@chatoffice/ai-search'
import { aiSettingsPath, prepareCloud } from '../cloud'
import type { CommandDef } from '../registry'
import { appLaunch } from '../resources'

/**
 * What the local commands can do on this machine, decided from settings
 * without a network call: a BYOK search key or a free provider (DuckDuckGo).
 * Agents check this once before planning work that needs photos or web facts.
 */
export const capabilitiesCommand: CommandDef = {
  name: 'capabilities',
  summary:
    'Report which features (search, image search, image generation, media analysis) are configured, and whether the app is installed.',
  usage: 'capabilities',
  async run(_args, ctx) {
    await prepareCloud(ctx.env)
    const settings = readAiSettingsFile(aiSettingsPath(ctx.env))
    const searchProvider = activeSearchProvider(settings)
    const search = true
    const imageSearch = searchProvider === 'serper' || searchProvider === 'bing' || searchProvider === 'duckduckgo' || searchProvider === 'openverse'
    const imageGeneration = imageGenerationAvailable(settings, hasChatOfficeAuth())
    const mediaAnalysis = mediaAnalysisAvailable(settings, hasChatOfficeAuth())
    const detail = {
      search: { available: search, via: searchProvider },
      image_search: {
        available: imageSearch,
        via: imageSearch ? searchProvider : null,
      },
      image_generation: {
        available: imageGeneration,
        via: imageGeneration ? activeMediaProvider(settings, 'image') : null,
      },
      media_analysis: {
        available: mediaAnalysis,
        via: mediaAnalysis ? activeMediaProvider(settings, 'analysis') : null,
      },
      app: { available: appLaunch(ctx.env) !== null },
      settings_path: aiSettingsPath(ctx.env),
    }
    const on = Object.entries(detail)
      .filter(([k, v]) => k !== 'settings_path' && (v as { available: boolean }).available)
      .map(([k]) => k)
    return {
      summary: on.length
        ? `configured: ${on.join(', ')}`
        : 'no feature configuration found; the app is not installed',
      detail,
    }
  },
}
