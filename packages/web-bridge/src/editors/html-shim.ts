/**
 * HTML web shim — boot closed loop (open/new → edit → save in place), preview
 * degrades to the source view (the html-preview: scheme has no handler here),
 * AI runs over the BFF like the other editors.
 */
import { createAiHttpBridge } from '../ai-bridge.js'
import type { BridgeClient } from '../client.js'
import { b64ToBytes, bytesToB64, makeShim, pendingFromHash } from '../shim-factory.js'

export function installHtmlShim(client: BridgeClient): void {
  let currentFile: { id: string; name: string } | null = null
  let pendingConsumed = false

  const textEncoder = new TextEncoder()

  ;(window as unknown as Record<string, unknown>).htmlApi = makeShim(client, {
    prefix: 'html',
    impl: {
      ...createAiHttpBridge(),
      consumePending: async () => {
        if (pendingConsumed) return null
        pendingConsumed = true
        const p = pendingFromHash()
        if (!p) return null
        currentFile = { id: p.fileId, name: p.name }
        return `webfs:${p.fileId}:${p.name}`
      },
      // untitled (web 新建) 握手位：App 无条件 await，缺席即白屏（markdown 同款）
      consumeAiContent: async () => null,
      consumeHeadlessExport: async () => null,
      readFile: async (path: string) => {
        const m = /^webfs:([^:]+):(.*)$/.exec(path)
        if (!m) throw new Error(`web shim 只能读取通过宿主打开的文件：${path}`)
        currentFile = { id: m[1], name: m[2] }
        const doc = (await client.call('file', 'fs.read', m[1])) as { text?: string }
        if (doc.text === undefined) throw new Error('文件内容不可读')
        return doc.text
      },
      save: async (request: { text: string; mode: 'save' | 'saveAs'; suggestedName?: string }) => {
        const bytes = textEncoder.encode(request.text)
        if (request.mode === 'save' && currentFile) {
          await client.call('file', 'fs.write', currentFile.id, bytesToB64(bytes))
          return { ok: true as const, path: `webfs:${currentFile.id}:${currentFile.name}` }
        }
        const created = (await client.call(
          'file',
          'fs.saveAs',
          bytesToB64(bytes),
          request.suggestedName ?? '未命名.html',
        )) as { id: string; name: string } | null
        if (!created) return { ok: true as const, canceled: true }
        currentFile = created
        await client.call('local', 'recent.record', created.id, created.name, 'html')
        await client.call('local', 'tab.setTitle', created.id, created.name)
        return { ok: true as const, path: `webfs:${created.id}:${created.name}` }
      },
      // 预览：html-preview: scheme 在 web 形态无宿主注册——退化为空 URL，
      // App 的预览面板保持空白但不崩（源视图仍可用）
      getPreviewInfo: async () => ({ url: '' }),
      updatePreview: () => undefined,
      fetchImage: async () => null,
      readImage: async () => null,
      pickImage: async () => null,
      saveImage: async () => null,
      readAttachment: async () => null,
      getLanguage: async () => (localStorage.getItem('chaoffice.lang') as string) ?? 'zh',
      // AiSettingsV2 形状必须完整（App/model-bridge 直接读 .profiles 等），
      // null 会在模块初始化炸掉（「reading 'profiles'」白屏）——空配置安全态
      getAiSettings: async () => ({ version: 2 as const, profiles: [] }),
      onLanguageChanged: () => () => undefined,
      onThemeChanged: () => () => undefined,
      getTheme: async () => 'system' as const,
      onChromePressed: () => () => undefined,
    },
  })
}
