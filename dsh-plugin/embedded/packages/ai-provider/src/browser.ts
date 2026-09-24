/** Browser-safe settings surface. Keep Node-backed transports out of renderer bundles. */
export type {
  AiProviderConfig,
  AiImageSource,
  AiProviderId,
  AiProviderMeta,
  AiSettings,
  CodexModelCatalog,
  AiSettingsV2,
  AiModelSelection,
  AiModelEntry,
  AiProviderProfile,
  AiWireProtocol,
  AiMediaProviderId,
  AiMediaProviderMeta,
  AiMediaProviderConfig,
  AiMediaSettings,
  AiSearchProviderId,
  AiSearchProviderMeta,
  AiSearchSettings,
} from './types'
export type { DiscoveryTarget } from './discovery'
export type { LocalToolStatus, LocalToolOpResult } from './local-tool'
export type { AiDefaultKind } from './settings-v2'
export type { VendorCatalogEntry } from './vendor-catalog'
export {
  AI_PROVIDERS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_MAX_OUTPUT_TOKENS,
  MIN_MAX_OUTPUT_TOKENS,
  clampMaxOutputTokens,
} from './providers'
export {
  DEFAULT_KIND_TYPES,
  findProfile,
  defaultSettingsV2,
  enabledChatModels,
  pickImageModel,
  resolveCurrentModel,
  resolveDefaultModel,
} from './settings-v2'
export { inferModelType } from './model-type'
export type { AiModelType } from './model-type'
export { modelAcceptsImages } from './settings-v2'
export { functionCallingVerdict, resolveModelCapabilities } from './capabilities'
export { imageGenerationAvailable, mediaAnalysisAvailable } from './media'
export {
  CHATOFFICE_PRESET_MODELS,
  NO_MODELS_API,
  VENDORS,
  VENDOR_BY_ID,
  VENDOR_GROUPS,
} from './vendor-catalog'
export { groupByType } from './model-type'
export { isImageGenModel } from './settings-v2'
export {
  SEARCH_PLATFORMS,
  capabilityDefaultSelection,
  capabilityVendorRefreshable,
  capabilityVendorRows,
  modelHasCapability,
  profileCapabilityModels,
  resolveCapabilityDefault,
} from './capability-tree'
export type { AiCapabilityKind, SearchPlatformKind, SearchPlatformMeta } from './capability-tree'
/** sentinel: untouched key field so the backend keeps the stored secret */
export const KEEP_KEY = '__keep__'
export { getProviderAdapter, modelLacksVision } from './registry'
export type { AiProtocol } from './registry'
export { AI_MEDIA_PROVIDERS } from './media'
export { AI_SEARCH_PROVIDERS } from './search-settings'
export { discoverModels } from './discovery'
export { setAiUserAgent } from './fetch'

// knowledge-base HTTP client (pure fetch — safe for renderer bundles)
export type {
  KbChain,
  KbCitation,
  KbDocInfo,
  KbDocRecord,
  KbHit,
  KbHttpClient,
  KbInfo,
  KbStatus,
} from './kb-client'
export { buildKbContext, createKbHttpClient, isKbStatus, KbError, mergeKbHits } from './kb-client'
