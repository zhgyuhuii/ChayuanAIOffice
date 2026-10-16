/**
 * @vitest-environment jsdom
 */
// 设置弹窗的 deep-link 落点（ai:open-model-settings 广播链的渲染端）：
// 插入图片对话框的「⚙ 设置」要求弹开的是左下角设置按钮同款弹窗、并直接
// 落在「生图、媒体与搜索」分组，而不是默认的「模型设置」。
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi } from '../src/shared/home-api'
import {
  SettingsModal,
  coerceSectionId,
  type SettingsModalProps,
} from '../src/renderer/src/SettingsModal'
import { LocaleProvider } from '../src/renderer/src/locale'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  // 最小 chaOffice 桩（与 settings-integrations.test.ts 同一套）
  window.chaOffice = {
    getTheme: async () => 'system',
    getDefaultSaveDir: async () => '',
    getAnalyticsEnabled: async () => true,
    getAutoSaveDefault: async () => ({ on: false, updatedAt: 0 }),
    getAiPanelPrefs: async () => ({ fontSize: 'default', spellcheck: true }),
    getUpdateChannel: async () => 'stable',
    getAppVersion: async () => '1.0.0',
    githubStars: async () => null,
    getAiSettings: async () => null,
    setAiSettings: async () => undefined,
    setAiCurrentModel: async () => undefined,
    aiDiscoverModels: async () => ({ models: [] }),
    chaofficeStatus: async () => ({ state: 'signed-out' }),
    chaofficeLogin: async () => undefined,
    aiLocalToolStatus: async () => ({ state: 'missing' }),
    aiLocalToolInstall: async () => ({ ok: false }),
  } as unknown as HomeApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

async function mountModal(extra?: Partial<SettingsModalProps>): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        null,
        createElement(SettingsModal, {
          status: null,
          loggingOut: false,
          loginWaiting: false,
          loginUrl: null,
          urlCopied: false,
          onOpenLoginUrl: vi.fn(),
          onCopyLoginUrl: vi.fn(),
          onClose: vi.fn(),
          onLogin: vi.fn(),
          onLogout: vi.fn(),
          ...extra,
        }),
      ),
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}

/** the sidebar entry the modal opened on (aria-current rides the active item) */
function activeNavLabel(): string {
  const active = host.querySelector('.set-nav-item[aria-current="true"]')
  expect(active).toBeTruthy()
  return (active as HTMLElement).textContent ?? ''
}

describe('SettingsModal deep-link landing section', () => {
  it("opens on AI Media & Search when initialSection='aiMedia' (insert-image ⚙)", async () => {
    await mountModal({ initialSection: 'aiMedia' })
    expect(activeNavLabel()).toContain('AI Media & Search')
  })

  it('defaults to Model Settings without a deep link (unchanged behavior)', async () => {
    await mountModal()
    expect(activeNavLabel()).toContain('Model Settings')
  })

  it('coerceSectionId narrows the relayed section id and rejects unknown ids', () => {
    expect(coerceSectionId('aiMedia')).toBe('aiMedia')
    expect(coerceSectionId('modelSettings')).toBe('modelSettings')
    // nav-only narrowing: 'aiModel' is a valid SectionId but has no sidebar
    // entry, so a relayed 'aiModel' falls back to the default section
    expect(coerceSectionId('aiModel')).toBeUndefined()
    expect(coerceSectionId('bogus')).toBeUndefined()
  })
})
