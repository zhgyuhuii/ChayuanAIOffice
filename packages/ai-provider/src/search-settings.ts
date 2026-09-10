import type {
  AiSearchProviderId,
  AiSearchProviderMeta,
  AiSearchSettings,
  AiSettings,
} from './types'

export const AI_SEARCH_PROVIDERS: AiSearchProviderMeta[] = [
  {
    id: 'chatoffice',
    label: 'ChatOffice',
    keyPlaceholder: 'Not required - sign in to ChatOffice',
    imageSearch: true,
  },
  { id: 'serper', label: 'Serper', keyPlaceholder: 'Serper API key', imageSearch: true },
  { id: 'tavily', label: 'Tavily', keyPlaceholder: 'tvly-...', imageSearch: false },
]

export function defaultAiSearchSettings(): AiSearchSettings {
  return { provider: 'chatoffice', providers: { serper: { apiKey: '' }, tavily: { apiKey: '' } } }
}

export function resolveAiSearchSettings(
  stored: Partial<AiSearchSettings> | undefined,
): AiSearchSettings {
  const defaults = defaultAiSearchSettings()
  if (!stored) return defaults
  const providers = { ...defaults.providers }
  for (const id of ['serper', 'tavily'] as const) {
    const key = stored.providers?.[id]?.apiKey
    if (typeof key === 'string') providers[id] = { apiKey: key.trim() }
  }
  return { provider: stored.provider ?? defaults.provider, providers }
}

/** the stored search provider, honored only with a key; otherwise chatoffice (gsk + free chain) */
export function activeSearchProvider(settings: Pick<AiSettings, 'search'>): AiSearchProviderId {
  const search = settings.search
  if (!search || search.provider === 'chatoffice') return 'chatoffice'
  if (!AI_SEARCH_PROVIDERS.some((m) => m.id === search.provider)) return 'chatoffice'
  return search.providers?.[search.provider]?.apiKey ? search.provider : 'chatoffice'
}
