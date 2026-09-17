export {
  BRIDGE_PROTOCOL,
  isBridgeRequest,
  isBridgeSubscribe,
  type BridgeError,
  type BridgeEvent,
  type BridgeInbound,
  type BridgeOutbound,
  type BridgeRequest,
  type BridgeResponse,
  type BridgeSubscribe,
} from './protocol.js'
export { BridgeClient, bridgeClient } from './client.js'
export {
  degrade,
  degradeMany,
  degradeInfo,
  degradedChannels,
  registerBatch1Degradations,
  UNSUPPORTED_IN_BROWSER,
  type DegradeInfo,
} from './degrade.js'
export { FileHandleStore, fsAccessSupported, type OpenedFile } from './fsaccess.js'
export { installEditorShims } from './editor-shim.js'
export { createAiHttpBridge, type AiHttpBridge } from './ai-bridge.js'
export {
  createKbFetchBridge,
  installKbFetchBridge,
  kbApiBase,
  type KbFetchBridge,
} from './kb-bridge.js'
export { makeShim, sha256Hex, b64ToBytes, bytesToB64 } from './shim-factory.js'
