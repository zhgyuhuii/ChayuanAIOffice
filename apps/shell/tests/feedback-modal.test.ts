/**
 * @vitest-environment jsdom
 * 反馈对话框测试：类型切换、空内容拦截、提交流（经主进程 IPC 桩）、
 * 离线草稿、运行日志附件打包上传。
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HomeApi, FeedbackSubmitPayload, FeedbackSubmitResult } from '../src/shared/home-api'
import { LocaleProvider } from '../src/renderer/src/locale'
import { FeedbackModal } from '../src/renderer/src/FeedbackModal'

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root
let feedbackSubmit: ReturnType<typeof vi.fn>
let feedbackUpload: ReturnType<typeof vi.fn>
let getMcpLogs: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  feedbackSubmit = vi.fn(async (payload: FeedbackSubmitPayload): Promise<FeedbackSubmitResult> => ({
    ok: true,
    id: 'fb-1',
    status: 'new',
  }))
  feedbackUpload = vi.fn(async (name: string, _mime: string, data: Uint8Array) => ({
    ok: true,
    name,
    url: `/feedback-uploads/up-1/${name}`,
    kind: name.endsWith('.png') ? ('image' as const) : ('file' as const),
    size: data.byteLength,
  }))
  getMcpLogs = vi.fn(async () => [] as string[])
  window.chatOffice = {
    getAppVersion: async () => '0.10.0',
    getMcpLogs,
    feedbackProbe: async () => true,
    feedbackUpload,
    feedbackSubmit,
  } as unknown as HomeApi
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

const q = <T extends HTMLElement>(sel: string) => host.querySelector<T>(sel)!

async function renderModal(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        LocaleProvider,
        { initial: 'en' },
        createElement(FeedbackModal, { onClose: vi.fn() }),
      ),
    )
  })
}

async function typeText(value: string): Promise<void> {
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!
    const ta = q<HTMLTextAreaElement>('[data-feedback-textarea]')
    set.call(ta, value)
    ta.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function click(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.click()
    await Promise.resolve()
  })
}

describe('FeedbackModal', () => {
  it('渲染标题/类型组/输入区，默认选中错误报告', async () => {
    await renderModal()
    expect(q('[data-feedback-dialog]')).toBeTruthy()
    expect(host.querySelectorAll('[data-feedback-type]')).toHaveLength(3)
    expect(q('[data-feedback-type="bug"]').getAttribute('aria-checked')).toBe('true')
  })

  it('空内容点发送→提示必填，不发起提交', async () => {
    await renderModal()
    await click(q('[data-feedback-send]'))
    expect(q('[data-feedback-notice="hint"]')).toBeTruthy()
    expect(feedbackSubmit).not.toHaveBeenCalled()
  })

  it('选类型+输入内容→经 IPC 提交（mid/logJson 齐全），成功提示', async () => {
    await renderModal()
    await click(q('[data-feedback-type="suggestion"]'))
    await typeText('希望支持深色模式')
    await click(q('[data-feedback-send]'))
    expect(feedbackSubmit).toHaveBeenCalledTimes(1)
    const payload = feedbackSubmit.mock.calls[0][0] as FeedbackSubmitPayload
    expect(payload.type).toBe('suggestion')
    expect(payload.content).toBe('希望支持深色模式')
    expect(payload.mid).toMatch(/^[0-9a-f]{16}$/)
    expect(payload.appVersion).toBe('0.10.0')
    expect(typeof payload.logJson).toBe('string')
    expect(q('[data-feedback-notice="success"]')).toBeTruthy()
  })

  it('离线结果→草稿提示 + 本地草稿保存', async () => {
    feedbackSubmit.mockImplementation(async () => ({ ok: false, offline: true, error: 'network' }))
    await renderModal()
    await typeText('断网也要能反馈')
    await click(q('[data-feedback-send]'))
    expect(q('[data-feedback-notice="draft"]')).toBeTruthy()
    const drafts = JSON.parse(localStorage.getItem('co_feedback_drafts')!)
    expect(drafts).toHaveLength(1)
    expect(drafts[0].content).toBe('断网也要能反馈')
  })

  it('无运行日志→提示暂无日志，不上传', async () => {
    await renderModal()
    await click(q('[data-feedback-attach-log]'))
    expect(q('[data-feedback-notice="hint"]')).toBeTruthy()
    expect(feedbackUpload).not.toHaveBeenCalled()
  })

  it('有运行日志→打包 txt 上传并出现在附件区', async () => {
    getMcpLogs.mockResolvedValue(['[mcp] listening on 62566', '[mcp] tool ok'])
    await renderModal()
    await click(q('[data-feedback-attach-log]'))
    expect(feedbackUpload).toHaveBeenCalledTimes(1)
    const [name, mime] = feedbackUpload.mock.calls[0] as [string, string, Uint8Array]
    expect(name).toMatch(/^aioffice-log-\d{8}-\d{4}\.txt$/)
    expect(mime).toBe('text/plain')
    expect(host.querySelectorAll('[data-feedback-attachment]')).toHaveLength(1)
  })
})
