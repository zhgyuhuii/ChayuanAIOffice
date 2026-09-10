/**
 * @chatoffice/ribbon — editor-agnostic command registry + declarative ribbon
 * schema with desktop/mobile renderers. Host apps define their state snapshot
 * and services, register CommandDefinitions, describe menus as a RibbonSchema,
 * and let the renderers output platform-appropriate UI from the same data.
 * Secondary development injects SchemaPatch + command overrides at build time.
 */
export { assertCommandId, commandId, isCommandId } from './command/id'
export { CommandRegistry, createCommandRegistry } from './command/registry'
export type {
  AnyCommandDefinition,
  CommandContext,
  CommandDefinition,
  CommandId,
  CommandVisualState,
} from './command/types'
export type {
  ButtonControl,
  ColorControl,
  ColumnControl,
  ComboControl,
  CustomControl,
  CustomRenderContext,
  DropdownControl,
  GalleryControl,
  GalleryItem,
  NumberControl,
  RibbonContextGroup,
  RibbonControl,
  RibbonDropdownApi,
  RibbonGroup,
  RibbonMenuItem,
  RibbonMenuRenderer,
  RibbonSchema,
  RibbonTab,
  RibbonTranslate,
  RowControl,
  SeparatorControl,
  SplitControl,
  ToggleControl,
} from './schema/types'
export {
  evaluateWhen,
  isWhenExpr,
  resolvePath,
  validateWhenExpr,
  type When,
  type WhenExpr,
  type WhenPredicate,
} from './schema/when'
export {
  assertValidSchema,
  validateSchema,
  type SchemaIssue,
  type ValidateOptions,
} from './schema/validate'
export { applySchemaPatch, mergeSchemas, type SchemaPatch } from './schema/merge'
export {
  schemaFromJSON,
  schemaToJSON,
  type SchemaFromJSONOptions,
  type SchemaToJSONResult,
} from './schema/serialize'
export { DesktopRibbon, type DesktopRibbonProps } from './desktop/DesktopRibbon'
export {
  deriveCanHideText,
  deriveSpaceHint,
  planCollapse,
  SPACE_HINT_RANK,
  textHideOrder,
  type GroupAdapt,
  type SpaceHint,
} from './desktop/adaptive'
export { MobileRibbon, type MobileRibbonProps } from './mobile/MobileRibbon'
export {
  useRibbonTabs,
  contextualGroups,
  type RibbonTabMachine,
  type RibbonTabMachineOptions,
} from './desktop/use-ribbon-tabs'
export { useRibbonEnv, type RibbonEnv, type RibbonIconMap } from './desktop/env'
export { ControlView, IconCaret, MenuPanel } from './desktop/controls'
export {
  useTabStripOverflow,
  type TabStripOverflow,
  type TabStripOverflowState,
} from './desktop/use-tab-strip-overflow'
export { TabStripArrows, type TabStripArrowsProps } from './desktop/tab-strip-arrows'
