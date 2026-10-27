/**
 * Which provider answers a file-naming request.
 *
 * The naming service used to carry its own list of provider ids and read the
 * key out of the settings file. That was the wrong answer twice over: the list
 * did not know every provider the build can talk to, and it never saw the
 * Genspark key, which lives in the login state rather than in the file — so
 * for the default account the call failed and the feature quietly did nothing.
 *
 * This module resolves the provider the way the rest of the app does: the
 * shared `resolveAiSettings` + `activeProvider` from `@chaoffice/ai-provider`,
 * the Genspark key from the gsk login state, and a custom endpoint's
 * credential reference resolved from the environment.
 */
import type { AiProviderConfig, AiProviderId } from '@chaoffice/ai-provider'
import {
  activeProvider,
  defaultAiSettings,
  resolveAiSettings,
  resolveProfileCredential,
} from '@chaoffice/ai-provider'

/** The provider to call, and the credentials to call it with. */
export interface NamingProvider {
  provider: AiProviderId
  config: AiProviderConfig
}

/**
 * The provider a naming request goes to, or null when no provider can answer.
 *
 * `stored` is the parsed `ai-settings.json`; `gskKey` is the login-backed key from
 * the login state, empty when signed out. Null rather than a broken provider:
 * a request with no usable provider is declined, and the caller keeps the name
 * the document already has.
 */
export function resolveNamingProvider(stored: unknown, gskKey: string): NamingProvider | null {
  // a missing/corrupt settings file behaves like a fresh install (defaults),
  // never a crash — resolveAiSettings requires an object
  const safeStored =
    stored && typeof stored === 'object'
      ? (stored as Parameters<typeof resolveAiSettings>[0])
      : {}
  const settings = resolveAiSettings(safeStored, defaultAiSettings())
  // a stored BYOK provider is honored when usable; a half-filled one falls back
  // to chaoffice rather than silently disabling AI
  settings.provider = activeProvider(settings)
  const provider = settings.provider
  const storedConfig = settings.providers?.[provider]
  if (!storedConfig) return null
  let config = storedConfig
  // the chaoffice key never enters the settings file; requests take it from the
  // login state
  if (provider === 'chaoffice' && !config.apiKey?.trim()) {
    config = { ...config, apiKey: gskKey }
  }
  // a custom endpoint may name an environment variable instead of storing a key
  config = resolveProfileCredential(config)
  // codex drives its own executable and needs neither a key nor a model id;
  // the login-backed profile leaves the model empty (the server picks its
  // default — model lists are discovered live, never stored in this repo)
  if (provider !== 'codex' && provider !== 'chaoffice' && !config.model?.trim()) return null
  if (provider !== 'codex' && !config.apiKey?.trim()) return null
  return { provider, config }
}
