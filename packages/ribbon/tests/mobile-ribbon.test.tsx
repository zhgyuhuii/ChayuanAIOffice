// @vitest-environment jsdom
// MobileRibbon (P1): the schema-driven mobile renderer must expose the file
// menu, tab switching and the displayed tab's groups as tappable rows through
// the same registry gates as the desktop renderer — ANDed global/group/command
// enablement, split/dropdown disclosures, gallery values, and honest
// degradation (disabled rows) for popup-only controls.
import { act } from 'react'
import { createElement as h } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { createCommandRegistry, type AnyCommandDefinition } from '../src/command/registry'
import { commandId } from '../src/command/id'
import type { RibbonSchema } from '../src/schema/types'
import { MobileRibbon, type MobileRibbonProps } from '../src/mobile/MobileRibbon'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

interface S {
  canEdit: boolean
  bold: boolean
}
interface Svcs {
  log: (entry: string) => void
}

const BASE_STATE: S = { canEdit: true, bold: false }

function makeRegistry() {
  const defs: AnyCommandDefinition<S, Svcs>[] = [
    {
      id: commandId('test.file.save'),
      run: (ctx) => ctx.services.log('save'),
    },
    {
      id: commandId('test.file.export'),
      run: (ctx) => ctx.services.log('export'),
    },
    {
      id: commandId('test.edit.bold'),
      isEnabled: (ctx) => ctx.state.canEdit,
      isActive: (ctx) => ctx.state.bold,
      run: (ctx) => ctx.services.log('bold'),
    },
    {
      id: commandId('test.edit.track'),
      isEnabled: (ctx) => ctx.state.canEdit,
      isActive: () => false,
      run: (ctx) => ctx.services.log('track'),
    },
    {
      id: commandId('test.edit.paint'),
      isEnabled: (ctx) => ctx.state.canEdit,
      run: (ctx) => ctx.services.log('paint'),
    },
    {
      id: commandId('test.format.setRed'),
      isEnabled: (ctx) => ctx.state.canEdit,
      run: (ctx) => ctx.services.log('setRed'),
    },
    {
      id: commandId('test.format.style'),
      isEnabled: (ctx) => ctx.state.canEdit,
      run: (ctx, args: { key: string }) => ctx.services.log(`style:${args.key}`),
    },
  ]
  return createCommandRegistry(defs)
}

function makeSchema(): RibbonSchema<S, Svcs> {
  return {
    id: 'test',
    version: 1,
    tabs: [
      {
        id: 'file',
        kind: 'file',
        labelKey: 'File',
        menu: [
          { id: 'save', labelKey: 'Save', command: commandId('test.file.save') },
          { kind: 'separator', id: 'sep1' },
          { id: 'export', labelKey: 'Export', command: commandId('test.file.export') },
        ],
        groups: [],
      },
      {
        id: 'home',
        kind: 'regular',
        labelKey: 'Home',
        groups: [
          {
            id: 'font',
            labelKey: 'Font',
            controls: [
              {
                kind: 'button',
                id: 'bold',
                command: commandId('test.edit.bold'),
                icon: 'i-bold',
                size: 'small',
                labelKey: 'Bold',
              },
              {
                kind: 'toggle',
                id: 'track',
                command: commandId('test.edit.track'),
                labelKey: 'Track',
              },
              {
                kind: 'dropdown',
                id: 'color',
                command: commandId('test.edit.paint'),
                labelKey: 'Color',
                menu: [
                  {
                    id: 'red',
                    labelKey: 'Red',
                    command: commandId('test.format.setRed'),
                    args: 'red',
                  },
                ],
              },
              {
                kind: 'gallery',
                id: 'styles',
                command: commandId('test.format.style'),
                columns: 2,
                items: [
                  { id: 'normal', labelKey: 'Normal', value: { key: 'p' } },
                  { id: 'heading', value: { key: 'h1' } },
                ],
              },
              {
                kind: 'combobox',
                id: 'fontName',
                command: commandId('test.format.style'),
                statePath: 'bold',
                labelKey: 'FontName',
              },
            ],
          },
        ],
      },
      {
        id: 'layout',
        kind: 'regular',
        labelKey: 'Layout',
        groups: [
          {
            id: 'page',
            labelKey: 'Page',
            controls: [
              {
                kind: 'button',
                id: 'margins',
                command: commandId('test.file.export'),
                labelKey: 'Margins',
              },
            ],
          },
        ],
      },
    ],
  }
}

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn()
})

function mount(ui: Partial<MobileRibbonProps<S, Svcs>> & { state?: S } = {}): {
  host: HTMLElement
  log: string[]
  setState: (next: S) => void
} {
  const host = document.createElement('div')
  document.body.append(host)
  const root: Root = createRoot(host)
  cleanups.push(() => root.unmount())
  const log: string[] = []
  const registry = makeRegistry()
  const services: Svcs = {
    log: (entry) => {
      log.push(entry)
    },
  }
  let current: S = ui.state ?? BASE_STATE
  const render = () => {
    act(() => {
      root.render(
        h(MobileRibbon<S, Svcs>, {
          schema: makeSchema(),
          registry,
          state: current,
          services,
          t: (key) => key,
          defaultTab: 'home',
          trailingActions: h('span', { className: 'trailing-probe' }, 'AI'),
          ...ui,
          state: current,
        }),
      )
    })
  }
  render()
  return {
    host,
    log,
    setState(next: S) {
      current = next
      render()
    },
  }
}

describe('MobileRibbon bar', () => {
  it('renders the file button, the active tab trigger and the trailing slot', () => {
    const { host } = mount()
    expect(host.querySelector('.mrib-file')!.textContent).toBe('File')
    expect(host.querySelector('.mrib-tab-trigger')!.textContent).toContain('Home')
    expect(host.querySelector('.trailing-probe')!.textContent).toBe('AI')
  })
})

describe('MobileRibbon tools sheet', () => {
  function openTools(host: HTMLElement): HTMLElement {
    act(() => {
      ;(host.querySelector('.mrib-tab-trigger') as HTMLElement).click()
    })
    return host.querySelector('.mrib-sheet')!
  }

  it('lists switchable tabs as chips and the displayed tab groups as rows', () => {
    const { host } = mount()
    const sheet = openTools(host)
    const chips = [...sheet.querySelectorAll('.mrib-tab-chip')].map((chip) => chip.textContent)
    expect(chips).toEqual(['Home', 'Layout'])
    expect(sheet.querySelector('.mrib-group-label')!.textContent).toBe('Font')
    const labels = [...sheet.querySelectorAll('.mrib-row-label')].map((el) => el.textContent)
    expect(labels).toContain('Bold')
    expect(labels).toContain('Track')
  })

  it('switches the displayed tab from a chip and swaps the group sections', () => {
    const { host } = mount()
    const sheet = openTools(host)
    const layoutChip = [...sheet.querySelectorAll('.mrib-tab-chip')].find(
      (chip) => chip.textContent === 'Layout',
    ) as HTMLElement
    act(() => {
      layoutChip.click()
    })
    expect(host.querySelector('.mrib-sheet .mrib-group-label')!.textContent).toBe('Page')
  })

  it('executes button commands and composes enablement gates', () => {
    const ui = mount()
    const sheet = openTools(ui.host)
    const bold = [...sheet.querySelectorAll('.mrib-row')].find(
      (row) => row.textContent === 'Bold',
    ) as HTMLElement
    act(() => {
      bold.click()
    })
    expect(ui.log).toEqual(['bold'])

    // global edit fence: the command greys out without crashing
    const locked = mount({ state: { canEdit: false, bold: false } })
    const lockedSheet = openTools(locked.host)
    const lockedBold = [...lockedSheet.querySelectorAll('.mrib-row')].find(
      (row) => row.textContent === 'Bold',
    ) as HTMLButtonElement
    expect(lockedBold.disabled).toBe(true)
  })

  it('marks toggle commands with aria-pressed from isActive', () => {
    const { host } = mount({ state: { canEdit: true, bold: false } })
    const sheet = openTools(host)
    const track = [...sheet.querySelectorAll('.mrib-row')].find(
      (row) => row.textContent === 'Track',
    ) as HTMLElement
    act(() => {
      track.click()
    })
    expect(track.getAttribute('aria-pressed')).toBe('false')
  })

  it('expands dropdowns with the main command as the first sub-row', () => {
    const { host, log } = mount()
    const sheet = openTools(host)
    const disclosure = sheet.querySelector('.mrib-disclosure') as HTMLElement
    act(() => {
      disclosure.click()
    })
    const subRows = [...host.querySelectorAll('.mrib-row.mrib-sub')].map((row) => row.textContent)
    expect(subRows).toEqual(['Color']) // the dropdown's own command, then menu items
    const red = [...host.querySelectorAll('.mrib-row')].find(
      (row) => row.textContent === 'Red',
    ) as HTMLElement
    act(() => {
      red.click()
    })
    expect(log).toEqual(['setRed'])
  })

  it('runs gallery items with their value and renders label-less cards', () => {
    const { host, log } = mount()
    const sheet = openTools(host)
    const items = [...sheet.querySelectorAll('.mrib-gallery-item')] as HTMLElement[]
    expect(items).toHaveLength(2)
    act(() => {
      items[0].click()
    })
    expect(log).toEqual(['style:p'])
    act(() => {
      items[1].click()
    })
    expect(log).toEqual(['style:p', 'style:h1'])
  })

  it('degrades popup-only controls to disabled rows instead of dropping them', () => {
    const { host } = mount()
    const sheet = openTools(host)
    const unsupported = sheet.querySelector('[data-mrib-unsupported="combobox"]')!
    expect(unsupported.closest('.mrib-row')).not.toBeNull()
    const row = unsupported.closest('.mrib-row') as HTMLButtonElement
    expect(row.disabled).toBe(true)
  })
})

describe('MobileRibbon file sheet', () => {
  it('renders menu items, executes them and closes the sheet', () => {
    const { host, log } = mount()
    act(() => {
      ;(host.querySelector('.mrib-file') as HTMLElement).click()
    })
    const sheet = host.querySelector('.mrib-sheet')!
    expect(sheet.querySelector('.mrib-sheet-title')!.textContent).toBe('File')
    expect(sheet.querySelectorAll('.mrib-sep')).toHaveLength(1)

    act(() => {
      ;(
        [...sheet.querySelectorAll('.mrib-row')].find(
          (row) => row.textContent === 'Save',
        ) as HTMLElement
      ).click()
    })
    expect(log).toEqual(['save'])
    expect(host.querySelector('.mrib-sheet')).toBeNull()
  })
})
