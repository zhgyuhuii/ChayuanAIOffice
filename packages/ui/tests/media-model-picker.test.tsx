// @vitest-environment jsdom
/**
 * MediaModelPicker tests (the insert-media dialog's model control): the chat
 * ModelPickerButton presentation on the dialog's MediaModelOption data —
 * vendor groups collapse/expand, kind chips (生图/视频生成) filter, picking
 * reports the model, 模型设置… opens settings, and the empty list surfaces
 * the emptyText on trigger and body.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { VENDOR_BY_ID } from '@chatoffice/ai-provider'
import { MediaModelPicker, type MediaModelPickerProps } from '../src/MediaModelPicker'
import type { MediaModelOption } from '../src/InsertImageDialog'

const model = (kind: 'image' | 'video', vendorId: string, modelId: string): MediaModelOption => ({
  kind,
  profileId: `prof-${vendorId}`,
  modelId,
  label: modelId,
  vendorId,
  spec: { fields: [] },
})

const models: MediaModelOption[] = [
  model('image', 'openai', 'gpt-image-2'),
  model('image', 'zhipu', 'cogview-5'),
  model('video', 'kling', 'kling-v3'),
]

/** zh display name the picker resolves from the vendor catalog */
const vendorName = (id: string): string =>
  VENDOR_BY_ID.get(id)?.nameZh ?? VENDOR_BY_ID.get(id)?.name ?? id

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

async function renderPicker(
  overrides: Partial<MediaModelPickerProps> & { models?: MediaModelOption[] } = {},
): Promise<void> {
  const { models: list = models, ...rest } = overrides
  await act(async () => {
    root!.render(
      createElement(MediaModelPicker, {
        models: list,
        selected: null,
        onPick,
        onOpenSettings,
        lang: 'zh',
        ...rest,
      }),
    )
  })
}

const trigger = (): HTMLButtonElement =>
  host.querySelector('.ai-model-picker-trigger') as HTMLButtonElement
const items = (): HTMLElement[] => [...host.querySelectorAll('.ai-picker-item')]
const buttonByText = (text: string): HTMLButtonElement | undefined =>
  [...host.querySelectorAll('button')].find((b) => b.textContent === text)

describe('MediaModelPicker', () => {
  it('groups models by vendor with collapsible headers', async () => {
    await renderPicker()
    await act(async () => {
      trigger().click()
    })
    const groups = [...host.querySelectorAll('.ai-picker-vgroup')]
    expect(groups).toHaveLength(3)
    expect(groups.map((g) => g.querySelector('.ai-picker-group-name')?.textContent)).toContain(
      vendorName('zhipu'),
    )
    expect(items()).toHaveLength(3)

    // collapsing the zhipu group hides only its row
    const zhipu = groups.find((g) =>
      g.querySelector('.ai-picker-group-name')?.textContent?.includes(vendorName('zhipu')),
    )!
    await act(async () => {
      zhipu.querySelector('.ai-picker-group')!.click()
    })
    expect(items()).toHaveLength(2)
    await act(async () => {
      zhipu.querySelector('.ai-picker-group')!.click()
    })
    expect(items()).toHaveLength(3)
  })

  it('kind chips appear when both kinds exist and filter the rows', async () => {
    await renderPicker()
    await act(async () => {
      trigger().click()
    })
    const videoChip = buttonByText('视频生成')!
    expect(videoChip).toBeTruthy()
    await act(async () => {
      videoChip.click()
    })
    expect(items()).toHaveLength(1)
    expect(items()[0]!.textContent).toContain('kling-v3')
    // back to 全部 restores every row
    await act(async () => {
      buttonByText('全部')!.click()
    })
    expect(items()).toHaveLength(3)
  })

  it('picking a row reports the model and closes the popover', async () => {
    await renderPicker()
    await act(async () => {
      trigger().click()
    })
    await act(async () => {
      host.querySelector('[data-picker-model="prof-zhipu::cogview-5"]')!.click()
    })
    expect(onPick).toHaveBeenCalledWith(models[1])
    expect(host.querySelector('.ai-picker-pop')).toBeNull()
  })

  it('marks the selected row and shows its label on the trigger', async () => {
    await renderPicker({ selected: { profileId: 'prof-kling', modelId: 'kling-v3' } })
    expect(trigger().textContent).toContain('kling-v3')
    await act(async () => {
      trigger().click()
    })
    const selected = host.querySelectorAll('.ai-picker-item.is-selected')
    expect(selected).toHaveLength(1)
    expect(selected[0]!.textContent).toContain('kling-v3')
  })

  it('offers the 模型设置… entry and drops chips when only one kind exists', async () => {
    await renderPicker({ models: [model('image', 'openai', 'gpt-image-2')] })
    await act(async () => {
      trigger().click()
    })
    expect(buttonByText('模型设置…')).toBeTruthy()
    expect(buttonByText('视频生成')).toBeUndefined()
    await act(async () => {
      buttonByText('模型设置…')!.click()
    })
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
    expect(host.querySelector('.ai-picker-pop')).toBeNull()
  })

  it('surfaces emptyText on the trigger and in the list body when nothing is enabled', async () => {
    await renderPicker({ models: [], emptyText: '未配置生图模型：请在模型设置中启用' })
    expect(trigger().textContent).toContain('未配置生图模型')
    await act(async () => {
      trigger().click()
    })
    expect(host.querySelector('.ai-picker-empty')?.textContent).toContain('未配置生图模型')
  })
})
