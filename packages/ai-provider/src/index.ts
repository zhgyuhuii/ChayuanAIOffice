export type {
  AiChatRequest,
  AiChatResponse,
  AiImageSource,
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
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_MAX_OUTPUT_TOKENS,
  MIN_MAX_OUTPUT_TOKENS,
  activeProvider,
  clampMaxOutputTokens,
  cloudToolsEnabled,
  defaultAiSettings,
  maxOutputTokensOf,
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
export {
  capabilityBlockers,
  functionCallingVerdict,
  maxOutputTokensFor,
  resolveModelCapabilities,
  IMAGE_GEN_VENDOR_IDS,
  VIDEO_GEN_VENDOR_IDS,
} from './capabilities'
export type { ModelCapabilities, ModelCapabilityQuery, CapabilityVerdict } from './capabilities'
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
  isVideoGenModel,
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
  MediaJobAdapter,
  MediaJobPollResult,
  MediaJobRequest,
  MediaJobResult,
} from './media-jobs'
export {
  getMediaJobAdapter,
  registerMediaJobAdapter,
  runMediaJob,
} from './media-jobs'
export type { MediaParamField, MediaParamSpec } from './media-params'
export { imageParamSpec, videoParamSpec } from './media-params'
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
