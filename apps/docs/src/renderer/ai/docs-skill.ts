import type { Editor } from '@tiptap/core'
import type { AgentSkill } from '@chatoffice/agent-core'
import type { AiImageSource } from '../../shared/ipc'
import {
  AGENT_SYSTEM_PROMPT,
  buildDocContext,
  getSelectionScope,
  type AiTrack,
  type NumIds,
} from './protocol'
import type { AiDocWriter } from './doc-writer'
import type { AiPageSetupAccess } from './page-setup'
import {
  AGENT_TOOLS,
  executeTool,
  markDocSeen,
  type AiCommentsAccess,
  type AiHeaderFooterAccess,
  type FrozenSelection,
  type AiDocExtras,
} from './tools'
import type { AiNotesAccess } from './note-ops'

const _IMAGE_GEN_OFF_NOTE =
  '\n\nNote: generate_image is currently unavailable (no image model configured in Settings → 生图、媒体与搜索). Do not call or promise it; use image_search for imagery.'

/**
 * One-line steering from the global default image source
 * (docs/image-source-plan.md #9 — the interactive docs counterpart of the
 * deck-level picker). 'auto' stays the model's call; 'local' has no pool in
 * interactive docs (folder pools are a deck-generation concept), so it steers
 * like 'auto'. Every line yields to an explicit per-request source ask.
 */
const IMAGE_SOURCE_DIRECTIVE: Record<AiImageSource, string> = {
  auto: '',
  local: '',
  web: '- Image source preference: web images — pick image_search first for pictures; use generate_image only when the user explicitly asks for AI-generated art.',
  model:
    '- Image source preference: AI generation — pick generate_image first for illustrations; when it is unavailable (no image model configured / failed), fall back to image_search.',
  svg: '- Image source preference: vector graphics — pick generate_svg first (offline, no login); use image_search only for real photos the user explicitly asks for.',
}

const MEDIA_ANALYSIS_OFF_NOTE =
  '\n\nNote: analyze_media is currently unavailable (no media provider: signed out of Genspark or cloud tools off, and no media API key in Settings). You cannot see what a picture inside the document shows — tell the user that instead of guessing at its content.'

/**
 * The docx capability as an AgentSkill: document skeleton context, the five
 * document tools, and the local executor. Future apps register their own
 * skills (Excel / PPT) against the same agent loop.
 */
export function createDocsSkill(
  getEditor: () => Editor,
  getNumIds: () => NumIds,
  getTrack?: () => AiTrack | undefined,
  getComments?: () => AiCommentsAccess | undefined,
  getHf?: () => AiHeaderFooterAccess | undefined,
  getImageSource?: () => AiImageSource,
  /** streaming long-form writer behind write_document (panel-owned: progress chip, partial keep/discard) */
  getWriter?: () => AiDocWriter | undefined,
  getPageSetup?: () => AiPageSetupAccess | undefined,
  /** styles.xml catalog + page watermark stores (define_style / applyStyle / set_watermark) */
  getExtras?: () => AiDocExtras | undefined,
  getNotes?: () => AiNotesAccess | undefined,
  /** same as imageGenAvailable, for analyze_media (seeing pictures that are in the document) */
  mediaAnalysisAvailable?: () => boolean,
): AgentSkill {
  // Selection frozen per run: tools act on the range the prompt described,
  // not on wherever the user's live selection has wandered mid-run. The doc
  // snapshot bounds the freeze's validity (see FrozenSelection).
  let frozen: FrozenSelection | null = null
  /**
   * LOCAL 并集(上游 #544): 本地无 imageGenAvailable 参数(generate_image 门控由图源偏好
   * 与 imageGenerationAvailable 在会话体侧处理),mediaToolsOff 只收 analyze_media 门;
   * generate_image 的可用性过滤不在 docs-skill 内重复。
   */
  const mediaToolsOff = (): Set<string> => {
    const hidden = new Set<string>()
    if (mediaAnalysisAvailable?.() === false) hidden.add('analyze_media')
    return hidden
  }
  const mediaOffNote = (): string => (mediaToolsOff().size > 0 ? MEDIA_ANALYSIS_OFF_NOTE : '')
  return {
    id: 'docx',
    get systemPrompt() {
      // LOCAL 并集: 本地图源指令行(IMAGE_SOURCE_DIRECTIVE)+ 上游 #544 媒体工具可用性注记
      const line = getImageSource ? IMAGE_SOURCE_DIRECTIVE[getImageSource()] : ''
      const base = line ? `${AGENT_SYSTEM_PROMPT}\n${line}` : AGENT_SYSTEM_PROMPT
      return base + mediaOffNote()
    },
    get tools() {
      // 上游 #544: generate_image/analyze_media 按可用性过滤(替代静态 tools 列表)
      const hidden = mediaToolsOff()
      return hidden.size === 0 ? AGENT_TOOLS : AGENT_TOOLS.filter((t) => !hidden.has(t.name))
    },
    buildContext: () => {
      const editor = getEditor()
      markDocSeen(editor) // the context the model receives is the freshness baseline for index-addressed writes
      frozen = { scope: getSelectionScope(editor), doc: editor.state.doc }
      return buildDocContext(
        editor,
        frozen.scope,
        getComments?.()?.list(),
        getHf?.()?.read(),
        getPageSetup?.()?.list(),
      )
    },
    executeTool: (call, signal) =>
      executeTool(
        getEditor(),
        call,
        getNumIds(),
        getTrack?.(),
        signal,
        frozen,
        getComments?.(),
        getHf?.(),
        getImageSource,
        getWriter?.(),
        getPageSetup?.(),
        getExtras?.(),
        getNotes?.(),
      ),
  }
}
