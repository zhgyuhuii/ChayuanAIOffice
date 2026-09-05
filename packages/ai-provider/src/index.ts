export type {
  AiChatRequest,
  AiChatResponse,
  AiModelEntry,
  AiModelSelection,
  AiProviderConfig,
  AiProviderId,
  AiProviderMeta,
  AiProviderProfile,
  AiSettings,
  AiSettingsV2,
  AiStreamChunk,
  AiStreamRequest,
  AiStreamRequestV2,
  AiWireProtocol,
  ChatOfficeAccountStatus,
  LegacyAiSettings,
} from './types'
export {
  AI_PROVIDERS,
  CHATOFFICE_LLM_BASE_URLS,
  activeProvider,
  cloudToolsEnabled,
  defaultAiSettings,
  resolveAiSettings,
} from './providers'
export { AI_PROVIDER_ADAPTERS, getProviderAdapter, modelLacksVision } from './registry'
export type {
  AiProtocol,
  ProviderAdapter,
  ProviderCapabilities,
  ResolvedEndpoint,
} from './registry'
export { chatForProvider, chatResolved } from './chat'
export { setRescueFetch } from './fetch'
export { isAiNetworkError } from './network-error'
export { isAiOverloadedError } from './overload-error'
export { AiCreditsError, sseLines, streamForProvider, streamResolved } from './stream'
export type { StreamCallbacks } from './stream'
export {
  AI_CHAT_RESPONSE_TIMEOUT_MS,
  AI_CONNECT_TIMEOUT_MS,
  AI_IDLE_TIMEOUT_MS,
  AiTimeoutError,
  createStreamWatchdog,
} from './watchdog'
export type { StreamWatchdog } from './watchdog'
// ---- settings v2 ----
export type { AiDefaultKind, ResolvedModelCall, StoredAiSettings } from './settings-v2'
export {
  DEFAULT_KIND_TYPES,
  defaultSettingsV2,
  enabledChatModels,
  findProfile,
  resolveDefaultModel,
  chatofficeEndpointFor,
  chatofficeProfile,
  isChatModel,
  isImageGenModel,
  migrateSettingsV2,
  modelAcceptsImages,
  pickImageModel,
  resolveCurrentModel,
  resolveModelCall,
} from './settings-v2'
export type { AiModelType } from './model-type'
export { TYPE_ORDER, groupByType, inferModelType, matchesModelType } from './model-type'
export type { VendorCatalogEntry } from './vendor-catalog'
export {
  CHATOFFICE_PRESET_MODELS,
  NO_MODELS_API,
  VENDORS,
  VENDOR_BY_ID,
  VENDOR_GROUPS,
  harnessKeyRefFor,
  harnessRouteFor,
} from './vendor-catalog'
export type { DiscoveryTarget } from './discovery'
export { discoverModels } from './discovery'
export type { ImageGenRequest, ImageGenResult } from './imagegen'
export { generateImageWithModel } from './imagegen'
export type {
  AiSettingsSource,
  DshFileReader,
  FileSourceFs,
  HarnessRpc,
  HarnessSourceDeps,
} from './settings-source'
export {
  createFileSource,
  createHarnessSource,
  parseHarnessCredentials,
  parseHarnessProviders,
  resolveHarnessSecret,
} from './settings-source'
export { KEEP_KEY, createAiRuntime } from './runtime'
export type { AiRuntime, AiRuntimeDeps, AiRuntimeChatOffice } from './runtime'
