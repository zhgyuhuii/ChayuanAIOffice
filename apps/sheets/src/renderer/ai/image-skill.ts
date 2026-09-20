import type { AgentSkill } from '@chatoffice/agent-core'
import type { AiImageSource } from '@chatoffice/ai-provider'
import { sanitizeSvg } from '@chatoffice/pptx-render/svg-sanitize'
import { rasterizeSvg } from '@chatoffice/pptx-render/svg-raster'
import { t } from '../i18n/locale'
import { registerSvgDataUrl } from './svg-bank'

/**
 * Image acquisition AgentSkill: image_search (shared main-process channel, same
 * source as docs/slides), generate_image (the locally configured image model
 * via the sheets-owned channel) and generate_svg (offline vector tier — the
 * model draws, we rasterize). All
 * return a URL/handle; placement happens through the normal propose_operations
 * add_image path, which downloads the URL in the main process on apply.
 */

const PLACEMENT_PROMPT = `- To place an image on a sheet, pass the URL to propose_operations {op:"add_image", sheetId, path:"<https url>", anchorCell} — field details in guide charts. The image anchors at that cell and is written into the file on save (imported xlsx only). A rasterized generate_svg graphic is placed the same way, with path set to its dataref token.
- Only insert images the user asked for; data correctness always outranks decoration.`

const IMAGES_SYSTEM_PROMPT = `## Images
- image_search finds real web images (returns direct imageUrl entries); generate_image creates an illustration with AI when no suitable real image exists or the user explicitly wants generated art; generate_svg draws simple vector graphics offline (no image model needed).
${PLACEMENT_PROMPT}`

const IMAGES_SYSTEM_PROMPT_NO_GEN = `## Images
- image_search finds real web images (returns direct imageUrl entries); generate_svg draws simple illustrations as offline vector graphics (no login needed).
${PLACEMENT_PROMPT}`

/**
 * One-line steering from the global default image source
 * (docs/image-source-plan.md #9 — the interactive sheets counterpart of the
 * deck-level picker). 'auto' stays the model's call; 'local' has no pool in
 * interactive sheets (folder pools are a deck-generation concept), so it
 * steers like 'auto'. Every line yields to an explicit per-request source ask.
 */
const IMAGE_SOURCE_DIRECTIVE: Record<AiImageSource, string> = {
  auto: '',
  local: '',
  web: '- Image source preference: web images — pick image_search first for pictures; use generate_image only when the user explicitly asks for AI-generated art.',
  model:
    '- Image source preference: AI generation — pick generate_image first for illustrations; when it is unavailable (no image model configured / failed), fall back to image_search.',
  svg: '- Image source preference: vector graphics — pick generate_svg first (offline, no login); use image_search only for real photos the user explicitly asks for.',
}

/**
 * `imageModelAvailable` is a live predicate: a local image-generation model is
 * configured in Settings (生图、媒体与搜索). The loop re-reads tools and
 * systemPrompt before every request, so generate_image appears and disappears
 * without rebuilding the loop.
 * `getImageSource` reads the persisted global default (AiSettingsV2.imageSource).
 */
export function createImageSkill(
  imageModelAvailable: () => boolean = () => true,
  getImageSource: () => AiImageSource = () => 'auto',
): AgentSkill {
  const allTools = [
    {
      name: 'image_search',
      description:
        'Search the web for images. Returns a numbered list of direct imageUrl entries with pixel sizes; ' +
        'pick one and insert it with propose_operations add_image (path = the URL).',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Image search keywords (English works better)' },
          maxResults: { type: 'integer', description: 'Maximum number of results, default 8' },
        },
        required: ['query'],
      },
    },
    {
      name: 'generate_image',
      description:
        'Generate an image with the image model configured in Settings (生图、媒体与搜索) from a text prompt. Returns a URL to insert ' +
        'with propose_operations add_image. Use for illustrations/decorative art; prefer image_search for real-world subjects.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: {
            type: 'string',
            description: 'What to draw — subject, style, composition (English works better)',
          },
          aspectRatio: {
            type: 'string',
            description: 'Aspect ratio like "1:1", "16:9", "4:3"; default 1:1',
          },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'generate_svg',
      description:
        'Draw a simple illustration yourself as SVG markup — rasterized offline and placed via add_image with the returned dataref token (no AI image model or login needed). Best for icons, simple diagrams, geometric decoration. Rules: complete self-contained markup starting with <svg viewBox="0 0 W H">; NO external images/fonts/CSS/scripts; convert text to paths or use generic font-family; solid fills only; keep shapes inside the viewBox.',
      inputSchema: {
        type: 'object',
        properties: {
          svg: {
            type: 'string',
            description: 'Complete SVG markup, root <svg … viewBox="0 0 W H">…</svg>',
          },
        },
        required: ['svg'],
      },
    },
  ]
  return {
    id: 'images',
    get systemPrompt() {
      const base = imageModelAvailable() ? IMAGES_SYSTEM_PROMPT : IMAGES_SYSTEM_PROMPT_NO_GEN
      const line = IMAGE_SOURCE_DIRECTIVE[getImageSource()]
      return line ? `${base}\n${line}` : base
    },
    get tools() {
      return imageModelAvailable() ? allTools : allTools.filter((t) => t.name !== 'generate_image')
    },
    executeTool: async (call) => {
      if (call.name === 'image_search') {
        const query = String(call.input.query ?? '').trim()
        if (!query) {
          return {
            output: 'query must not be empty',
            isError: true,
            summary: t('aiToolImageSearch'),
          }
        }
        const result = await window.desktopApi.imageSearch(
          query,
          Number(call.input.maxResults) || 8,
        )
        // A backend failure must not read as an empty gallery — the model
        // would fabricate image choices
        if (result.method === 'error') {
          return {
            output: `image search failed (service error, not an empty result — you may retry): ${result.error ?? 'unknown error'}`,
            isError: true,
            summary: t('aiToolImageSearch'),
          }
        }
        const lines = result.images.map(
          (image, index) =>
            `${index + 1}. ${image.title || '(untitled)'} [${image.width ?? '?'}x${image.height ?? '?'}]\n   ${image.imageUrl}`,
        )
        return {
          output: lines.join('\n') || '(no images)',
          mutated: false,
          summary: t('aiToolImageSearchDone', { query, count: result.images.length }),
        }
      }
      if (call.name === 'generate_image') {
        const prompt = String(call.input.prompt ?? '').trim()
        if (!prompt) {
          return { output: 'prompt must not be empty', isError: true, summary: t('aiToolGenImage') }
        }
        const aspectRatio = String(call.input.aspectRatio ?? '').trim()
        const result = await window.desktopApi.generateImage({
          prompt,
          ...(aspectRatio ? { aspectRatio } : {}),
        })
        if (!result.url) {
          // Generation-failure fallback (docs/image-source-plan.md #9): a web
          // image keeps the request satisfiable without any paid source. An
          // explicit 'svg' default skips the web tier — never silently switch
          // to a source the user turned off — and points at generate_svg.
          const svgOnly = getImageSource() === 'svg'
          let pick: { imageUrl: string } | undefined
          if (!svgOnly) {
            try {
              const searched = await window.desktopApi.imageSearch(prompt, 5)
              pick =
                searched.method !== 'error'
                  ? searched.images.find((im) => /^https?:\/\//.test(im.imageUrl))
                  : undefined
            } catch {
              pick = undefined // channel missing/failed — the slot hands down to generate_svg
            }
          }
          if (pick) {
            return {
              output:
                `Image generation failed (${result.error ?? 'unknown error'}); a web image was used instead.\n` +
                `Insert it with propose_operations {op:"add_image", path:"${pick.imageUrl}", ...}.`,
              mutated: false,
              summary: t('aiToolGenImageDone'),
            }
          }
          return {
            output: `image generation failed: ${result.error ?? 'unknown error'}${svgOnly ? '' : ' — no web image matched either'}. Draw the illustration yourself with generate_svg (write SVG markup), or retry generate_image.`,
            isError: true,
            summary: t('aiToolGenImage'),
          }
        }
        return {
          output: `Image generated: ${result.url}\nInsert it with propose_operations {op:"add_image", path:"${result.url}", ...}.`,
          mutated: false,
          summary: t('aiToolGenImageDone'),
        }
      }
      if (call.name === 'generate_svg') {
        // Offline vector tier (docs/image-source-plan.md #9): the model draws,
        // we sanitize + rasterize here and hand back a short dataref token the
        // model passes to add_image — no image model, no giant
        // base64 blob in the model's context.
        const raw = String(call.input.svg ?? '').trim()
        const clean = sanitizeSvg(raw)
        if (!clean.ok) {
          return {
            output:
              'generate_svg needs "svg": complete standalone markup starting with <svg … viewBox="0 0 W H">.',
            isError: true,
            summary: t('aiToolGenSvg'),
          }
        }
        let raster: Awaited<ReturnType<typeof rasterizeSvg>>
        try {
          raster = await rasterizeSvg(clean.svg, { wPx: 480 })
        } catch (e) {
          return {
            output: `SVG render check failed: ${e instanceof Error ? e.message : String(e)} — fix the markup and call generate_svg again.`,
            isError: true,
            summary: t('aiToolGenSvg'),
          }
        }
        if (!raster.ok || !raster.base64 || (raster.paintRatio ?? 1) < 0.005) {
          return {
            output:
              'the SVG rendered blank — check the viewBox, fills and geometry, then call generate_svg again.',
            isError: true,
            summary: t('aiToolGenSvg'),
          }
        }
        const ref = registerSvgDataUrl(`data:image/png;base64,${raster.base64}`)
        return {
          output: `SVG rasterized and registered as ${ref}.\nInsert it with propose_operations {op:"add_image", path:"${ref}", ...}.`,
          mutated: false,
          summary: t('aiToolGenSvgDone'),
        }
      }
      return { output: `Unknown tool: ${call.name}`, isError: true, summary: call.name }
    },
  }
}
