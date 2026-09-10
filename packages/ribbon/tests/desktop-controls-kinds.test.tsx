// @vitest-environment jsdom
// Control kinds C3-C7: toggle/number/combobox/colorpicker/gallery must render
// the legacy chrome classes, read their value from the schema statePath, and
// dispatch through the registry with the documented commit semantics
// (number→clamped number, combobox pick→option.value / editable Enter→typed
// string, colorpicker→css color or null, gallery→item.value).
import { describe, expect, it, vi } from 'vitest'
import { act, createElement as h, type ReactElement } from 'react'
import { createRoot } from 'react-dom/client'
import { createCommandRegistry, type AnyCommandDefinition } from '../src/command/registry'
import { commandId } from '../src/command/id'
import type { RibbonSchema } from '../src/schema/types'
import { DesktopRibbon, type DesktopRibbonProps } from '../src/desktop/DesktopRibbon'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

interface S {
  canEdit: boolean
  bold: boolean
  fontSizePt: number
  fontFamily: string
  align: string
  textColor: string | null
}
interface Svcs {
  log: (entry: string) => void
}

const BASE_STATE: S = {
  canEdit: true,
  bold: false,
  fontSizePt: 12,
  fontFamily: 'Arial',
  align: 'center',
  textColor: null,
}

function makeRegistry(log: (entry: string) => void) {
  const defs: AnyCommandDefinition<S, Svcs>[] = [
    { id: commandId('docs.format.toggleBold'), run: () => log('bold') },
    {
      id: commandId('docs.format.setFontSize'),
      run: (_ctx, args) => log(`fontSize:${String(args)}`),
    },
    {
      id: commandId('docs.format.setFontFamily'),
      run: (_ctx, args) => log(`family:${String(args)}`),
    },
    { id: commandId('docs.format.align'), run: (_ctx, args) => log(`align:${String(args)}`) },
    {
      id: commandId('docs.format.fontColor'),
      run: (_ctx, args) => log(`color:${args === null ? 'none' : String(args)}`),
    },
    { id: commandId('docs.style.apply'), run: (_ctx, args) => log(`style:${String(args)}`) },
  ]
  return createCommandRegistry<S, Svcs>(defs)
}

function makeSchema(): RibbonSchema<S, Svcs> {
  return {
    id: 'kinds',
    version: 1,
    tabs: [
      {
        id: 'home',
        labelKey: 'tab.home',
        kind: 'regular',
        groups: [
          {
            id: 'g',
            labelKey: 'group.g',
            controls: [
              {
                id: 'bold',
                kind: 'toggle',
                command: commandId('docs.format.toggleBold'),
                statePath: 'bold',
                icon: 'bold',
                labelKey: 'bold',
                className: 'ctl-bold',
              },
              {
                id: 'size',
                kind: 'number',
                command: commandId('docs.format.setFontSize'),
                statePath: 'fontSizePt',
                min: 1,
                max: 100,
                step: 2,
                className: 'ctl-size',
              },
              {
                id: 'align',
                kind: 'combobox',
                command: commandId('docs.format.align'),
                statePath: 'align',
                className: 'ctl-align',
                options: [
                  { value: 'left', labelKey: 'left' },
                  { value: 'center', labelKey: 'center' },
                ],
              },
              {
                id: 'family',
                kind: 'combobox',
                command: commandId('docs.format.setFontFamily'),
                statePath: 'fontFamily',
                editable: true,
                className: 'ctl-family',
                options: [{ value: 'Arial' }],
              },
              {
                id: 'fontColor',
                kind: 'colorpicker',
                command: commandId('docs.format.fontColor'),
                statePath: 'textColor',
                palette: 'standard',
                allowNone: { labelKey: 'auto' },
                icon: 'color',
                labelKey: 'color',
                className: 'ctl-color',
              },
              {
                id: 'styles',
                kind: 'gallery',
                command: commandId('docs.style.apply'),
                columns: 3,
                className: 'ctl-gallery',
                items: [
                  { id: 's1', icon: 'style1', labelKey: 'Style 1', value: 's1' },
                  { id: 's2', icon: 'style2', labelKey: 'Style 2', value: 's2' },
                  { id: 's3', icon: 'style3', labelKey: 'Style 3', value: 's3' },
                  { id: 's4', icon: 'style4', labelKey: 'Style 4', value: 's4' },
                ],
              },
            ],
          },
        ],
      },
    ],
  }
}

const t = (key: string) => key
const ICONS = { bold: h('i', { className: 'ic-bold' }), color: h('i', { className: 'ic-color' }) }

interface Harness {
  host: HTMLDivElement
  log: ReturnType<typeof vi.fn>
  render: (state?: Partial<S>, props?: Partial<DesktopRibbonProps<S, Svcs>>) => Promise<void>
  unmount: () => Promise<void>
}

async function mount(state: Partial<S> = {}): Promise<Harness> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const log = vi.fn()
  const registry = makeRegistry((entry) => log(entry))
  const services: Svcs = { log: (entry) => log(entry) }
  const root = createRoot(host)
  let currentState: S = { ...BASE_STATE, ...state }
  const render = async (next: Partial<S> = {}) => {
    currentState = { ...currentState, ...next }
    const props: DesktopRibbonProps<S, Svcs> = {
      schema: makeSchema(),
      registry,
      state: currentState,
      services,
      t,
      icons: ICONS,
    }
    await act(async () => {
      root.render(h(DesktopRibbon, props) as ReactElement)
    })
  }
  await render()
  return {
    host,
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

const key = async (el: Element, keyName: string) => {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: keyName, bubbles: true }))
  })
}

/** Controlled-input typing: native setter + input event (React 19/jsdom). */
const type = async (input: HTMLInputElement, text: string) => {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  await act(async () => {
    setter.call(input, text)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('toggle control', () => {
  it('marks pressed from statePath and runs the command on click', async () => {
    const { host, log, render, unmount } = await mount({ bold: true })
    const toggle = host.querySelector('.ctl-bold')!
    expect(toggle.className).toContain('active')
    await click(toggle)
    expect(log).toHaveBeenCalledWith('bold')
    await render({ bold: false })
    expect(toggle.className).not.toContain('active')
    await unmount()
  })
})

describe('number control', () => {
  it('shows the statePath value and steps by `step` with clamping via ArrowUp', async () => {
    const { host, log, unmount } = await mount({ fontSizePt: 99 })
    const input = host.querySelector<HTMLInputElement>('.rb-spin.ctl-size .rb-spin-input')!
    expect(input.value).toBe('99')
    await key(input, 'ArrowUp')
    expect(log).toHaveBeenCalledWith('fontSize:100')
    log.mockClear()
    await key(input, 'ArrowUp')
    expect(log).toHaveBeenCalledWith('fontSize:100')
    await unmount()
  })

  it('commits the typed value on Enter and reverts the draft', async () => {
    const { host, log, unmount } = await mount()
    const input = host.querySelector<HTMLInputElement>('.rb-spin .rb-spin-input')!
    await type(input, '18')
    await key(input, 'Enter')
    expect(log).toHaveBeenCalledWith('fontSize:18')
    expect(input.value).toBe('12')
    await unmount()
  })

  it('steps down from the current value via the stepper button', async () => {
    const { host, log, unmount } = await mount({ fontSizePt: 12 })
    const down = host.querySelector<HTMLButtonElement>('.rb-spin .rb-spin-down')!
    await click(down)
    expect(log).toHaveBeenCalledWith('fontSize:10')
    await unmount()
  })
})

describe('combobox control', () => {
  it('shows the current option label; picking an option runs the command and closes', async () => {
    const { host, log, unmount } = await mount({ align: 'center' })
    const trigger = host.querySelector<HTMLButtonElement>('.rb-combo.ctl-align .rb-combo-trigger')!
    expect(trigger.textContent).toBe('center')
    await click(trigger)
    const panel = host.querySelector('.rb-combo-panel')!
    expect(panel).toBeTruthy()
    await click(panel.querySelector('button.active')!)
    expect(log).toHaveBeenCalledWith('align:center')
    await act(async () => {})
    expect(host.querySelector('.rb-combo-panel')).toBeNull()
    await unmount()
  })

  it('editable combo commits the typed string on Enter', async () => {
    const { host, log, unmount } = await mount({ fontFamily: 'Arial' })
    const input = host.querySelector<HTMLInputElement>('.rb-combo.ctl-family .rb-combo-input')!
    await type(input, 'Georgia')
    await key(input, 'Enter')
    expect(log).toHaveBeenCalledWith('family:Georgia')
    await unmount()
  })
})

describe('colorpicker control', () => {
  it('opens the default palette; picking runs the command with the css color', async () => {
    const { host, log, unmount } = await mount()
    await click(host.querySelector('.ctl-color .rb-color-btn')!)
    const palette = host.querySelector('.rb-palette')!
    expect(palette).toBeTruthy()
    // standard palette = 10 base colors
    expect(palette.querySelectorAll('.rb-palette-swatch')).toHaveLength(10)
    await click(palette.querySelector<HTMLElement>('.rb-palette-swatch[data-tip="#FF0000"]')!)
    expect(log).toHaveBeenCalledWith('color:#FF0000')
    expect(host.querySelector('.rb-palette')).toBeNull()
    await unmount()
  })

  it('shows the current color bar from statePath and supports the none row', async () => {
    const { host, log, unmount } = await mount({ textColor: '#00B050' })
    const bar = host.querySelector<HTMLElement>('.ctl-color .rb-color-bar')!
    expect(bar.style.background).toBe('rgb(0, 176, 80)')
    await click(host.querySelector('.ctl-color .rb-color-btn')!)
    await click(host.querySelector('.rb-palette .rb-palette-none')!)
    expect(log).toHaveBeenCalledWith('color:none')
    await unmount()
  })
})

describe('gallery control', () => {
  it('renders the item grid with `columns` and picks item.value', async () => {
    const { host, log, unmount } = await mount()
    const gallery = host.querySelector<HTMLElement>('.rb-gallery.ctl-gallery')!
    expect(gallery.style.gridTemplateColumns).toBe('repeat(3, minmax(0, 1fr))')
    const items = gallery.querySelectorAll<HTMLButtonElement>('.rb-gallery-item')
    expect(items).toHaveLength(4)
    expect(items[0].getAttribute('data-tip')).toBe('Style 1')
    await click(items[1])
    expect(log).toHaveBeenCalledWith('style:s2')
    await unmount()
  })
})
