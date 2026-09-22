import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * detached-windows.ts liveness guards: lookups must skip records whose
 * window was destroyed OR whose view webContents died, and the async
 * open-documents listing must re-check after its await.
 */

const instances: FakeWindow[] = []

class FakeWindow {
  destroyed = false
  title: string
  handlers = new Map<string, (...args: never[]) => void>()
  contentView = { addChildView: vi.fn(), removeChildView: vi.fn() }

  constructor(opts: { title?: string }) {
    this.title = opts.title ?? ''
    instances.push(this)
  }

  on = (event: string, fn: (...args: never[]) => void): void => {
    this.handlers.set(event, fn)
  }

  isDestroyed = (): boolean => this.destroyed
  isMinimized = (): boolean => false
  restore = vi.fn()
  show = vi.fn()
  focus = vi.fn()
  getContentBounds = (): { width: number; height: number } => ({ width: 100, height: 100 })
  setTitle = (title: string): void => {
    this.title = title
  }

  getTitle = (): string => {
    if (this.destroyed) throw new Error('window destroyed')
    return this.title
  }

  isFocused = (): boolean => false
  destroy = (): void => {
    this.destroyed = true
  }
}

vi.mock('electron', () => ({
  BrowserWindow: FakeWindow,
}))

vi.mock('../../docs/src/main/docs-main', () => ({
  docsQueryDirty: vi.fn(() => Promise.resolve(false)),
  requestDocsClose: vi.fn(),
  setActiveDocsResolver: vi.fn(),
  teardownDocsRenderer: vi.fn(),
}))

vi.mock('../../sheets/src/main/sheets-main', () => ({
  requestSheetsClose: vi.fn(),
  setActiveSheetsWebContents: vi.fn(),
  sheetsPendingEditCount: vi.fn(() => 0),
}))

vi.mock('../src/main/tab-manager', () => ({
  canonicalPath: (p: string) => p.toLowerCase(),
}))

type DetachedModule = typeof import('../src/main/detached-windows')

let detached: DetachedModule

function fakeView(id: number, dead: { current: boolean }) {
  return {
    webContents: {
      id,
      isDestroyed: () => dead.current,
      focus: vi.fn(),
      close: vi.fn(),
    },
    setBounds: vi.fn(),
    setVisible: vi.fn(),
  }
}

beforeEach(async () => {
  vi.resetModules()
  instances.length = 0
  detached = await import('../src/main/detached-windows')
})

describe('detached window liveness guards', () => {
  it('lookups skip records with dead view contents', () => {
    const dead = { current: false }
    detached.createDetachedEditorWindow({
      view: fakeView(11, dead) as never,
      kind: 'docs',
      title: 'a.txt',
      filePath: 'C:/docs/a.txt',
      applyMenuFor: () => {},
    })
    dead.current = true

    expect(detached.isDetachedTabId('detached:11')).toBe(false)
    expect(detached.activateDetached('detached:11')).toBe(false)
    expect(detached.detachedWebContentsFor('detached:11')).toBeUndefined()
    expect(detached.closeDetachedWithoutPrompt('detached:11')).toBe(false)
    expect(detached.findDetachedTabByPath('c:/docs/a.txt')).toBeUndefined()
    expect(detached.focusDetachedByPath('c:/docs/a.txt')).toBe(false)
    expect(detached.detachedRenameFile('c:/docs/a.txt', 'c:/docs/b.txt')).toBeUndefined()
    expect(detached.detachedFilePaths()).toEqual([])
    expect(detached.focusedDetachedKind()).toBeUndefined()
  })

  it('live records keep answering while dead ones are skipped', async () => {
    const deadDocs = { current: false }
    const liveSheets = { current: false }
    detached.createDetachedEditorWindow({
      view: fakeView(21, deadDocs) as never,
      kind: 'docs',
      title: 'a',
      filePath: 'C:/docs/a.txt',
      applyMenuFor: () => {},
    })
    detached.createDetachedEditorWindow({
      view: fakeView(22, liveSheets) as never,
      kind: 'sheets',
      title: 'b',
      filePath: 'C:/docs/b.txt',
      applyMenuFor: () => {},
    })
    deadDocs.current = true

    expect(detached.findDetachedTabByPath('c:/docs/b.txt')?.id).toBe('detached:22')
    expect(detached.detachedFilePaths()).toEqual(['C:/docs/b.txt'])
    const docs = await detached.detachedOpenDocuments()
    expect(docs.map((d) => d.id)).toEqual(['detached:22'])
  })

  it('open-documents listing skips windows destroyed during the async dirty check', async () => {
    const live = { current: false }
    detached.createDetachedEditorWindow({
      view: fakeView(31, live) as never,
      kind: 'docs',
      title: 'c',
      filePath: 'C:/docs/c.txt',
      applyMenuFor: () => {},
    })
    const win = instances[0]!
    const { docsQueryDirty } = await import('../../docs/src/main/docs-main')
    vi.mocked(docsQueryDirty).mockImplementationOnce(async () => {
      win.destroyed = true
      return false
    })
    await expect(detached.detachedOpenDocuments()).resolves.toEqual([])
  })
})
