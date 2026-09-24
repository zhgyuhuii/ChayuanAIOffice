import type {
  AiSearchProviderId,
  AiSearchProviderMeta,
  AiSearchSettings,
  AiSettings,
} from './types'

export const AI_SEARCH_PROVIDERS: AiSearchProviderMeta[] = [
  {
    id: 'serper',
    label: 'Serper',
    keyPlaceholder: 'Serper API key',
    imageSearch: true,
    needsKey: true,
  },
  {
    id: 'tavily',
    label: 'Tavily',
    keyPlaceholder: 'tvly-...',
    imageSearch: false,
    needsKey: true,
  },
  {
    id: 'linkup',
    label: 'Linkup',
    keyPlaceholder: 'Linkup API key',
    imageSearch: false,
    needsKey: true,
  },
  {
    id: 'searxng',
    label: 'SearxNG',
    keyPlaceholder: 'https://your-searxng.example.com',
    imageSearch: false,
    needsKey: true,
  },
  {
    id: 'duckduckgo',
    label: 'DuckDuckGo',
    keyPlaceholder: '',
    imageSearch: true,
    needsKey: false,
  },
  {
    id: 'bing',
    label: 'Bing',
    keyPlaceholder: '',
    imageSearch: true,
    needsKey: false,
  },
  {
    id: 'openverse',
    label: 'Openverse (CC)',
    keyPlaceholder: '',
    imageSearch: true,
    needsKey: false,
  },
]

/** providers usable for web search */
export const WEB_SEARCH_PROVIDERS = AI_SEARCH_PROVIDERS.filter((p) => p.id !== 'openverse')

/** providers usable for image search */
export const IMAGE_SEARCH_PROVIDERS = AI_SEARCH_PROVIDERS.filter((p) => p.imageSearch)

/** default web-search provider (first free one) */
export const DEFAULT_WEB_SEARCH_PROVIDER: AiSearchProviderId = 'duckduckgo'

/** default image-search provider (first free one with image support) */
export const DEFAULT_IMAGE_SEARCH_PROVIDER: AiSearchProviderId = 'bing'

/** providers that require an API key */
type KeyedSearchProviderId = 'serper' | 'tavily' | 'linkup' | 'searxng'
const KEYED_PROVIDERS: KeyedSearchProviderId[] = ['serper', 'tavily', 'linkup', 'searxng']

export function defaultAiSearchSettings(): AiSearchSettings {
  return { provider: 'duckduckgo', providers: {} }
}

export function resolveAiSearchSettings(
  stored: Partial<AiSearchSettings> | undefined,
): AiSearchSettings {
  const defaults = defaultAiSearchSettings()
  if (!stored) return defaults
  const providers = { ...defaults.providers }
  for (const id of KEYED_PROVIDERS) {
    const key = stored.providers?.[id]?.apiKey
    if (typeof key === 'string') {
      ;(providers as Record<string, { apiKey: string }>)[id] = { apiKey: key.trim() }
    }
  }
  const provider = stored.provider ?? defaults.provider
  if (!AI_SEARCH_PROVIDERS.some((m) => m.id === provider)) return defaults
  return { provider: provider as AiSearchProviderId, providers }
}

/** the stored search provider, honored when it exists; otherwise the default free provider */
export function activeSearchProvider(settings: Pick<AiSettings, 'search'>): AiSearchProviderId {
  const search = settings.search
  if (!search) return DEFAULT_WEB_SEARCH_PROVIDER
  if (!AI_SEARCH_PROVIDERS.some((m) => m.id === search.provider)) return DEFAULT_WEB_SEARCH_PROVIDER
  const meta = AI_SEARCH_PROVIDERS.find((m) => m.id === search.provider)!
  if (meta.needsKey) {
    const providers = search.providers as Record<string, { apiKey?: string }> | undefined
    // Trim-aware: a whitespace-only key from in-memory settings falls back
    // instead of sending `Bearer    ` to the search backend.
    return providers?.[search.provider]?.apiKey?.trim() ? search.provider : DEFAULT_WEB_SEARCH_PROVIDER
  }
  return search.provider
}
