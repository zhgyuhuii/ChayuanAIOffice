// @vitest-environment jsdom
// DesktopRibbon (C1): the schema-driven desktop renderer must reproduce the
// legacy ribbon's exact chrome and control class strings, run commands through
// the registry with the right gates, and implement the Word-style contextual
// tab state machine (auto-activate on context rise, revert to the last regular
// tab on context loss).
import { describe, expect, it, vi } from 'vitest'
import { act, createElement as h, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createCommandRegistry, type AnyCommandDefinition } from '../src/command/registry'
import { commandId } from '../src/command/id'
import type { RibbonSchema } from '../src/schema/types'
import { DesktopRibbon, type DesktopRibbonProps } from '../src/desktop/DesktopRibbon'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

interface S {
  canEdit: boolean
  hasDoc: boolean
  selectionKind: 'text' | 'table' | 'image'
  bold: boolean
}
interface Svcs {
  log: (entry: string) => void
}

const BASE_STATE: S = { canEdit: true, hasDoc: true, selectionKind: 'text', bold: false }

function makeRegistry(log: (entry: string) => void) {
  const defs: AnyCommandDefinition<S, Svcs>[] = [
    {
      id: commandId('docs.format.toggleBold'),
      isEnabled: ({ state }) => state.canEdit,
      isActive: ({ state }) => state.bold,
      run: () => log('bold'),
    },
    {
      id: commandId('docs.edit.paste'),
      isEnabled: ({ state }) => state.canEdit,
      run: () => log('paste'),
    },
    {
      id: commandId('docs.edit.pasteText'),
      isEnabled: ({ state }) => state.canEdit,
      run: (_ctx, args) => log(`pasteText:${String(args)}`),
    },
    {
      id: commandId('docs.file.open'),
      run: () => log('open'),
    },
    {
      id: commandId('docs.file.save'),
      isEnabled: ({ state }) => state.hasDoc,
      run: () => log('save'),
    },
    {
      id: commandId('docs.format.align'),
      isEnabled: ({ state }) => state.canEdit,
      run: (_ctx, args) => log(`align:${String(args)}`),
    },
    {
      id: commandId('docs.format.fontColor'),
      isEnabled: ({ state }) => state.canEdit,
      getVisualState: () => ({ value: '#C00000' }),
      run: () => log('fontColor'),
    },
    {
      id: commandId('docs.view.showMarks'),
      isEnabled: ({ state }) => state.hasDoc,
      isActive: () => false,
      isVisible: ({ state }) => state.hasDoc,
      run: () => log('marks'),
    },
  ]
  return createCommandRegistry<S, Svcs>(defs)
}

function makeSchema(): RibbonSchema<S, Svcs> {
  return {
    id: 'docs',
    version: 1,
    tabs: [
      {
        id: 'file',
        labelKey: 'tab.file',
        kind: 'file',
        menu: [
          {
            id: 'open',
            labelKey: 'file.open',
            command: commandId('docs.file.open'),
            shortcut: 'Ctrl+O',
          },
          {
            id: 'save',
            labelKey: 'file.save',
            command: commandId('docs.file.save'),
            shortcut: 'Ctrl+S',
          },
        ],
        groups: [],
      },
      {
        id: 'home',
        labelKey: 'tab.home',
        kind: 'regular',
        groups: [
          {
            id: 'clipboard',
            labelKey: 'group.clipboard',
            controls: [
              {
                id: 'paste',
                kind: 'button',
                command: commandId('docs.edit.paste'),
                icon: 'paste',
                size: 'big',
                labelKey: 'paste',
              },
              {
                id: 'clipboardOps',
                kind: 'column',
                controls: [
                  {
                    id: 'cutPlaceholder',
                    kind: 'button',
                    size: 'small',
                    icon: 'cut',
                    labelKey: 'cut',
                    disabled: true,
                    tipKey: 'tip.cut',
                  },
                  {
                    id: 'boldBtn',
                    kind: 'button',
                    command: commandId('docs.format.toggleBold'),
                    size: 'small',
                    icon: 'bold',
                    labelKey: 'bold',
                    tipKey: 'tip.bold',
                  },
                ],
              },
            ],
          },
          {
            id: 'font',
            labelKey: 'group.font',
            className: 'rb-font-group',
            controls: [
              {
                id: 'fontRow1',
                kind: 'row',
                controls: [
                  {
                    id: 'fontColor',
                    kind: 'split',
                    command: commandId('docs.format.fontColor'),
                    icon: 'fontColor',
                    labelKey: 'fontColor',
                    variant: 'color',
                    tipKey: 'tip.fontColor',
                    menu: [
                      {
                        id: 'auto',
                        labelKey: 'color.auto',
                        command: commandId('docs.format.fontColor'),
                        args: null,
                      },
                      { id: 'sep1', kind: 'separator' },
                      {
                        id: 'red',
                        labelKey: 'color.red',
                        command: commandId('docs.format.fontColor'),
                        args: 'FF0000',
                      },
                    ],
                  },
                  {
                    id: 'changeCase',
                    kind: 'dropdown',
                    icon: 'case',
                    labelKey: 'changeCase',
                    inlineCaret: true,
                    activeWhenOpen: true,
                    disabledWhen: { notEq: ['canEdit', true] },
                    menuClassName: 'case-menu',
                    menu: [
                      {
                        id: 'upper',
                        labelKey: 'case.upper',
                        command: commandId('docs.format.align'),
                        args: 'upper',
                      },
                    ],
                  },
                  { id: 'sep', kind: 'separator' },
                  {
                    id: 'sortPlaceholder',
                    kind: 'button',
                    size: 'icon',
                    icon: 'sort',
                    labelKey: 'sort',
                    disabled: true,
                  },
                ],
              },
              {
                id: 'fontRow2',
                kind: 'row',
                controls: [
                  {
                    id: 'marks',
                    kind: 'button',
                    command: commandId('docs.view.showMarks'),
                    size: 'icon',
                    icon: 'marks',
                    labelKey: 'marks',
                    tipKey: 'tip.marks',
                  },
                  {
                    id: 'alignLeft',
                    kind: 'button',
                    command: commandId('docs.format.align'),
                    args: 'left',
                    size: 'icon',
                    icon: 'alignLeft',
                    labelKey: 'alignLeft',
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        id: 'insert',
        labelKey: 'tab.insert',
        kind: 'regular',
        groups: [
          {
            id: 'pages',
            labelKey: 'group.pages',
            controls: [
              {
                id: 'bespoke',
                kind: 'custom',
                render: ({ state, services, t, dropdown }) =>
                  h(
                    'button',
                    {
                      className: 'rb-icon',
                      'data-custom': String(state.canEdit),
                      onClick: () => {
                        services.log(`custom:${t('custom.label')}`)
                        dropdown.toggle('bespoke')
                      },
                    },
                    'custom',
                  ),
              },
            ],
          },
        ],
      },
      {
        id: 'tableDesign',
        labelKey: 'tab.tableDesign',
        kind: 'contextual',
        contextWhen: { eq: ['selectionKind', 'table'] },
        contextGroup: { id: 'table', labelKey: 'group.table', activateTab: 'tableLayout' },
        groups: [{ id: 'td', labelKey: 'group.td', controls: [] }],
      },
      {
        id: 'tableLayout',
        labelKey: 'tab.tableLayout',
        kind: 'contextual',
        contextWhen: { eq: ['selectionKind', 'table'] },
        contextGroup: { id: 'table', labelKey: 'group.table', activateTab: 'tableLayout' },
        groups: [{ id: 'tl', labelKey: 'group.tl', controls: [] }],
      },
      {
        id: 'pictureFormat',
        labelKey: 'tab.pictureFormat',
        kind: 'contextual',
        contextWhen: { eq: ['selectionKind', 'image'] },
        groups: [{ id: 'pf', labelKey: 'group.pf', controls: [] }],
      },
    ],
  }
}

const t = (key: string) => key
const ICONS = { paste: h('i', { className: 'ic-paste' }), bold: h('i', { className: 'ic-bold' }) }

interface Harness {
  host: HTMLDivElement
  root: Root
  log: ReturnType<typeof vi.fn>
  render: (state?: Partial<S>, props?: Partial<DesktopRibbonProps<S, Svcs>>) => Promise<void>
  unmount: () => Promise<void>
}

async function mount(
  state: Partial<S> = {},
  props: Partial<DesktopRibbonProps<S, Svcs>> = {},
): Promise<Harness> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const log = vi.fn()
  const registry = makeRegistry((entry) => log(entry))
  const services: Svcs = { log: (entry) => log(entry) }
  const root = createRoot(host)
  let currentState: S = { ...BASE_STATE, ...state }
  const render = async (
    next: Partial<S> = {},
    nextProps: Partial<DesktopRibbonProps<S, Svcs>> = {},
  ) => {
    currentState = { ...currentState, ...next }
    const merged: DesktopRibbonProps<S, Svcs> = {
      schema: makeSchema(),
      registry,
      state: currentState,
      services,
      t,
      icons: ICONS,
      ...props,
      ...nextProps,
    }
    await act(async () => {
      root.render(h(DesktopRibbon, merged) as ReactElement)
    })
  }
  await act(async () => {
    root.render(
      h(DesktopRibbon, {
        schema: makeSchema(),
        registry,
        state: currentState,
        services,
        t,
        icons: ICONS,
        ...props,
      }) as ReactElement,
    )
  })
  return {
    host,
    root,
    log,
    render,
    unmount: async () => {
      await act(async () => root.unmount())
      host.remove()
    },
  }
}

const click = async (el: Element | null | undefined) => {
  expect(el, 'expected element to exist').toBeTruthy()
  await act(async () => {
    el!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
}

const tabs = (host: HTMLElement) => [...host.querySelectorAll<HTMLButtonElement>('.ribbon-tab')]
const tabByText = (host: HTMLElement, label: string) =>
  tabs(host).find((tab) => tab.textContent === label)
const activeTabLabel = (host: HTMLElement) =>
  host.querySelector('.ribbon-tab.active')?.textContent ?? null

describe('DesktopRibbon chrome', () => {
  it('emits the legacy root/strip/body classes with the win variant by default', async () => {
    const { host, unmount } = await mount()
    expect(host.querySelector('.ribbon')).toBeTruthy()
    expect(host.querySelector('.ribbon-tabs')!.className).toBe('ribbon-tabs ribbon-tabs-win')
    expect(host.querySelector('.ribbon-tabs-spacer')).toBeTruthy()
    expect(host.querySelector('.ribbon-body')).toBeTruthy()
    expect(host.querySelector('.file-tab-wrap')).toBeTruthy()
    await unmount()
  })

  it('uses the mac variant and drops the file tab on mac', async () => {
    const { host, unmount } = await mount({}, { platform: 'mac' })
    expect(host.querySelector('.ribbon-tabs')!.className).toBe('ribbon-tabs ribbon-tabs-mac')
    expect(host.querySelector('.file-tab-wrap')).toBeNull()
    await unmount()
  })

  it('drops the platform class entirely in tab mode', async () => {
    const { host, unmount } = await mount({}, { inTab: true })
    expect(host.querySelector('.ribbon-tabs')!.className).toBe('ribbon-tabs ')
    await unmount()
  })

  it('renders quickActions and trailingActions slots around the tabs', async () => {
    const { host, unmount } = await mount(
      {},
      {
        quickActions: h('span', { className: 'qa-slot' }),
        trailingActions: h('span', { className: 'ta-slot' }),
      },
    )
    expect(host.querySelector('.qa-slot')).toBeTruthy()
    expect(host.querySelector('.ta-slot')).toBeTruthy()
    await unmount()
  })
})

describe('tab switching', () => {
  it('starts on the first regular tab and switches on click', async () => {
    const { host, log, unmount } = await mount()
    expect(activeTabLabel(host)).toBe('tab.home')
    expect(tabByText(host, 'tab.home')!.className).toBe('ribbon-tab active')
    expect(tabByText(host, 'tab.insert')!.className).toBe('ribbon-tab ')
    await click(tabByText(host, 'tab.insert'))
    expect(activeTabLabel(host)).toBe('tab.insert')
    await unmount()
    void log
  })

  it('supports controlled activeTab + onTabChange', async () => {
    const onTabChange = vi.fn()
    const { host, unmount } = await mount({}, { activeTab: 'insert', onTabChange })
    expect(activeTabLabel(host)).toBe('tab.insert')
    await click(tabByText(host, 'tab.home'))
    expect(onTabChange).toHaveBeenCalledWith('home')
    // controlled: the prop still wins until the host updates it
    expect(activeTabLabel(host)).toBe('tab.insert')
    await unmount()
  })

  it('honors defaultTab in uncontrolled mode', async () => {
    const { host, unmount } = await mount({}, { defaultTab: 'insert' })
    expect(activeTabLabel(host)).toBe('tab.insert')
    await unmount()
  })
})

describe('contextual tab state machine', () => {
  it('auto-activates the group activateTab when the context appears', async () => {
    const { host, render, unmount } = await mount()
    expect(tabByText(host, 'tab.tableDesign')).toBeUndefined()
    await render({ selectionKind: 'table' })
    expect(tabByText(host, 'tab.tableDesign')).toBeTruthy()
    expect(tabByText(host, 'tab.tableLayout')).toBeTruthy()
    expect(activeTabLabel(host)).toBe('tab.tableLayout')
    await unmount()
  })

  it('reverts to the last regular tab when the context disappears', async () => {
    const { host, render, unmount } = await mount()
    await click(tabByText(host, 'tab.insert'))
    await render({ selectionKind: 'table' })
    expect(activeTabLabel(host)).toBe('tab.tableLayout')
    await render({ selectionKind: 'text' })
    expect(activeTabLabel(host)).toBe('tab.insert')
    expect(tabByText(host, 'tab.tableLayout')).toBeUndefined()
    await unmount()
  })

  it('keeps the current regular tab when a context it is not in disappears', async () => {
    const { host, render, unmount } = await mount()
    await render({ selectionKind: 'table' })
    expect(activeTabLabel(host)).toBe('tab.tableLayout')
    // user clicks back to home while still in the table
    await click(tabByText(host, 'tab.home'))
    expect(activeTabLabel(host)).toBe('tab.home')
    // context disappears while home is active: no yank (already regular)
    await render({ selectionKind: 'text' })
    expect(activeTabLabel(host)).toBe('tab.home')
    await unmount()
  })

  it('activates a solo contextual tab on rise (picture format)', async () => {
    const { host, render, unmount } = await mount()
    await render({ selectionKind: 'image' })
    expect(activeTabLabel(host)).toBe('tab.pictureFormat')
    await render({ selectionKind: 'text' })
    expect(activeTabLabel(host)).toBe('tab.home')
    await unmount()
  })
})

describe('command gates', () => {
  it('disables a command button when the command isEnabled fails', async () => {
    const { host, unmount } = await mount({ canEdit: false })
    const bold =
      host.querySelector('#boldBtn, [data-tip="tip.bold"]') ??
      [...host.querySelectorAll('button')].find((b) => b.getAttribute('data-tip') === 'tip.bold')
    expect((bold as HTMLButtonElement).disabled).toBe(true)
    await unmount()
  })

  it('ANDs the renderer disabledWhen prop with command gates', async () => {
    // showMarks' own command gate passes (hasDoc); the global gate decides here
    const on = await mount({}, { disabledWhen: { notEq: ['canEdit', true] } })
    const marksOn = [...on.host.querySelectorAll('button')].find(
      (b) => b.getAttribute('data-tip') === 'tip.marks',
    )
    expect((marksOn as HTMLButtonElement).disabled).toBe(false)
    await on.unmount()

    const off = await mount({ canEdit: false }, { disabledWhen: { notEq: ['canEdit', true] } })
    const marksOff = [...off.host.querySelectorAll('button')].find(
      (b) => b.getAttribute('data-tip') === 'tip.marks',
    )
    expect((marksOff as HTMLButtonElement).disabled).toBe(true)
    await off.unmount()
  })

  it('hides controls whose command isVisible fails', async () => {
    const { host, unmount } = await mount({ hasDoc: false })
    const marks = [...host.querySelectorAll('button')].find(
      (b) => b.getAttribute('data-tip') === 'tip.marks',
    )
    expect(marks).toBeUndefined()
    await unmount()
  })

  it('executes commands with static args on click', async () => {
    const { host, log, unmount } = await mount()
    const align = [...host.querySelectorAll('button')].find(
      (b) => b.querySelector('.ic-alignLeft') || b.textContent === 'alignLeft',
    )
    await click(align)
    expect(log).toHaveBeenCalledWith('align:left')
    await unmount()
  })

  it('renders static-disabled placeholder buttons without a command', async () => {
    const { host, unmount } = await mount()
    const sort = [...host.querySelectorAll('button')].find((b) => b.textContent === 'sort')
    expect((sort as HTMLButtonElement).disabled).toBe(true)
    await unmount()
  })
})

describe('split control', () => {
  const splitOf = (host: HTMLElement) => {
    const wraps = [...host.querySelectorAll('.rb-split-wrap')]
    const wrap = wraps.find((w) => w.querySelector('.rb-color-btn'))
    expect(wrap, 'color split wrap').toBeTruthy()
    return wrap!
  }

  it('runs the command from the main button without opening the panel', async () => {
    const { host, log, unmount } = await mount()
    const wrap = splitOf(host)
    await click(wrap.querySelector('.rb-color-btn'))
    expect(log).toHaveBeenCalledWith('fontColor')
    expect(wrap.querySelector('[data-rb-panel]')).toBeNull()
    await unmount()
  })

  it('toggles the panel from the caret with legacy class transitions', async () => {
    const { host, unmount } = await mount()
    const wrap = splitOf(host)
    const caret = wrap.querySelector('button.rb-caret')!
    expect(caret.className).toBe('rb-caret rb-color-caret')
    await click(caret)
    expect(caret.className).toBe('rb-caret rb-color-caret active')
    const panel = wrap.querySelector('[data-rb-panel]')
    expect(panel).toBeTruthy()
    expect(panel!.className).toBe('spacing-menu')
    expect(panel!.querySelector('.rb-menu-sep')).toBeTruthy()
    await click(caret)
    expect(wrap.querySelector('[data-rb-panel]')).toBeNull()
    await unmount()
  })

  it('executes menu items with args and closes the panel', async () => {
    const { host, log, unmount } = await mount()
    const wrap = splitOf(host)
    await click(wrap.querySelector('button.rb-caret'))
    const red = [...wrap.querySelectorAll('[data-rb-panel] button')].find(
      (b) => b.textContent === 'color.red',
    )
    await click(red)
    expect(log).toHaveBeenCalledWith('fontColor')
    expect(wrap.querySelector('[data-rb-panel]')).toBeNull()
    await unmount()
  })

  it('feeds the color bar from the command visual value', async () => {
    const { host, unmount } = await mount()
    const bar = splitOf(host).querySelector<HTMLElement>('.rb-color-bar')
    expect(bar).toBeTruthy()
    expect(bar!.style.background).toBe('rgb(192, 0, 0)')
    await unmount()
  })

  it('renders the color glyph wrapper like legacy', async () => {
    const { host, unmount } = await mount()
    expect(splitOf(host).querySelector('.rb-color-glyph.rb-color-glyph-svg')).toBeTruthy()
    await unmount()
  })
})

describe('dropdown control', () => {
  const caseButton = (host: HTMLElement) => {
    const wrap = [...host.querySelectorAll('.rb-split-wrap')].find((w) =>
      w.querySelector('.rb-caret-inline'),
    )
    expect(wrap, 'changeCase dropdown wrap').toBeTruthy()
    return wrap!
  }

  it('renders the inline-caret trigger and opens on click', async () => {
    const { host, unmount } = await mount()
    const wrap = caseButton(host)
    const trigger = wrap.querySelector('button.rb-icon')!
    expect(trigger.className).toBe('rb-icon ')
    await click(trigger)
    expect(trigger.className).toBe('rb-icon active')
    expect(wrap.querySelector('[data-rb-panel]')!.className).toBe('spacing-menu case-menu')
    await unmount()
  })

  it('applies the control-level disabledWhen gate', async () => {
    const { host, unmount } = await mount({ canEdit: false })
    const trigger = caseButton(host).querySelector('button.rb-icon')!
    expect((trigger as HTMLButtonElement).disabled).toBe(true)
    await unmount()
  })
})

describe('file menu', () => {
  it('opens the legacy file-menu panel with shortcut hints', async () => {
    const { host, unmount } = await mount()
    const fileTab = host.querySelector('.ribbon-tab-file')!
    expect(fileTab.className).toBe('ribbon-tab ribbon-tab-file ')
    await click(fileTab)
    expect(fileTab.className).toBe('ribbon-tab ribbon-tab-file open')
    const menu = host.querySelector('.file-menu')
    expect(menu).toBeTruthy()
    const open = [...menu!.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('file.open'),
    )
    expect(open!.querySelector('.file-menu-key')!.textContent).toBe('Ctrl+O')
    await unmount()
  })

  it('gates file items on their command (save needs a doc)', async () => {
    const { host, unmount } = await mount({ hasDoc: false })
    await click(host.querySelector('.ribbon-tab-file'))
    const save = [...host.querySelectorAll('.file-menu button')].find((b) =>
      b.textContent?.includes('file.save'),
    )
    expect((save as HTMLButtonElement).disabled).toBe(true)
    await unmount()
  })

  it('executes the item command and closes the menu', async () => {
    const { host, log, unmount } = await mount()
    await click(host.querySelector('.ribbon-tab-file'))
    const save = [...host.querySelectorAll('.file-menu button')].find((b) =>
      b.textContent?.includes('file.save'),
    )
    await click(save)
    expect(log).toHaveBeenCalledWith('save')
    expect(host.querySelector('.file-menu')).toBeNull()
    await unmount()
  })
})

describe('group layout', () => {
  it('renders group separators only between visible groups', async () => {
    const { host, unmount } = await mount()
    const body = host.querySelector('.ribbon-body')!
    expect(body.querySelectorAll('.ribbon-group').length).toBe(2)
    expect(body.querySelectorAll('.ribbon-sep').length).toBe(1)
    await unmount()
  })

  it('renders row/column containers, mini separators and group className', async () => {
    const { host, unmount } = await mount()
    expect(host.querySelector('.ribbon-group-items.rb-font-group')).toBeTruthy()
    expect(host.querySelectorAll('.rb-font-group > .rb-row').length).toBe(2)
    expect(host.querySelector('.rb-col')).toBeTruthy()
    expect(host.querySelector('.rb-mini-sep')).toBeTruthy()
    await unmount()
  })

  it('renders big buttons with the icon-over-label structure', async () => {
    const { host, unmount } = await mount()
    const big = host.querySelector('.rb-big')!
    expect(big.querySelector('.rb-big-icon .ic-paste')).toBeTruthy()
    expect(big.textContent).toContain('paste')
    await unmount()
  })
})

describe('custom control', () => {
  it('receives state, services, t and the dropdown handle', async () => {
    const { host, log, unmount } = await mount()
    await click(tabByText(host, 'tab.insert'))
    const custom = host.querySelector('button[data-custom]')!
    expect(custom.getAttribute('data-custom')).toBe('true')
    await click(custom)
    expect(log).toHaveBeenCalledWith('custom:custom.label')
    await unmount()
  })
})

describe('unified dismissal', () => {
  it('closes the open panel on an outside pointerdown', async () => {
    const { host, unmount } = await mount()
    const wrap = [...host.querySelectorAll('.rb-split-wrap')].find((w) =>
      w.querySelector('.rb-color-btn'),
    )!
    await click(wrap.querySelector('button.rb-caret'))
    expect(wrap.querySelector('[data-rb-panel]')).toBeTruthy()
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    })
    expect(wrap.querySelector('[data-rb-panel]')).toBeNull()
    await unmount()
  })

  it('closes the open panel on window blur', async () => {
    const { host, unmount } = await mount()
    const wrap = [...host.querySelectorAll('.rb-split-wrap')].find((w) =>
      w.querySelector('.rb-color-btn'),
    )!
    await click(wrap.querySelector('button.rb-caret'))
    expect(wrap.querySelector('[data-rb-panel]')).toBeTruthy()
    await act(async () => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(wrap.querySelector('[data-rb-panel]')).toBeNull()
    await unmount()
  })
})
