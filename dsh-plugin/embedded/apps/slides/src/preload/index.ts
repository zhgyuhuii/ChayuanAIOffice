import type { AiPanelPrefs } from '@chatoffice/ui'
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { RenderSlide } from '@chatoffice/pptx-render'
import { KB_CHANNELS } from '@chatoffice/ai-host/kb-channels'
import type { ProjectApi } from '@chatoffice/project-store'
import { installDropOpenBridge } from '@chatoffice/electron-utils/drop-open'
import { installFilesPaneBridge } from '@chatoffice/electron-utils/files-pane-bridge'
import type {
  AddChartOp,
  AddElementOp,
  AiRunFailure,
  ApplyEditScriptOp,
  ApplyTxnOp,
  AddImageBytesOp,
  AddInkOp,
  AddMediaBytesOp,
  ReplacePictureBytesOp,
  AddSmartArtOp,
  ApplyThemeOp,
  AddBlankSlideOp,
  AddSlideOp,
  PasteSlideOp,
  RepasteSlideOp,
  AddSlideWithLayoutOp,
  AddTableOp,
  HeaderFooterOp,
  SetLinkOp,
  AiModelSelection,
  AiSettingsV2,
  AiStreamWireRequest,
  DiscoveryTarget,
  CopyElementsOp,
  PasteElementsOp,
  DuplicateElementsOp,
  EditTableCellOp,
  EditTableStyleOp,
  EditChartOp,
  EditPictureSrcRectOp,
  EditPictureLumOp,
  EditPictureOpacityOp,
  GroupElementsOp,
  UngroupElementOp,
  BatchEditTransformOp,
  SetTableColWidthOp,
  SetTableRowHeightOp,
  SetTableCellAnchorOp,
  TableStructureIpcOp,
  TableMergeIpcOp,
  ReorderElementOp,
  SetAdvanceTimesOp,
  SetAnimationsOp,
  SetSlideHiddenOp,
  SetTransitionOp,
  SectionInfo,
  AddSectionOp,
  RenameSectionOp,
  RemoveSectionOp,
  MoveSectionOp,
  MoveSlideOp,
  AiStreamChunk,
  AudienceNavAction,
  ShowInkEvent,
  ShowSyncState,
  DeleteElementOp,
  DesktopFilesApi,
  EditBackgroundOp,
  EditFillOp,
  EditFillImageOp,
  EditStrokeOp,
  FlipElementOp,
  EditTextOp,
  EditTransformOp,
  EditConnectorEndpointsOp,
  SetElementFontOp,
  SetElementParagraphFormatOp,
  FindReplaceOp,
  SetSlideLayoutOp,
  SetSlideSizeOp,
  MasterEditTextOp,
  MasterEditTransformOp,
  MasterEditFillOp,
  MasterEditStrokeOp,
  MasterDeleteElementOp,
  ExportImagesOp,
  ExportPdfOp,
  PrintSlidesOp,
  MenuCommand,
  OpenResult,
  SlidesApi,
  AutoSaveDefault,
  UiTheme,
  SetEffectsPatch,
} from '../shared/ipc'

const api: SlidesApi = {
  getLanguage: () => ipcRenderer.invoke('app:get-language'),
  onLanguageChanged: (handler) => {
    const listener = (
      _event: IpcRendererEvent,
      lang: 'zh' | 'en' | 'ja' | 'ko' | 'fr' | 'de' | 'es' | 'th' | 'id' | 'ru' | 'ar',
    ) => handler(lang)
    ipcRenderer.on('app:language-changed', listener)
    return () => ipcRenderer.removeListener('app:language-changed', listener)
  },
  getTheme: () => ipcRenderer.invoke('app:get-theme'),
  onThemeChanged: (handler) => {
    const listener = (_event: IpcRendererEvent, theme: UiTheme) => handler(theme)
    ipcRenderer.on('app:theme-changed', listener)
    return () => ipcRenderer.removeListener('app:theme-changed', listener)
  },
  getAutoSaveDefault: () => ipcRenderer.invoke('app:get-auto-save-default'),
  onAutoSaveDefaultChanged: (handler) => {
    const listener = (_event: IpcRendererEvent, value: AutoSaveDefault) => handler(value)
    ipcRenderer.on('app:auto-save-default-changed', listener)
    return () => ipcRenderer.removeListener('app:auto-save-default-changed', listener)
  },
  getAiPanelPrefs: () => ipcRenderer.invoke('app:get-ai-panel-prefs'),
  setAiPanelPrefs: (patch) => ipcRenderer.invoke('app:set-ai-panel-prefs', patch),
  onAiPanelPrefsChanged: (handler) => {
    const listener = (_event: IpcRendererEvent, prefs: AiPanelPrefs) => handler(prefs)
    ipcRenderer.on('app:ai-panel-prefs-changed', listener)
    return () => ipcRenderer.removeListener('app:ai-panel-prefs-changed', listener)
  },
  // dock lifecycle (P1 契约): the shell pushes false when a docked editor pops
  // out to a full tab — the renderer restores its own AI panel preference then
  onDockedState: (handler: (docked: boolean) => void) => {
    const listener = (_event: IpcRendererEvent, docked: boolean): void => handler(docked)
    ipcRenderer.on('app:docked-state', listener)
    return () => ipcRenderer.removeListener('app:docked-state', listener)
  },
  onChromePressed: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('app:chrome-pressed', listener)
    return () => ipcRenderer.removeListener('app:chrome-pressed', listener)
  },
  setShowFullScreen: (on, displayId) => ipcRenderer.invoke('slides:show-fullscreen', on, displayId),
  listDisplays: () => ipcRenderer.invoke('slides:list-displays'),
  privateFontFaces: () => ipcRenderer.invoke('slides:private-font-faces'),
  privateFontData: (id) => ipcRenderer.invoke('slides:private-font-data', id),
  fontCatalog: () => ipcRenderer.invoke('slides:font-catalog'),
  fontDownload: (family) => ipcRenderer.invoke('slides:font-download', family),
  fontInstallLocal: () => ipcRenderer.invoke('slides:font-install-local'),
  fontMissing: () => ipcRenderer.invoke('slides:font-missing'),
  onFontsChanged: (handler) => {
    const listener = () => handler()
    ipcRenderer.on('slides:fonts-changed', listener)
    return () => ipcRenderer.removeListener('slides:fonts-changed', listener)
  },
  openPptx: (fitWidthPx) => ipcRenderer.invoke('slides:open', fitWidthPx),
  openPptxPath: (path, fitWidthPx) => ipcRenderer.invoke('slides:open-path', path, fitWidthPx),
  consumePendingOpen: (fitWidthPx) => ipcRenderer.invoke('slides:consume-pending-open', fitWidthPx),
  consumeHeadlessExport: () => ipcRenderer.invoke('slides:consume-headless-export'),
  headlessExportDone: (result: { ok: boolean; error?: string }) =>
    ipcRenderer.send('slides:headless-export-done', result),
  newBlank: (fitWidthPx) => ipcRenderer.invoke('slides:new-blank', fitWidthPx),
  landGeneratedPages: (
    pageMarkers: string[],
    fitWidthPx: number,
    mode?: 'replace' | 'append' | 'replace_at' | 'insert_at',
    atIndex?: number,
    deckName?: string,
  ) =>
    ipcRenderer.invoke(
      'slides:land-generated-pages',
      pageMarkers,
      fitWidthPx,
      mode,
      atIndex,
      deckName,
    ),
  cloudGenStatus: () => ipcRenderer.invoke('slides:cloud-gen-status'),
  cloudGeneratePage: (op: {
    brief: string
    title?: string
    styleSkill?: string
    deckContext?: Record<string, unknown>
    images?: { url: string; caption?: string }[]
    width?: number
    height?: number
  }) => ipcRenderer.invoke('slides:cloud-page-generate', op),
  localGeneratePage: (op: { specJson: string }) =>
    ipcRenderer.invoke('slides:local-page-generate', op),
  editText: (op: EditTextOp) => ipcRenderer.invoke('slides:edit-text', op),
  setElementFont: (op: SetElementFontOp) => ipcRenderer.invoke('slides:set-element-font', op),
  setElementParagraphFormat: (op: SetElementParagraphFormatOp) =>
    ipcRenderer.invoke('slides:set-element-paragraph-format', op),
  findReplace: (op: FindReplaceOp) => ipcRenderer.invoke('slides:find-replace', op),
  setSlideLayout: (op: SetSlideLayoutOp) => ipcRenderer.invoke('slides:set-slide-layout', op),
  setSlideSize: (op: SetSlideSizeOp) => ipcRenderer.invoke('slides:set-slide-size', op),
  getSlideSize: () => ipcRenderer.invoke('slides:get-slide-size'),
  editTransform: (op: EditTransformOp) => ipcRenderer.invoke('slides:edit-transform', op),
  editConnectorEndpoints: (op: EditConnectorEndpointsOp) =>
    ipcRenderer.invoke('slides:edit-connector-endpoints', op),
  editPictureSrcRect: (op: EditPictureSrcRectOp) =>
    ipcRenderer.invoke('slides:edit-picture-src-rect', op),
  editPictureOpacity: (op: EditPictureOpacityOp) =>
    ipcRenderer.invoke('slides:edit-picture-opacity', op),
  editPictureLum: (op: EditPictureLumOp) => ipcRenderer.invoke('slides:edit-picture-lum', op),
  editImageFill: (op: EditFillImageOp) => ipcRenderer.invoke('slides:edit-image-fill', op),
  changeShape: (op: { slideIndex: number; sourceId: string; prst: string; groupId?: string }) =>
    ipcRenderer.invoke('slides:change-shape', op),
  setShapeAdjust: (op: {
    slideIndex: number
    sourceId: string
    adjust: Record<string, number>
    groupId?: string
    preview?: boolean
  }) => ipcRenderer.invoke('slides:set-shape-adjust', op),
  setTextAnchor: (op: {
    slideIndex: number
    sourceId: string
    anchor: 'top' | 'middle' | 'bottom'
  }) => ipcRenderer.invoke('slides:set-text-anchor', op),
  setTextBodyProps: (op: {
    slideIndex: number
    sourceId: string
    props: {
      vert?: 'horz' | 'eaVert' | 'vert' | 'vert270' | 'wordArtVert'
      autofit?: 'none' | 'shrink' | 'resize'
      insets?: Partial<{ l: number; t: number; r: number; b: number }>
      wrap?: boolean
    }
  }) => ipcRenderer.invoke('slides:set-text-body-props', op),
  setEffects: (op: { slideIndex: number; sourceId: string; effects: SetEffectsPatch }) =>
    ipcRenderer.invoke('slides:set-effects', op),
  clipboardExternal: () => ipcRenderer.invoke('slides:clipboard-external'),
  groupElements: (op: GroupElementsOp) => ipcRenderer.invoke('slides:group-elements', op),
  ungroupElement: (op: UngroupElementOp) => ipcRenderer.invoke('slides:ungroup-element', op),
  batchEditTransform: (op: BatchEditTransformOp) =>
    ipcRenderer.invoke('slides:batch-edit-transform', op),
  getRenderSlides: () => ipcRenderer.invoke('slides:get-render-slides'),
  addElement: (op: AddElementOp) => ipcRenderer.invoke('slides:add-element', op),
  deleteElement: (op: DeleteElementOp) => ipcRenderer.invoke('slides:delete-element', op),
  addSlide: (op: AddSlideOp) => ipcRenderer.invoke('slides:add-slide', op),
  addBlankSlide: (op: AddBlankSlideOp) => ipcRenderer.invoke('slides:add-blank-slide', op),
  addSlideWithLayout: (op: AddSlideWithLayoutOp) =>
    ipcRenderer.invoke('slides:add-slide-with-layout', op),
  getLayouts: () => ipcRenderer.invoke('slides:get-layouts'),
  masterEnter: (fitWidthPx: number) => ipcRenderer.invoke('slides:master-enter', fitWidthPx),
  masterOpen: (partPath: string) => ipcRenderer.invoke('slides:master-open', partPath),
  masterClose: () => ipcRenderer.invoke('slides:master-close'),
  masterEditText: (op: MasterEditTextOp) => ipcRenderer.invoke('slides:master-edit-text', op),
  masterEditTransform: (op: MasterEditTransformOp) =>
    ipcRenderer.invoke('slides:master-edit-transform', op),
  masterEditFill: (op: MasterEditFillOp) => ipcRenderer.invoke('slides:master-edit-fill', op),
  masterEditStroke: (op: MasterEditStrokeOp) => ipcRenderer.invoke('slides:master-edit-stroke', op),
  masterDeleteElement: (op: MasterDeleteElementOp) =>
    ipcRenderer.invoke('slides:master-delete-element', op),
  editFill: (op: EditFillOp) => ipcRenderer.invoke('slides:edit-fill', op),
  editStroke: (op: EditStrokeOp) => ipcRenderer.invoke('slides:edit-stroke', op),
  flipElements: (op: FlipElementOp) => ipcRenderer.invoke('slides:flip-elements', op),
  editBackground: (op: EditBackgroundOp) => ipcRenderer.invoke('slides:edit-background', op),
  pickPictureFile: () => ipcRenderer.invoke('slides:pick-picture-file'),
  insertImage: (slideIndex: number, fitWidthPx: number) =>
    ipcRenderer.invoke('slides:insert-image', slideIndex, fitWidthPx),
  copySlide: (slideIndex: number, pngBase64?: string) =>
    ipcRenderer.invoke('slides:copy-slide', slideIndex, pngBase64),
  pasteSlide: (op: PasteSlideOp) => ipcRenderer.invoke('slides:paste-slide', op),
  repasteSlide: (op: RepasteSlideOp) => ipcRenderer.invoke('slides:repaste-slide', op),
  hasSlideClipboard: () => ipcRenderer.invoke('slides:has-slide-clipboard'),
  clipboardProbe: () => ipcRenderer.invoke('slides:clipboard-probe'),
  deleteSlide: (slideIndex: number) => ipcRenderer.invoke('slides:delete-slide', slideIndex),
  reorderElement: (op: ReorderElementOp) => ipcRenderer.invoke('slides:reorder-element', op),
  editTableCell: (op: EditTableCellOp) => ipcRenderer.invoke('slides:edit-table-cell', op),
  tableStructure: (op: TableStructureIpcOp) => ipcRenderer.invoke('slides:table-structure', op),
  tableMerge: (op: TableMergeIpcOp) => ipcRenderer.invoke('slides:table-merge', op),
  setTableColWidth: (op: SetTableColWidthOp) =>
    ipcRenderer.invoke('slides:set-table-col-width', op),
  setTableRowHeight: (op: SetTableRowHeightOp) =>
    ipcRenderer.invoke('slides:set-table-row-height', op),
  setTableCellAnchor: (op: SetTableCellAnchorOp) =>
    ipcRenderer.invoke('slides:set-table-cell-anchor', op),
  editTableStyle: (op: EditTableStyleOp) => ipcRenderer.invoke('slides:edit-table-style', op),
  editChart: (op: EditChartOp) => ipcRenderer.invoke('slides:edit-chart', op),
  getChartColorSchemes: () => ipcRenderer.invoke('slides:chart-color-schemes'),
  getChartData: (slideIndex: number, sourceId: string) =>
    ipcRenderer.invoke('slides:get-chart-data', slideIndex, sourceId),
  copyElements: (op: CopyElementsOp) => ipcRenderer.invoke('slides:copy-elements', op),
  copyElementsImage: (clipboardToken: string, pngBase64: string) =>
    ipcRenderer.invoke('slides:copy-elements-image', clipboardToken, pngBase64),
  pasteElements: (op: PasteElementsOp) => ipcRenderer.invoke('slides:paste-elements', op),
  duplicateElements: (op: DuplicateElementsOp) =>
    ipcRenderer.invoke('slides:duplicate-elements', op),
  addTable: (op: AddTableOp) => ipcRenderer.invoke('slides:add-table', op),
  addInk: (op: AddInkOp) => ipcRenderer.invoke('slides:add-ink', op),
  addChart: (op: AddChartOp) => ipcRenderer.invoke('slides:add-chart', op),
  addSmartArt: (op: AddSmartArtOp) => ipcRenderer.invoke('slides:add-smartart', op),
  addImageBytes: (op: AddImageBytesOp) => ipcRenderer.invoke('slides:add-image-bytes', op),
  getEchart: (op: { slideIndex: number; elementId: string }) =>
    ipcRenderer.invoke('slides:get-echart', op),
  updateEchart: (op: {
    slideIndex: number
    elementId: string
    base64: string
    optionJson: string
    code?: string
    title?: string
    data?: { columns: string[]; rows: Array<Array<string | number | null>> }
  }) => ipcRenderer.invoke('slides:update-echart', op),
  addEchart: (op: {
    slideIndex: number
    fitWidthPx: number
    xPx: number
    yPx: number
    wPx: number
    hPx: number
    base64: string
    optionJson: string
    groupId: string
    title?: string
    code?: string
    data?: { columns: string[]; rows: Array<Array<string | number | null>> }
  }) => ipcRenderer.invoke('slides:add-echart', op),
  replacePictureBytes: (op: ReplacePictureBytesOp) =>
    ipcRenderer.invoke('slides:replace-picture-bytes', op),
  insertMedia: (slideIndex: number, kind: 'video' | 'audio', fitWidthPx: number) =>
    ipcRenderer.invoke('slides:insert-media', slideIndex, kind, fitWidthPx),
  addMediaBytes: (op: AddMediaBytesOp) => ipcRenderer.invoke('slides:add-media-bytes', op),
  getMediaData: (slideIndex: number, sourceId: string) =>
    ipcRenderer.invoke('slides:media-data', slideIndex, sourceId),
  insertModel3d: (slideIndex: number, fitWidthPx: number) =>
    ipcRenderer.invoke('slides:insert-model3d', slideIndex, fitWidthPx),
  setLink: (op: SetLinkOp) => ipcRenderer.invoke('slides:set-link', op),
  getLink: (slideIndex: number, sourceId: string) =>
    ipcRenderer.invoke('slides:get-link', slideIndex, sourceId),
  getSlideLinks: (slideIndex: number) => ipcRenderer.invoke('slides:get-slide-links', slideIndex),
  getRunLinks: (slideIndex: number) => ipcRenderer.invoke('slides:get-run-links', slideIndex),
  applyHeaderFooter: (op: HeaderFooterOp) => ipcRenderer.invoke('slides:apply-header-footer', op),
  getHeaderFooter: (slideIndex: number) =>
    ipcRenderer.invoke('slides:get-header-footer', slideIndex),
  applyTheme: (op: ApplyThemeOp) => ipcRenderer.invoke('slides:apply-theme', op),
  setTransition: (op: SetTransitionOp) => ipcRenderer.invoke('slides:set-transition', op),
  getTransition: (slideIndex: number) => ipcRenderer.invoke('slides:get-transition', slideIndex),
  getTransitionSpec: (slideIndex: number) =>
    ipcRenderer.invoke('slides:get-transition-spec', slideIndex),
  getTransitionSound: (slideIndex: number) =>
    ipcRenderer.invoke('slides:get-transition-sound', slideIndex),
  getShowSettings: () => ipcRenderer.invoke('slides:get-show-settings'),
  setShowSettings: (settings: { loop: boolean }) =>
    ipcRenderer.invoke('slides:set-show-settings', settings),
  setAdvanceTimes: (op: SetAdvanceTimesOp) => ipcRenderer.invoke('slides:set-advance-times', op),
  getAdvanceTime: (slideIndex: number) => ipcRenderer.invoke('slides:get-advance-time', slideIndex),
  getAnimations: (slideIndex: number) => ipcRenderer.invoke('slides:get-animations', slideIndex),
  getShapeKeys: (slideIndex: number) => ipcRenderer.invoke('slides:get-shape-keys', slideIndex),
  setAnimations: (op: SetAnimationsOp) => ipcRenderer.invoke('slides:set-animations', op),
  setSlideHidden: (op: SetSlideHiddenOp) => ipcRenderer.invoke('slides:set-hidden', op),
  getSections: () => ipcRenderer.invoke('slides:get-sections'),
  setSections: (sections: SectionInfo[]) => ipcRenderer.invoke('slides:set-sections', sections),
  addSection: (op: AddSectionOp) => ipcRenderer.invoke('slides:add-section', op),
  renameSection: (op: RenameSectionOp) => ipcRenderer.invoke('slides:rename-section', op),
  removeSection: (op: RemoveSectionOp) => ipcRenderer.invoke('slides:remove-section', op),
  moveSection: (op: MoveSectionOp) => ipcRenderer.invoke('slides:move-section', op),
  moveSlide: (op: MoveSlideOp) => ipcRenderer.invoke('slides:move-slide', op),
  getNotes: (slideIndex: number) => ipcRenderer.invoke('slides:get-notes', slideIndex),
  setNotes: (op) => ipcRenderer.invoke('slides:set-notes', op),
  getComments: (slideIndex: number) => ipcRenderer.invoke('slides:get-comments', slideIndex),
  addComment: (op) => ipcRenderer.invoke('slides:add-comment', op),
  deleteComment: (op) => ipcRenderer.invoke('slides:delete-comment', op),
  nativeClipboard: (op: 'cut' | 'copy' | 'paste') =>
    ipcRenderer.invoke('slides:native-clipboard', op),
  beginHistoryBatch: () => ipcRenderer.invoke('slides:history-batch-begin'),
  endHistoryBatch: () => ipcRenderer.invoke('slides:history-batch-end'),
  applyEditScript: (op: ApplyEditScriptOp) => ipcRenderer.invoke('slides:apply-edit-script', op),
  applyTxn: (op: ApplyTxnOp) => ipcRenderer.invoke('slides:apply-txn', op),
  aiSnapshotRestore: (id: number) => ipcRenderer.invoke('slides:ai-snapshot-restore', id),
  undo: () => ipcRenderer.invoke('slides:undo'),
  redo: () => ipcRenderer.invoke('slides:redo'),
  pickExportDir: () => ipcRenderer.invoke('slides:pick-export-dir'),
  exportImages: (op: ExportImagesOp) => ipcRenderer.invoke('slides:export-images', op),
  pickExportPdfPath: (defaultName: string) =>
    ipcRenderer.invoke('slides:pick-export-pdf-path', defaultName),
  exportPdf: (op: ExportPdfOp) => ipcRenderer.invoke('slides:export-pdf', op),
  printSlides: (op: PrintSlidesOp) => ipcRenderer.invoke('slides:print', op),
  save: () => ipcRenderer.invoke('slides:save'),
  saveAs: (defaultName: string) => ipcRenderer.invoke('slides:save-as', defaultName),
  onCloseSaveRequest: (handler: () => void) => {
    const listener = () => handler()
    ipcRenderer.on('slides:close-save-request', listener)
    return () => ipcRenderer.removeListener('slides:close-save-request', listener)
  },
  onHistoryChanged: (handler: (state: { canUndo: boolean; canRedo: boolean }) => void) => {
    const listener = (_e: IpcRendererEvent, state: { canUndo: boolean; canRedo: boolean }) =>
      handler(state)
    ipcRenderer.on('slides:history-changed', listener)
    return () => ipcRenderer.removeListener('slides:history-changed', listener)
  },
  onDeckChanged: (
    handler: (state: { slides: RenderSlide[]; size: { cx: number; cy: number } }) => void,
  ) => {
    const listener = (
      _e: IpcRendererEvent,
      state: { slides: RenderSlide[]; size: { cx: number; cy: number } },
    ) => handler(state)
    ipcRenderer.on('slides:deck-changed', listener)
    return () => ipcRenderer.removeListener('slides:deck-changed', listener)
  },
  reportCloseSaveResult: (ok: boolean) => ipcRenderer.send('slides:close-save-result', ok === true),
  setAutoSavePref: (on: boolean) => ipcRenderer.send('slides:autosave-pref', on === true),
  isDirty: () => ipcRenderer.invoke('slides:is-dirty'),
  getRecentFiles: () => ipcRenderer.invoke('slides:recent'),
  onMenuCommand: (handler: (command: MenuCommand) => void) => {
    const listener = (_e: IpcRendererEvent, cmd: MenuCommand) => handler(cmd)
    ipcRenderer.on('slides:menu', listener)
    return () => ipcRenderer.removeListener('slides:menu', listener)
  },
  onOpened: (handler: (result: OpenResult) => void) => {
    const listener = (_e: IpcRendererEvent, result: OpenResult) => handler(result)
    ipcRenderer.on('slides:opened', listener)
    return () => ipcRenderer.removeListener('slides:opened', listener)
  },
  onRenamed: (handler: (newPath: string) => void) => {
    const listener = (_e: IpcRendererEvent, newPath: string) => handler(newPath)
    ipcRenderer.on('slides:renamed', listener)
    return () => ipcRenderer.removeListener('slides:renamed', listener)
  },
  getAiSettings: () => ipcRenderer.invoke('ai:get-settings'),
  setAiSettings: (view: AiSettingsV2) => ipcRenderer.invoke('ai:set-settings', view),
  setAiCurrentModel: (selection: AiModelSelection) =>
    ipcRenderer.invoke('ai:set-current-model', selection),
  aiDiscoverModels: (target: DiscoveryTarget) => ipcRenderer.invoke('ai:discover-models', target),
  aiStream: (request: AiStreamWireRequest) => ipcRenderer.invoke('ai:stream', request),
  aiStreamCancel: (requestId: string) => ipcRenderer.invoke('ai:stream-cancel', requestId),
  aiChatOfficeStatus: (withEmail?: boolean) =>
    ipcRenderer.invoke('ai:chatoffice-status', withEmail),
  aiChatOfficeLogin: () => ipcRenderer.invoke('ai:chatoffice-login'),
  aiLocalToolStatus: (vendorId: string) => ipcRenderer.invoke('ai:local-tool-status', vendorId),
  aiLocalToolInstall: (vendorId: string, onLine?: (line: string) => void) => {
    if (!onLine) return ipcRenderer.invoke('ai:local-tool-install', vendorId)
    const ch = (_e: IpcRendererEvent, vid: string, line: string) => {
      if (vid === vendorId) onLine(line)
    }
    ipcRenderer.on('ai:local-tool-progress', ch)
    return ipcRenderer
      .invoke('ai:local-tool-install', vendorId)
      .finally(() => ipcRenderer.removeListener('ai:local-tool-progress', ch))
  },
  aiLocalToolStart: (vendorId: string) => ipcRenderer.invoke('ai:local-tool-start', vendorId),
  aiLogRunFailure: (entry: AiRunFailure) => ipcRenderer.invoke('ai:log-run-failure', entry),
  webSearch: (query: string, maxResults?: number) =>
    ipcRenderer.invoke('ai:web-search', query, maxResults),
  imageSearch: (query: string, maxResults?: number) =>
    ipcRenderer.invoke('ai:image-search', query, maxResults),
  pickImageFolder: () => ipcRenderer.invoke('slides:pick-image-folder'),
  stockImageSearch: (source: string, query: string, maxResults?: number, page?: number) =>
    ipcRenderer.invoke('ai:stock-image-search', { source, query, maxResults, page }),
  stockKeysGet: () => ipcRenderer.invoke('ai:stock-keys-get'),
  stockKeysSet: (keys: { pexels?: string; pixabay?: string; unsplash?: string }) =>
    ipcRenderer.invoke('ai:stock-keys-set', keys),
  webImageSearch: (query: string, maxResults?: number, page?: number, source?: string) =>
    ipcRenderer.invoke('ai:web-image-search', query, maxResults, page, source),
  remoteImage: (url: string) => ipcRenderer.invoke('ai:remote-image', url),
  mediaModels: () => ipcRenderer.invoke('ai:media-models'),
  generateSvg: (req: { profileId?: string; modelId?: string; prompt: string }) =>
    ipcRenderer.invoke('ai:generate-svg', req),
  mediaGenerate: (req: {
    profileId?: string
    modelId?: string
    prompt: string
    params?: Record<string, unknown>
  }) => ipcRenderer.invoke('ai:media-generate', req),
  videoSubmit: (req: {
    profileId: string
    modelId: string
    label?: string
    prompt: string
    params?: Record<string, unknown>
  }) => ipcRenderer.invoke('ai:video-submit', req),
  videoTasks: () => ipcRenderer.invoke('ai:video-tasks'),
  videoCancel: (id: string) => ipcRenderer.invoke('ai:video-cancel', id),
  videoRetry: (id: string) => ipcRenderer.invoke('ai:video-retry', id),
  videoPreview: (id: string) => ipcRenderer.invoke('ai:video-preview', id),
  onVideoTasksChanged: (handler: (payload: { id: string; status: string }) => void) => {
    const listener = (_event: IpcRendererEvent, payload: { id: string; status: string }) =>
      handler(payload)
    ipcRenderer.on('ai:video-tasks-changed', listener)
    return () => ipcRenderer.removeListener('ai:video-tasks-changed', listener)
  },
  insertImageUrl: (op: {
    slideIndex: number
    url?: string
    /** raw base64 of a user attachment (attachment:// reference) — no network fetch */
    base64?: string
    ext?: string
    xPx: number
    yPx: number
    wPx: number
    hPx: number
    fitWidthPx: number
  }) => ipcRenderer.invoke('ai:insert-image-url', op),
  replacePictureUrl: (op: {
    slideIndex: number
    sourceId: string
    url?: string
    /** raw base64 of a user attachment (attachment:// reference) — no network fetch */
    base64?: string
    ext?: string
    keepSrcRect?: boolean
  }) => ipcRenderer.invoke('ai:replace-picture-url', op),
  generateImage: (op: {
    prompt: string
    model?: string
    referenceImageUrls?: string[]
    aspectRatio?: string
    imageSize?: string
    transparentBackground?: boolean
  }) => ipcRenderer.invoke('ai:generate-image', op),
  readUrl: (url: string) => ipcRenderer.invoke('ai:read-url', url),
  generateVideo: (op: {
    prompt: string
    imageUrl?: string
    aspectRatio?: string
    durationSeconds?: number
  }) => ipcRenderer.invoke('ai:generate-video', op),
  analyzeMedia: (op: { mediaUrls: string[]; requirements: string }) =>
    ipcRenderer.invoke('ai:analyze-media', op),
  chatofficeStatus: () => ipcRenderer.invoke('ai:chatoffice-status'),
  onAiStream: (handler: (chunk: AiStreamChunk) => void) => {
    const listener = (_e: IpcRendererEvent, chunk: AiStreamChunk) => handler(chunk)
    ipcRenderer.on('ai:stream-chunk', listener)
    return () => ipcRenderer.removeListener('ai:stream-chunk', listener)
  },
  saveStyleSidecar: (data: { topic: string; styleSkill: string; createdAt: string }) =>
    ipcRenderer.invoke('ai:save-sidecar', data),
  saveStyleTemplate: (
    name: string,
    data: { topic: string; styleSkill: string; createdAt: string },
  ) => ipcRenderer.invoke('ai:save-style-template', name, data),
  listStyleTemplates: () => ipcRenderer.invoke('ai:list-style-templates'),
  loadStyleTemplate: (name: string) => ipcRenderer.invoke('ai:load-style-template', name),
  presenterStart: (displayId?: number | null) =>
    ipcRenderer.invoke('slides:presenter-start', displayId),
  presenterSync: (state: ShowSyncState) => ipcRenderer.send('slides:presenter-sync', state),
  presenterInk: (ev: ShowInkEvent) => ipcRenderer.send('slides:presenter-ink', ev),
  presenterSwap: () => ipcRenderer.invoke('slides:presenter-swap'),
  presenterEnd: () => ipcRenderer.invoke('slides:presenter-end'),
  audienceReady: () => ipcRenderer.invoke('slides:audience-ready'),
  audienceNav: (action: AudienceNavAction) => ipcRenderer.send('slides:audience-nav', action),
  onShowSync: (handler: (state: ShowSyncState) => void) => {
    const listener = (_e: IpcRendererEvent, state: ShowSyncState) => handler(state)
    ipcRenderer.on('slides:show-sync', listener)
    return () => ipcRenderer.removeListener('slides:show-sync', listener)
  },
  onShowInk: (handler: (ev: ShowInkEvent) => void) => {
    const listener = (_e: IpcRendererEvent, ev: ShowInkEvent) => handler(ev)
    ipcRenderer.on('slides:show-ink', listener)
    return () => ipcRenderer.removeListener('slides:show-ink', listener)
  },
  onAudienceNav: (handler: (action: AudienceNavAction) => void) => {
    const listener = (_e: IpcRendererEvent, action: AudienceNavAction) => handler(action)
    ipcRenderer.on('slides:audience-nav', listener)
    return () => ipcRenderer.removeListener('slides:audience-nav', listener)
  },
}

contextBridge.exposeInMainWorld('slidesApi', api)

// Chat attachment bridge: method names/signatures match the window.desktop attachment subset in docs, so the renderer's files-skill is copied over wholesale
const filesApi: DesktopFilesApi = {
  pickAttachments: () => ipcRenderer.invoke('slides:files-pick'),
  addAttachmentPaths: (paths: string[]) => ipcRenderer.invoke('slides:files-add', paths),
  addPastedImage: (data: ArrayBuffer, ext: string) =>
    ipcRenderer.invoke('slides:files-add-pasted-image', data, ext),
  readAttachment: (path: string, offset: number, maxChars: number) =>
    ipcRenderer.invoke('slides:files-read', path, offset, maxChars),
  readAttachmentImage: (path: string) => ipcRenderer.invoke('slides:files-read-image', path),
  readAttachmentMedia: (path: string) => ipcRenderer.invoke('slides:files-read-media', path),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
}

contextBridge.exposeInMainWorld('desktop', filesApi)

const projectApi: ProjectApi = {
  resolveChat: (args) => ipcRenderer.invoke('project:resolveChat', args),
  appendChat: (args) => ipcRenderer.invoke('project:appendChat', args),
  loadChat: (args) => ipcRenderer.invoke('project:loadChat', args),
  rebindChat: (args) => ipcRenderer.invoke('project:rebindChat', args),
  // P1 extensions
  listProjects: () => ipcRenderer.invoke('project:list'),
  createProject: (args) => ipcRenderer.invoke('project:create', args),
  renameProject: (args) => ipcRenderer.invoke('project:rename', args),
  deleteProject: (args) => ipcRenderer.invoke('project:delete', args),
  moveFile: (args) => ipcRenderer.invoke('project:moveFile', args),
  getTimeline: (args) => ipcRenderer.invoke('project:timeline', args),
}
contextBridge.exposeInMainWorld('projectApi', projectApi)

// open documents dragged from the OS onto this tab as a new shell tab
installDropOpenBridge()
// folder tree over the default save folder (Files pane)
installFilesPaneBridge()

// Knowledge-base read surface (docs/kb-integration-plan.md): one dedicated
// global so every app shell / editor window shares the same facade contract.
contextBridge.exposeInMainWorld('chatOfficeKb', {
  discover: () => ipcRenderer.invoke(KB_CHANNELS.discover),
  search: (args: { kbIds: string[]; q: string; topK?: number }) =>
    ipcRenderer.invoke(KB_CHANNELS.search, args),
  doc: (args: { kbId: string; docId: string }) => ipcRenderer.invoke(KB_CHANNELS.doc, args),
  file: (args: { kbId: string; docId: string }) => ipcRenderer.invoke(KB_CHANNELS.file, args),
  getSource: () => ipcRenderer.invoke(KB_CHANNELS.getSource),
  setOrigin: (origin: string | null) => ipcRenderer.invoke(KB_CHANNELS.setOrigin, origin),
})
