// @vitest-environment jsdom
/**
 * ModelSettingsPage render tests: portal mounting (it must escape the panel's
 * positioned ancestors), the vendor directory groups, and the config form.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { normalizeSettingsLang, modelSettingsStrings } from '../src/model-settings-strings'
import {
  ModelSettingsPage,
  type LocalToolStatus,
  type ModelSettingsBridge,
} from '../src/ModelSettingsPage'
import { defaultSettingsV2, type AiSettingsV2 } from '@chatoffice/ai-provider'

const bridge: ModelSettingsBridge = {
  getSettings: async () => defaultSettingsV2(),
  saveSettings: vi.fn(async () => {}),
  setCurrentModel: vi.fn(async () => {}),
  discoverModels: vi.fn(async () => ({ models: [] })),
  chatofficeStatus: vi.fn(async () => ({ loggedIn: false })),
  chatofficeLogin: vi.fn(async () => {}),
}

let host: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  document.body.innerHTML = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

async function render(override?: Partial<ModelSettingsBridge>): Promise<void> {
  await act(async () => {
    root!.render(
      createElement(ModelSettingsPage, { bridge: { ...bridge, ...override }, onClose: () => {} }),
    )
  })
}

describe('ModelSettingsPage', () => {
  it('mounts through a portal onto document.body (outside any panel ancestor)', async () => {
    await render()
    const overlay = document.body.querySelector('.msp-overlay')
    expect(overlay).toBeTruthy()
    // the portal renders directly under body, not inside the host container
    expect(overlay!.parentElement).toBe(document.body)
  })

  it('lands on the supported-models guide page: China cards before global, no login card', async () => {
    await render()
    const groups = [...document.body.querySelectorAll('.msp-group-head')].map(
      (el) => el.textContent,
    )
    // nothing enabled yet → no 已启用 group at all, just the four catalog groups
    expect(groups.length).toBeGreaterThanOrEqual(4)
    expect(groups.some((g) => /已启用|Enabled/.test(g ?? ''))).toBe(false)
    // landing = guide page, not the chatoffice sign-in card
    expect(document.body.querySelector('[data-model-guide-page]')).toBeTruthy()
    expect(document.body.querySelector('.msp-chatoffice-row')).toBeNull()
    // 国内在前、国外在后
    const sections = [...document.body.querySelectorAll('[data-guide-section]')].map((el) =>
      el.getAttribute('data-guide-section'),
    )
    expect(sections).toEqual(['cn', 'global'])
    expect(document.body.querySelector('[data-guide-card="deepseek"]')).toBeTruthy()
    expect(document.body.querySelector('[data-guide-card="openai"]')).toBeTruthy()

    // a guide card opens that vendor's config form
    await act(async () => {
      ;(document.body.querySelector('[data-guide-card="zhipu"]') as HTMLButtonElement).click()
    })
    expect(document.body.querySelector('[data-model-key]')).toBeTruthy()
  })

  it('hides the ChatOffice login entry entirely while USER_LOGIN_READY is false', async () => {
    await render()
    // no chatoffice row in the enabled group or any catalog group
    expect(document.body.querySelector('[data-vendor-row="chatoffice"]')).toBeNull()
    expect(document.body.querySelector('.msp-chatoffice-row')).toBeNull()
    // and none of the guide cards is chatoffice
    expect(document.body.querySelector('[data-guide-card="chatoffice"]')).toBeNull()
  })

  it('switches to a catalog vendor form with protocol select and key row', async () => {
    await render()
    const zhipu = document.body.querySelector('[data-vendor-row="zhipu"]') as HTMLButtonElement
    expect(zhipu).toBeTruthy()
    await act(async () => {
      zhipu.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const form = document.body.querySelector('.msp-form')
    expect(form).toBeTruthy()
    expect(form!.querySelector('[data-model-api]')).toBeTruthy()
    expect(form!.querySelector('[data-model-key]')).toBeTruthy()
    // protocol select offers all four native protocols
    const options = [
      ...(form!.querySelectorAll('[data-model-api] option') as NodeListOf<HTMLOptionElement>),
    ]
    expect(options.length).toBe(4)
  })

  it('renders inline (no portal, no dialog chrome) for host panes', async () => {
    await act(async () => {
      root!.render(createElement(ModelSettingsPage, { bridge, variant: 'inline' as const }))
    })
    // inline renders in place, not portaled to body
    expect(host.querySelector('.msp-inline-dialog')).toBeTruthy()
    expect(document.body.querySelector('.msp-overlay')).toBeNull()
    // no close button in inline mode — the host window closes
    expect(host.querySelector('.msp-close')).toBeNull()
  })

  it('follows the app locale, including BCP-47 tags (zh-CN → zh dict)', () => {
    expect(normalizeSettingsLang('zh-CN')).toBe('zh')
    expect(normalizeSettingsLang('zh-TW')).toBe('zh')
    expect(normalizeSettingsLang('en-US')).toBe('en')
    expect(normalizeSettingsLang(undefined)).toBe('en')
    expect(modelSettingsStrings('zh-CN').title).toBe('模型设置')
    expect(modelSettingsStrings('en-US').title).toBe('Model Settings')
  })

  it('hides the chatoffice card when capabilities report chatoffice unavailable (web form)', async () => {
    await render({ capabilities: async () => ({ chatofficeAvailable: false }) })
    expect(document.body.querySelector('[data-vendor-row="chatoffice"]')).toBeNull()
    // landing stays the guide page — no chatoffice fallback pane anymore
    expect(document.body.querySelector('[data-model-guide-page]')).toBeTruthy()
    expect(document.body.querySelector('.msp-chatoffice-row')).toBeNull()
  })
})

describe('ModelSettingsPage local tools (本地与自建 一键安装)', () => {
  const baseStatus: LocalToolStatus = {
    vendorId: 'ollama',
    supported: true,
    installed: false,
    running: false,
    installable: true,
    startable: true,
  }

  async function renderLocal(over: {
    status: LocalToolStatus | ReturnType<typeof vi.fn>
    install?: ModelSettingsBridge['localToolInstall']
    start?: ModelSettingsBridge['localToolStart']
  }) {
    const statusFn =
      typeof over.status === 'function'
        ? (over.status as NonNullable<ModelSettingsBridge['localToolStatus']>)
        : (vi.fn(async () => over.status) as NonNullable<ModelSettingsBridge['localToolStatus']>)
    const b: ModelSettingsBridge = {
      ...bridge,
      localToolStatus: statusFn,
      ...(over.install ? { localToolInstall: over.install } : {}),
      ...(over.start ? { localToolStart: over.start } : {}),
    }
    await act(async () => {
      root!.render(createElement(ModelSettingsPage, { bridge: b, onClose: () => {} }))
    })
    await act(async () => {
      ;(document.body.querySelector('[data-vendor-row="ollama"]') as HTMLButtonElement).click()
    })
  }

  it('renders nothing when the bridge has no local-tool methods (web)', async () => {
    await render()
    const ollama = document.body.querySelector('[data-vendor-row="ollama"]') as HTMLButtonElement
    await act(async () => {
      ollama.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(document.body.querySelector('[data-local-tool]')).toBeNull()
  })

  it('missing binary → one-click install card', async () => {
    await renderLocal({ status: baseStatus, install: vi.fn(async () => ({ ok: true })) })
    expect(document.body.querySelector('[data-local-tool="ollama"]')).toBeTruthy()
    expect(document.body.querySelector('[data-local-tool-missing]')).toBeTruthy()
    const btn = document.body.querySelector('[data-local-tool-install]') as HTMLButtonElement
    expect(btn.textContent).toMatch(/一键安装|Install/)
  })

  it('install click runs the installer then re-probes to the running state', async () => {
    const status = vi
      .fn()
      .mockResolvedValueOnce(baseStatus)
      .mockResolvedValueOnce({ ...baseStatus, installed: true, running: true, version: '0.12.1' })
    const install = vi.fn(async () => ({ ok: true, message: '已通过 Homebrew 安装 Ollama' }))
    await renderLocal({ status, install })
    await act(async () => {
      ;(document.body.querySelector('[data-local-tool-install]') as HTMLButtonElement).click()
    })
    expect(install).toHaveBeenCalledWith('ollama', expect.any(Function))
    expect(document.body.querySelector('[data-local-tool-running]')?.textContent).toContain(
      '0.12.1',
    )
  })

  it('install failure persists the note (with manual-download fallback) inside the card', async () => {
    const status = vi.fn().mockResolvedValue(baseStatus)
    const install = vi.fn(async () => ({
      ok: false,
      message: '下载失败（可手动下载安装：https://ollama.com/download ，装完点「重新检测」）',
    }))
    await renderLocal({ status, install })
    await act(async () => {
      ;(document.body.querySelector('[data-local-tool-install]') as HTMLButtonElement).click()
    })
    const note = document.body.querySelector('[data-local-tool-note]')?.textContent ?? ''
    expect(note).toContain('ollama.com/download')
  })

  it('installed-but-stopped offers 启动服务; starting re-probes to running', async () => {
    const status = vi
      .fn()
      .mockResolvedValueOnce({ ...baseStatus, installed: true })
      .mockResolvedValueOnce({ ...baseStatus, installed: true, running: true })
    const start = vi.fn(async () => ({ ok: true, message: 'Ollama 服务已启动' }))
    await renderLocal({ status, start })
    expect(document.body.querySelector('[data-local-tool-installed]')).toBeTruthy()
    await act(async () => {
      ;(document.body.querySelector('[data-local-tool-start]') as HTMLButtonElement).click()
    })
    expect(start).toHaveBeenCalledWith('ollama')
    expect(document.body.querySelector('[data-local-tool-running]')).toBeTruthy()
  })
})

describe('ModelSettingsPage model checklist + save validation', () => {
  async function renderInteractive(discover: NonNullable<ModelSettingsBridge['discoverModels']>) {
    const saveSettings = vi.fn(async () => {})
    const b: ModelSettingsBridge = {
      getSettings: async () => defaultSettingsV2(),
      saveSettings,
      setCurrentModel: vi.fn(async () => {}),
      discoverModels: discover,
      chatofficeStatus: vi.fn(async () => ({ loggedIn: false })),
      chatofficeLogin: vi.fn(async () => {}),
    }
    await act(async () => {
      root!.render(createElement(ModelSettingsPage, { bridge: b, onClose: () => {} }))
    })
    // pick a catalog vendor with a model-list API
    const zhipu = document.body.querySelector('[data-vendor-row="zhipu"]') as HTMLButtonElement
    await act(async () => {
      zhipu.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    return saveSettings
  }

  const typeKey = (input: HTMLInputElement, value: string) =>
    act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, value)
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

  it('fetches unchecked by default; the user opts models in', async () => {
    await renderInteractive(async () => ({
      models: [{ id: 'glm-5.3' }, { id: 'glm-5.2' }],
    }))
    const fetchBtn = document.body.querySelector('[data-model-fetch]') as HTMLButtonElement
    await act(async () => {
      fetchBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    const boxes = [
      ...(document.body.querySelectorAll('[data-model-toggle]') as NodeListOf<HTMLInputElement>),
    ]
    expect(boxes.length).toBe(2)
    expect(boxes.every((b) => !b.checked)).toBe(true)
  })

  it('collapses and expands type groups', async () => {
    await renderInteractive(async () => ({
      models: [{ id: 'glm-5.3' }, { id: 'text-embedding-v3' }],
    }))
    await act(async () => {
      ;(document.body.querySelector('[data-model-fetch]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    expect(document.body.querySelectorAll('[data-model-toggle]').length).toBe(2)
    const collapse = document.body.querySelector(
      '[data-model-type-collapse="chat"]',
    ) as HTMLButtonElement
    await act(async () => {
      collapse.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(document.body.querySelectorAll('[data-model-toggle]').length).toBe(1)
    const expandBtn = document.body.querySelector(
      '[data-model-type-collapse="chat"]',
    ) as HTMLButtonElement
    await act(async () => {
      expandBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(document.body.querySelectorAll('[data-model-toggle]').length).toBe(2)
  })

  it('blocks saving when the protocol check fails; saves when it passes', async () => {
    // the list fetch succeeds first; only the save-time probe is made to fail
    // (wrong protocol / unreachable endpoint over the chosen protocol)
    let failProbe = false
    const saveSettings = await renderInteractive(async () => {
      if (failProbe) throw new Error('HTTP 404: unknown route')
      return { models: [{ id: 'glm-5.3' }] }
    })
    const keyInput = document.body.querySelector('[data-model-key]') as HTMLInputElement
    await typeKey(keyInput, 'sk-test')
    await act(async () => {
      ;(document.body.querySelector('[data-model-fetch]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    // opt one model in (fetch defaults to unchecked)
    const box = document.body.querySelector('[data-model-toggle="glm-5.3"]') as HTMLInputElement
    await act(async () => {
      box.click()
    })
    failProbe = true
    await act(async () => {
      ;(document.body.querySelector('[data-model-enable]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    expect(saveSettings).not.toHaveBeenCalled()
    expect(document.body.querySelector('[data-model-msg]')?.textContent).toContain('404')

    // probe passes now → save goes through
    failProbe = false
    await act(async () => {
      ;(document.body.querySelector('[data-model-enable]') as HTMLButtonElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      )
    })
    expect(saveSettings).toHaveBeenCalledTimes(1)
  })
})

describe('ModelDefaultsPage', () => {
  it('lists every default kind with the auto option and writes picks to modelDefaults', async () => {
    const saveSettings = vi.fn(async () => {})
    const b: ModelSettingsBridge = {
      getSettings: async () => ({
        version: 2,
        profiles: [
          {
            id: 'zhipu',
            vendorId: 'zhipu',
            displayName: 'Zhipu GLM',
            protocol: 'openai-completions',
            baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
            apiKey: '__keep__',
            auth: 'api-key',
            enabled: true,
            models: [
              { id: 'glm-5.3', type: 'chat' },
              { id: 'qwen-image', type: 'image-generation' },
              { id: 'cogtts', type: 'tts' },
            ],
          },
        ],
      }),
      saveSettings,
      setCurrentModel: vi.fn(async () => {}),
      discoverModels: vi.fn(async () => ({ models: [] })),
    }
    const { ModelDefaultsPage } = await import('../src/ModelDefaultsPage')
    await act(async () => {
      root!.render(createElement(ModelDefaultsPage, { bridge: b }))
    })
    const selects = [
      ...(host.querySelectorAll('select[data-default-kind]') as NodeListOf<HTMLSelectElement>),
    ]
    expect(selects.map((s) => s.dataset.defaultKind)).toEqual([
      'chat',
      'generation',
      'qc',
      'image',
      'videoGeneration',
      'tts',
      'asr',
    ])
    // adapted: f105f36 — the per-turn output cap is a number input, not a select
    expect(host.querySelector('input[data-default-kind="max-tokens"]')).not.toBeNull()
    // chat/generation/qc/image offer the zhipu models per kind type; video/asr stay empty (auto only)
    expect(selects[0]!.options.length).toBe(2) // auto + glm-5.3
    expect(selects[1]!.options.length).toBe(2) // auto + glm-5.3 (generation rides chat/vision)
    expect(selects[2]!.options.length).toBe(1) // auto only (qc rides vision)
    expect(selects[3]!.options.length).toBe(2) // auto + qwen-image
    expect(selects[4]!.options.length).toBe(1) // auto only
    expect(selects[5]!.options.length).toBe(2) // auto + cogtts
    expect(selects[6]!.options.length).toBe(1) // auto only

    // pick the tts default → saved into modelDefaults
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(selects[5]!, 'zhipu::cogtts')
      selects[5]!.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(saveSettings).toHaveBeenCalledTimes(1)
    const saved = saveSettings.mock.calls[0]![0] as { modelDefaults?: Record<string, unknown> }
    expect(saved.modelDefaults?.tts).toEqual({ profileId: 'zhipu', modelId: 'cogtts' })
  })
})

describe('no-default model settings (guidance, badges, free filter)', () => {
  async function renderWith(settings: AiSettingsV2): Promise<void> {
    const b: ModelSettingsBridge = {
      getSettings: async () => settings,
      saveSettings: vi.fn(async () => {}),
      setCurrentModel: vi.fn(async () => {}),
      discoverModels: vi.fn(async () => ({ models: [] })),
      chatofficeStatus: vi.fn(async () => ({ loggedIn: false })),
      chatofficeLogin: vi.fn(async () => {}),
    }
    await act(async () => {
      root!.render(createElement(ModelSettingsPage, { bridge: b, onClose: () => {} }))
    })
  }

  it('shows the guidance banner on vendor panes when nothing is enabled (guide page on landing)', async () => {
    await renderWith(defaultSettingsV2())
    // landing = guide page, which is guidance enough — no banner on top of it
    expect(document.body.querySelector('[data-model-guide-page]')).toBeTruthy()
    expect(document.body.querySelector('[data-model-guide]')).toBeNull()
    // selecting a vendor surfaces the banner above its form (no empty-group
    // placeholder in the directory — the group is gone entirely at 0 enabled)
    await act(async () => {
      ;(document.body.querySelector('[data-vendor-row="openai"]') as HTMLButtonElement).click()
    })
    expect(document.body.querySelector('[data-model-guide]')).toBeTruthy()
    expect(document.body.querySelector('[data-vendor-enabled-empty]')).toBeNull()
    expect(document.body.querySelector('[data-vendor-group="enabled"]')).toBeNull()
  })

  it('hides the guidance banner once a vendor is enabled', async () => {
    const s = defaultSettingsV2()
    s.profiles.push({
      id: 'openai',
      vendorId: 'openai',
      displayName: 'OpenAI',
      protocol: 'openai-completions',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk',
      auth: 'api-key',
      enabled: true,
      models: [{ id: 'gpt-5.6' }],
    })
    await renderWith(s)
    expect(document.body.querySelector('[data-model-guide]')).toBeNull()
    // with a vendor enabled, the 已启用 group (with count) appears again
    expect(document.body.querySelector('[data-vendor-group="enabled"]')).toBeTruthy()
    expect(document.body.querySelector('[data-vendor-row="openai"]')).toBeTruthy()
  })

  it('tags vendor rows with key/free badges from the catalog', async () => {
    await renderWith(defaultSettingsV2())
    const tagsOf = (id: string) =>
      [...document.body.querySelectorAll(`[data-vendor-tags="${id}"] .msp-tag`)].map(
        (el) => el.textContent,
      )
    // jsdom resolves the locale to en
    expect(tagsOf('zhipu')).toContain('Key needed')
    expect(tagsOf('zhipu')).toContain('Free tier')
    expect(tagsOf('openai')).toContain('Key needed')
    expect(tagsOf('openai')).not.toContain('Free tier')
    // chatoffice is hidden entirely while the login feature is off
    expect(document.body.querySelector('[data-vendor-row="chatoffice"]')).toBeNull()
    expect(tagsOf('ollama')).toContain('No key')
    expect(tagsOf('ollama')).toContain('Free')
  })

  it('filters the catalog through the compact dropdown (free / key / no-key / tier)', async () => {
    await renderWith(defaultSettingsV2())
    // entering hint is visible until interaction
    expect(document.body.querySelector('[data-model-filter-hint]')).toBeTruthy()
    expect(document.body.querySelector('[data-vendor-row="openai"]')).toBeTruthy()

    const openMenu = () =>
      act(async () => {
        ;(document.body.querySelector('[data-model-filter]') as HTMLButtonElement).click()
      })
    const pick = (id: string) =>
      act(async () => {
        ;(
          document.body.querySelector(`[data-model-filter-item="${id}"]`) as HTMLButtonElement
        ).click()
      })

    await openMenu()
    expect(document.body.querySelectorAll('[data-model-filter-item]').length).toBe(5)
    await pick('free')
    expect(document.body.querySelector('[data-vendor-row="openai"]')).toBeNull()
    expect(document.body.querySelector('[data-vendor-row="zhipu"]')).toBeTruthy()
    // chatoffice carries no free flag — filtered out with the rest
    expect(document.body.querySelector('[data-vendor-row="chatoffice"]')).toBeNull()
    // hint dismissed by interacting with the filter
    expect(document.body.querySelector('[data-model-filter-hint]')).toBeNull()

    await openMenu()
    await pick('needskey')
    expect(document.body.querySelector('[data-vendor-row="ollama"]')).toBeNull()
    expect(document.body.querySelector('[data-vendor-row="zhipu"]')).toBeTruthy()

    await openMenu()
    await pick('nokey')
    expect(document.body.querySelector('[data-vendor-row="ollama"]')).toBeTruthy()
    expect(document.body.querySelector('[data-vendor-row="zhipu"]')).toBeNull()

    await openMenu()
    await pick('all')
    expect(document.body.querySelector('[data-vendor-row="openai"]')).toBeTruthy()
  })
})
