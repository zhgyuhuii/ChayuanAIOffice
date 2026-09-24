import { createIpcTransport, type AgentTransport } from '@chatoffice/agent-core'
import type { AiModelSelection } from '../../shared/ipc'
import { t } from '../i18n/locale'

/**
 * The shared IPC transport wired to the slides preload bridge (window.slidesApi).
 * The stream request carries only the current model selection — the main
 * process owns the settings and resolves profile + secret (keys never render).
 */
export function createElectronTransport(getSelection: () => AiModelSelection): AgentTransport {
  return createIpcTransport<AiModelSelection>({
    onStream: (listener) => window.slidesApi.onAiStream(listener),
    start: (request) => window.slidesApi.aiStream(request),
    cancel: (requestId) => void window.slidesApi.aiStreamCancel(requestId),
    getSettings: getSelection,
    unknownErrorText: () => t('aiErrUnknown'),
    timeoutErrorText: () => t('aiErrStreamTimeout'),
    creditsErrorText: () => t('aiCreditsExhausted'),
    networkErrorText: () => t('aiErrNetwork'),
    overloadedErrorText: () => t('aiErrOverloaded'),
  })
}
