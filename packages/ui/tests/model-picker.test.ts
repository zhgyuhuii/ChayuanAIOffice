// @vitest-environment jsdom
/**
 * ModelPickerButton tests: kind filter chips, vendor-group collapse, and
 * picking a non-chat model through the popover.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ModelPickerButton } from '../src/ModelPickerButton'
import type { AiSettingsV2 } from '@chatoffice/ai-provider'

const settings: AiSettingsV2 = {
  version: 2,
  profiles: [
    {
      id: 'zhipu',
      vendorId: 'zhipu',
      displayName: '智谱开放平台',
      protocol: 'openai-completions',
      baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
      apiKey: '__keep__',
      auth: 'api-key',
      enabled: true,
      models: [
        { id: 'glm-5.3', type: 'chat' },
        { id: 'qwen-image', type: 'image-generation' },
      ],
    },
    {
      id: 'openai',
      vendorId: 'openai',
      displayName: 'OpenAI',
      protocol: 'openai-responses',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '__keep__',
      auth: 'api-key',
      enabled: true,
      models: [{ id: 'gpt-5.6-sol', type: 'chat' }],
    },
  ],
  currentModel: { profileId: 'zhipu', modelId: 'glm-5.3' },
}

let host: HTMLDivElement
let root: Root | null = null
const onPick = vi.fn()
const onOpenSettings = vi.fn()

beforeEach(() => {
  document.body.innerHTML = ''
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  onPick.mockClear()
  onOpenSettings.mockClear()
})

async function render(): Promise<void> {
  await act(async () => {
    root!.render(
      createElement(ModelPickerButton, { settings, onPick, onOpenSettings }),
    )
  })
}

async function open(): Promise<void> {
  await act(async () => {
    ;(host.querySelector('.ai-model-picker-trigger') as HTMLButtonElement).click()
  })
}

describe('ModelPickerButton', () => {
  it('shows kind filter chips only for present kinds and filters the list', async () => {
    await render()
    await open()
    const chips = [...host.querySelectorAll('[data-picker-kind]')].map((c) => (c as HTMLElement).dataset.pickerKind)
    // 全部 + 对话 + 生图（无视频/语音模型则不出对应标签）
    expect(chips).toEqual(['all', 'chat', 'image-generation'])

    await act(async () => {
      ;(host.querySelector('[data-picker-kind="image-generation"]') as HTMLButtonElement).click()
    })
    const models = [...host.querySelectorAll('[data-picker-model]')].map(
      (m) => (m as HTMLElement).dataset.pickerModel,
    )
    expect(models).toEqual(['zhipu::qwen-image'])
  })

  it('groups by vendor and collapses/expands a group', async () => {
    await render()
    await open()
    expect(host.querySelectorAll('[data-picker-model]').length).toBe(3)
    await act(async () => {
      ;(host.querySelector('[data-picker-group="openai"] .ai-picker-group') as HTMLButtonElement).click()
    })
    expect(host.querySelectorAll('[data-picker-model]').length).toBe(2)
    await act(async () => {
      ;(host.querySelector('[data-picker-group="openai"] .ai-picker-group') as HTMLButtonElement).click()
    })
    expect(host.querySelectorAll('[data-picker-model]').length).toBe(3)
  })

  it('picks a non-chat model (image) through the popover', async () => {
    await render()
    await open()
    await act(async () => {
      ;(host.querySelector('[data-picker-model="zhipu::qwen-image"]') as HTMLButtonElement).click()
    })
    expect(onPick).toHaveBeenCalledWith({ profileId: 'zhipu', modelId: 'qwen-image' })
  })

  it('opens the settings window from the pinned entry', async () => {
    await render()
    await open()
    await act(async () => {
      ;(host.querySelector('.ai-picker-settings') as HTMLButtonElement).click()
    })
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })
})
