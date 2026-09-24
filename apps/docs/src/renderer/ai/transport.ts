import { createIpcTransport, type AgentTransport } from '@chatoffice/agent-core'
import type { AiModelSelection } from '../../shared/ipc'
import { t } from '../i18n/locale'

/**
 * The shared IPC transport wired to the docs preload bridge (window.desktop).
 * The stream request carries only the current model selection — the main
 * process owns the settings and resolves profile + secret (keys never render).
 */
export function createElectronTransport(getSelection: () => AiModelSelection): AgentTransport {
  return createIpcTransport<AiModelSelection>({
    onStream: (listener) => window.desktop.onAiStream(listener),
    start: (request) => window.desktop.aiStream(request),
    cancel: (requestId) => void window.desktop.aiStreamCancel(requestId),
    getSettings: getSelection,
    unknownErrorText: () => t('aiUnknownError'),
    timeoutErrorText: () => t('aiTimeoutError'),
    creditsErrorText: () => t('aiCreditsExhausted'),
    networkErrorText: () => t('aiNetworkError'),
    overloadedErrorText: () => t('aiOverloadedError'),
  })
}
