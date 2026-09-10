import { createIpcTransport, type AgentTransport } from '@chatoffice/agent-core'
import type { AiModelSelection } from '@chatoffice/ai-provider'
import { t } from '../i18n/locale'

/** The shared IPC transport; the stream request carries only the model selection. */
export function createElectronTransport(getSelection: () => AiModelSelection): AgentTransport {
  return createIpcTransport<AiModelSelection>({
    onStream: (listener) => window.htmlApi.onAiStream(listener),
    start: (request) => window.htmlApi.aiStream(request),
    cancel: (requestId) => void window.htmlApi.aiStreamCancel(requestId),
    getSettings: getSelection,
    unknownErrorText: () => t('aiUnknownError'),
    timeoutErrorText: () => t('aiTimeoutError'),
    creditsErrorText: () => t('aiCreditsExhausted'),
    networkErrorText: () => t('aiNetworkError'),
    overloadedErrorText: () => t('aiOverloadedError'),
  })
}
