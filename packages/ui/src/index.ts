export { AiPanelSideButton } from './AiPanelSideButton'
export { FilesPane, FilesEdgeTab, type FilesPaneProps } from './files-pane/FilesPane'
export { AiComposer } from './AiComposer'
export { AiScopeQuote, type AiScopeQuoteData } from './AiScopeQuote'
export {
  AI_CUSTOM_FONT_MAX_PX,
  AI_CUSTOM_FONT_MIN_PX,
  AI_FONT_BASE_PX,
  AI_FONT_SIZES,
  DEFAULT_AI_PANEL_PREFS,
  aiPanelFontPx,
  clampAiCustomFontSize,
  isAiFontSize,
  normalizeAiPanelPrefs,
  type AiFontSize,
  type AiPanelPrefs,
  type AiPanelSide,
} from './ai-panel-prefs'
export { applyAiPanelPrefs, useAiPanelPrefs, aiPanelWidthAtPointer } from './ai-panel-prefs-store'
export {
  ColorPicker,
  THEME_COLORS,
  THEME_COLOR_SHADES,
  STANDARD_COLORS,
  type ColorPickerProps,
  type ColorPickerStrings,
  type ColorSwatch,
} from './color-picker'
export { installScreenTips } from './screentip'
export { COMPRESS_PRESETS, compressImageForDisplay, type CompressPresetId } from './image-compress'
export { insertImageStrings } from './insert-image-strings'
export { installAnchorPanelFallback } from './anchor-fallback'
export {
  installPopoverDismiss,
  useDismissablePopover,
  type PopoverDismissOptions,
} from './popover-dismiss'
export { Dropdown, type DropdownOption } from './dropdown'
export {
  FindPanel,
  type FindFocusRequest,
  type FindPanelStrings,
  type FindTarget,
} from './find-panel'
export { findInText, foldCase, isWordChar, type FindOptions } from './find-text'
export {
  useRibbonCollapse,
  RibbonCollapseButton,
  RibbonExpandButton,
  installRibbonPeekDismiss,
  isRibbonToggleShortcut,
  readRibbonCollapsed,
  RIBBON_TOGGLE_SHORTCUT,
  type RibbonCollapse,
  type RibbonCollapseLabels,
} from './ribbon-collapse'
export { AiTypingIndicator } from './AiTypingIndicator'
export {
  DockShell,
  isMacStandaloneWindow,
  type DockChrome,
  type DockLabels,
  type DockLayoutState,
  type DockPosition,
  type DockRect,
  type DockShellProps,
} from './DockShell'
export { PanelTabs, usePanelTab, type PanelTabItem, type PanelTabsProps } from './PanelTabs'
// LOCAL(2026-09-21, d8201ad0): 多会话公共层(B 区)
export {
  useAiConversations,
  type AiActiveTab,
  type AiConversationMeta,
  type AiConversationsScope,
  type ConversationsApi,
  type UseAiConversations,
} from './useAiConversations'
export { AiHistoryList, formatRelativeTime, type AiHistoryListLabels } from './AiHistoryList'
export { AiHistoryPopover, type AiHistoryPopoverLabels } from './AiHistoryPopover'
export { AiTabConfirm } from './AiTabConfirm'
export { AiConversationsEmpty, type AiConversationsEmptyLabels } from './AiConversationsEmpty'
export { AI_CONTINUE_INSTRUCTION } from './aiContinuation'
export { AiPanelToggle, type AiPanelToggleProps } from './AiPanelToggle'
export { IconSend, IconStop, type IconProps } from './icons'
export { Markdown, type MarkdownNav } from './Markdown'
export { isSymbolFontFamily } from './symbol-fonts'
export { BUILTIN_FONT_FAMILIES, fontFamiliesFor } from './font-list'
export {
  WORDART_PRESETS,
  wordArtSolidColor,
  wordArtStrokePx,
  type WordArtPreset,
} from './wordart-presets'
export { ModelPickerButton, type ModelPickerButtonProps } from './ModelPickerButton'

export {
  KbPickerButton,
  useKbAugment,
  useKbSelection,
  type KbPickerButtonProps,
} from './kb/KbPickerButton'
export {
  kbBridge,
  kbBudget,
  kbDiscover,
  kbDoc,
  kbFile,
  kbGetSource,
  kbRetrieve,
  kbSearchGroups,
  kbSelectedIds,
  setKbBudget,
  setKbSelectedIds,
  kbSetOrigin,
  type KbBridgeApi,
  type KbCitation,
  type KbDiscoverPayload,
  type KbDocPayload,
  type KbFilePayload,
  type KbSourceState,
} from './kb/kb-api'
export { renderCitationChips } from './kb/kb-cite'
export { KbCitePreview } from './kb/KbCitePreview'
export { kbStrings, type KbStrings } from './kb/kb-strings'
export { MediaModelPicker, type MediaModelPickerProps } from './MediaModelPicker'
export { CapabilitySettingsPage, type CapabilitySettingsPageProps } from './CapabilitySettingsPage'
export { capabilitySettingsStrings } from './capability-settings-strings'
export { VendorLogo, type VendorLogoProps } from './VendorLogo'
export { USER_LOGIN_READY } from './feature-flags'
export {
  decideIsMobile,
  mobileQueries,
  readUIMode,
  useIsMobile,
  useUIMode,
  type MediaQuerySnapshot,
  type MediaQuerySource,
  type UIMode,
  type UIModeResult,
  type UseIsMobileOptions,
  type UseUIModeOptions,
} from './use-is-mobile'
export {
  CropDialog,
  CutoutDialog,
  cropImagePng,
  DEFAULT_CUTOUT_TOLERANCE,
  type CropFractions,
  type ImageDialogLabels,
} from './image-dialogs'
export { ImageViewer, type ImageViewerLabels } from './image-viewer'
export {
  removeBackground,
  sampleBackgroundColors,
  type CutoutResult,
  type PixelImage,
  type RGB,
} from './cutout'
export {
  encodeAutoSaveOverride,
  isAutoSaveDefault,
  NO_AUTO_SAVE_DEFAULT,
  resolveAutoSave,
  useAutoSavePref,
  type AutoSaveDefault,
  type AutoSaveDefaultApi,
} from './auto-save-pref'
export {
  NOTCH,
  clampZoom,
  createWheelPager,
  createZoomWheelClassifier,
  notchStep,
  type ZoomWheelIntent,
} from './wheel-zoom'
