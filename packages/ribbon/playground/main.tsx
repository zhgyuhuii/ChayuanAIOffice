/**
 * Standalone playground: renders DesktopRibbon with all 12 control kinds so
 * chrome/degradation can be screenshot-verified without a host app (M4 验收
 * 用;自测配方见 docs/ribbon-wps-parity-gap.md)。
 */
import { createElement as h, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  createCommandRegistry,
  DesktopRibbon,
  type AnyCommandDefinition,
  commandId,
  type RibbonSchema,
} from '../src/index'

interface S {
  bold: boolean
  fontSizePt: number
  rowHeight: number
  fontFamily: string
  align: string
  textColor: string | null
}
const state: S = {
  bold: true,
  fontSizePt: 12,
  rowHeight: 0.9,
  fontFamily: '等线',
  align: 'left',
  textColor: null,
}

const log = (entry: string) => console.info('[cmd]', entry)
const defs: AnyCommandDefinition<S, undefined>[] = (
  [
    ['demo.edit.toggleBold', () => (state.bold = !state.bold)],
    ['demo.edit.setFontSize', (_c, a) => (state.fontSizePt = a as number)],
    ['demo.edit.setRowHeight', (_c, a) => (state.rowHeight = a as number)],
    ['demo.edit.setFontFamily', (_c, a) => (state.fontFamily = a as string)],
    ['demo.edit.align', (_c, a) => (state.align = a as string)],
    ['demo.edit.fontColor', (_c, a) => (state.textColor = a as string | null)],
    ['demo.edit.style', (_c, a) => log(`style:${String(a)}`)],
    ['demo.edit.action', (_c, a) => log(`action:${String(a ?? '')}`)],
  ] as const
).map(([id, run]) => ({ id: commandId(id), run }))

const registry = createCommandRegistry<S, undefined>(defs)

const ic = (glyph: string, color = '#444') =>
  h('i', { className: 'demo-icon', style: { color }, 'aria-hidden': true }, glyph)
const ICONS = {
  paste: ic('📋'),
  cut: ic('✂️'),
  copy: ic('📄'),
  bold: ic('B', '#222'),
  italic: ic('I', '#222'),
  underline: ic('U', '#222'),
  color: ic('A', '#c8102e'),
  alignLeft: ic('⯇'),
  alignCenter: ic('≡'),
  heading: ic('H'),
  list: ic('☰'),
  style1: ic('Aa'),
  style2: ic('Aa'),
  style3: ic('Aa'),
  style4: ic('Aa'),
  caret: ic('▾'),
  collapse: ic('▾'),
}

const schema: RibbonSchema<S, undefined> = {
  id: 'playground',
  version: 1,
  tabs: [
    {
      id: 'home',
      labelKey: '开始',
      kind: 'regular',
      groups: [
        {
          id: 'clipboard',
          labelKey: '剪贴板',
          controls: [
            {
              id: 'paste',
              kind: 'split',
              command: commandId('demo.edit.action'),
              args: 'paste',
              icon: 'paste',
              size: 'big',
              labelKey: '粘贴',
              menu: [
                {
                  id: 'pv',
                  labelKey: '值',
                  command: commandId('demo.edit.action'),
                  args: 'values',
                },
              ],
            },
            {
              id: 'cut',
              kind: 'button',
              command: commandId('demo.edit.action'),
              args: 'cut',
              icon: 'cut',
              size: 'small',
              labelKey: '剪切',
            },
            {
              id: 'copy',
              kind: 'button',
              command: commandId('demo.edit.action'),
              args: 'copy',
              icon: 'copy',
              size: 'small',
              labelKey: '复制',
            },
          ],
        },
        {
          id: 'font',
          labelKey: '字体',
          controls: [
            {
              id: 'row1',
              kind: 'row',
              controls: [
                {
                  id: 'family',
                  kind: 'combobox',
                  command: commandId('demo.edit.setFontFamily'),
                  statePath: 'fontFamily',
                  editable: true,
                  options: [{ value: '等线' }, { value: '宋体' }],
                },
                {
                  id: 'size',
                  kind: 'combobox',
                  command: commandId('demo.edit.setFontSize'),
                  statePath: 'fontSizePt',
                  options: [{ value: '10' }, { value: '12' }, { value: '14' }, { value: '16' }],
                },
              ],
            },
            {
              id: 'row2',
              kind: 'row',
              controls: [
                {
                  id: 'bold',
                  kind: 'toggle',
                  command: commandId('demo.edit.toggleBold'),
                  statePath: 'bold',
                  icon: 'bold',
                  labelKey: '加粗',
                },
                {
                  id: 'italic',
                  kind: 'button',
                  command: commandId('demo.edit.action'),
                  args: 'italic',
                  icon: 'italic',
                  size: 'icon',
                  labelKey: '倾斜',
                },
                {
                  id: 'underline',
                  kind: 'button',
                  command: commandId('demo.edit.action'),
                  args: 'underline',
                  icon: 'underline',
                  size: 'icon',
                  labelKey: '下划线',
                },
                {
                  id: 'color',
                  kind: 'colorpicker',
                  command: commandId('demo.edit.fontColor'),
                  statePath: 'textColor',
                  icon: 'color',
                  labelKey: '颜色',
                  palette: 'theme',
                  allowNone: { labelKey: '无颜色' },
                },
              ],
            },
          ],
        },
        {
          id: 'align',
          labelKey: '对齐方式',
          controls: [
            {
              id: 'al',
              kind: 'dropdown',
              command: commandId('demo.edit.align'),
              icon: 'alignLeft',
              size: 'big',
              labelKey: '对齐',
              menu: [
                {
                  id: 'l',
                  labelKey: '左对齐',
                  command: commandId('demo.edit.align'),
                  args: 'left',
                },
                {
                  id: 'c',
                  labelKey: '居中',
                  command: commandId('demo.edit.align'),
                  args: 'center',
                },
              ],
            },
          ],
        },
        {
          id: 'cells',
          labelKey: '单元格',
          controls: [
            {
              id: 'rowHeight',
              kind: 'number',
              command: commandId('demo.edit.setRowHeight'),
              statePath: 'rowHeight',
              min: 0,
              max: 10,
              step: 0.1,
              unitKey: '厘米',
            },
            {
              id: 'styles',
              kind: 'gallery',
              command: commandId('demo.edit.style'),
              columns: 4,
              items: [
                { id: 's1', icon: 'style1', labelKey: '标题', value: 's1' },
                { id: 's2', icon: 'style2', labelKey: '副标题', value: 's2' },
                { id: 's3', icon: 'style3', labelKey: '正文', value: 's3' },
                { id: 's4', icon: 'style4', labelKey: '引用', value: 's4' },
              ],
            },
          ],
        },
        {
          id: 'edit',
          labelKey: '编辑',
          controls: [
            {
              id: 'find',
              kind: 'dropdown',
              command: commandId('demo.edit.action'),
              icon: 'list',
              size: 'big',
              labelKey: '查找',
              menu: [{ id: 'f', labelKey: '查找…', command: commandId('demo.edit.action') }],
            },
          ],
        },
      ],
    },
    {
      id: 'insert',
      labelKey: '插入',
      kind: 'regular',
      groups: [
        {
          id: 'tables',
          labelKey: '表格',
          controls: [
            {
              id: 'table',
              kind: 'button',
              command: commandId('demo.edit.action'),
              icon: 'copy',
              size: 'big',
              labelKey: '表格',
            },
          ],
        },
        {
          id: 'illustrations',
          labelKey: '插图',
          controls: [
            {
              id: 'pic',
              kind: 'button',
              command: commandId('demo.edit.action'),
              icon: 'paste',
              size: 'big',
              labelKey: '图片',
            },
          ],
        },
      ],
    },
  ],
}

function App() {
  const [, force] = useState(0)
  const [collapsed, setCollapsed] = useState(false)
  return h(DesktopRibbon<S, undefined>, {
    schema,
    registry,
    state,
    services: undefined,
    t: (k) => k,
    icons: ICONS,
    collapsed,
    onToggleCollapsed: () => setCollapsed((v) => !v),
    onTabChange: () => force((n) => n + 1),
  })
}

createRoot(document.getElementById('root')!).render(h(App))
