/**
 * 察元 AI tab commands — the harvested chayuan-wps ribbon surface (常用助手
 * assistants, 安全保密 declassify trio, 文档批量 style/blank-line tools,
 * 批量操作 table/image batch menus, 表单辅助 form mode) mapped onto the
 * chayuan host-services group. One command per interaction shape; per-item
 * menu entries pass their id through `args`.
 */
import { commandId, type AnyCommandDefinition } from '@chatoffice/ribbon'
import type { DocsCommandState } from '../command-state'
import type { DocsCommandServices } from '../host-services'
import type { DocOpsDialogKind } from '../../docops/dialogs'

type State = DocsCommandState
type Services = DocsCommandServices
type Ctx = CommandContextAlias
type CommandContextAlias = import('@chatoffice/ribbon').CommandContext<State, Services>
/** heterogeneous store form: run() args are typed by each definition's own annotation */
type Def = AnyCommandDefinition<State, Services>

const hasDoc = (ctx: Ctx) => ctx.state.hasDoc

export const CHAYUAN_COMMANDS: Def[] = [
  {
    id: commandId('docs.chayuan.assistant'),
    isEnabled: hasDoc,
    run: (ctx, args: { id: string }) => ctx.services.chayuan.runAssistant(args.id),
  },
  {
    id: commandId('docs.chayuan.dialog'),
    isEnabled: hasDoc,
    run: (ctx, args: { kind: DocOpsDialogKind }) => ctx.services.chayuan.openDialog(args.kind),
  },
  {
    id: commandId('docs.chayuan.op'),
    isEnabled: hasDoc,
    run: (ctx, args: { op: string }) => ctx.services.chayuan.runOp(args.op),
  },
  {
    id: commandId('docs.chayuan.export'),
    isEnabled: hasDoc,
    run: (ctx, args: { what: 'tables' | 'images' }) => ctx.services.chayuan.exportAll(args.what),
  },
  {
    id: commandId('docs.chayuan.formToggle'),
    isEnabled: hasDoc,
    isActive: (ctx) => ctx.services.chayuan.formModeActive(),
    run: (ctx) => ctx.services.chayuan.runOp('form.toggle'),
  },
]
