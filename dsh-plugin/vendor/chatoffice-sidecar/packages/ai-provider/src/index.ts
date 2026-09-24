export type {
  AiChatRequest,
  AiChatResponse,
  AiImageSource,
  AiModelEntry,
  AiModelSelection,
  CodexModelCatalog,
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
export {
  activeMediaConfig,
  activeMediaProvider,
  defaultAiMediaSettings,
  getMediaProviderMeta,
  imageGenerationAvailable,
  mediaAnalysisAvailable,
  mediaConfigUsable,
  providerHasCapability,
  resolveAiMediaSettings,
  videoAnalysisAvailable,
} from './media'
export type { MediaCapability } from './media'
export {
  AI_SEARCH_PROVIDERS,
  activeSearchProvider,
  defaultAiSearchSettings,
  resolveAiSearchSettings,
} from './search-settings'
export {
  analyzeMediaWithProvider,
  generateImageWithProvider,
  sniffImageMime,
  testMediaProvider,
} from './media-protocols'
export type {
  AnalyzeMediaInput,
  ByokMediaProviderId,
  GenerateImageInput,
  MediaBlob,
} from './media-protocols'
export { chatForProvider, chatResolved } from './chat'
export { setAiUserAgent, setRescueFetch } from './fetch'
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
export { parseOutputCapRejection } from './output-cap'
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
export { getMediaJobAdapter, registerMediaJobAdapter, runMediaJob } from './media-jobs'
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
export {
  CHATOP_LOCAL_AGENT_ID,
  CHATOP_LOCAL_KEY_REF,
  CHATOP_LOCAL_PROFILE_ID,
  chatopCapsHeuristic,
  chatopLocalModels,
  parseChatopLocalSource,
  parseChatopProxyKey,
  readChatopLocalSource,
} from './chatop-local'
export type { ChatopLocalModelInfo, ChatopLocalSource } from './chatop-local'
export { KEEP_KEY, createAiRuntime } from './runtime'
export type { AiRuntime, AiRuntimeDeps, AiRuntimeChatOffice } from './runtime'
export type { LocalToolStatus, LocalToolOpResult } from './local-tool'

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
export type { KbDiscoveryOptions, KbDiscoveryResult, KbDiscoverySource } from './kb-discovery'
export { discoverHarnessKb } from './kb-discovery'
