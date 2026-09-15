// model-complete — one-shot non-streaming completion for docops services
// (declassify keyword extraction). Reuses the AI panel's IPC transport and the
// current model selection, so provider routing/settings behave identically.
import { streamText } from '@chatoffice/agent-core'
import { createElectronTransport } from '../ai/transport'
import type { AiModelSelection } from '../../shared/ipc'

export type CompleteText = (system: string, user: string) => Promise<string>

export function makeCompleter(getModel: () => AiModelSelection | null): CompleteText {
  return async (system, user) => {
    const model = getModel()
    if (!model) throw new Error('no-model')
    const transport = createElectronTransport(() => model)
    const outcome = await streamText({
      transport,
      system,
      user,
      maxChars: 200_000,
      extract: (raw) => ({ text: raw }),
    })
    if (outcome.status === 'complete') return outcome.text
    throw new Error(outcome.error || 'empty')
  }
}
