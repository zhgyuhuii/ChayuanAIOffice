import type { ModelSettingsBridge } from '@chatoffice/ui/ModelSettingsPage'

/** the pdf preload bridge over the app-wide ai:* channels */
export const pdfModelBridge: ModelSettingsBridge = {
  getSettings: () => window.pdfApi.getAiSettings(),
  saveSettings: (view) => window.pdfApi.setAiSettings(view),
  setCurrentModel: (selection) => window.pdfApi.setAiCurrentModel(selection),
  discoverModels: (target) => window.pdfApi.aiDiscoverModels(target),
  chatofficeStatus: (withEmail) => window.pdfApi.chatofficeStatus(withEmail),
  chatofficeLogin: () => window.pdfApi.aiChatOfficeLogin(),
  localToolStatus: (vendorId) => window.pdfApi.aiLocalToolStatus(vendorId),
  localToolInstall: (vendorId, onLine) => window.pdfApi.aiLocalToolInstall(vendorId, onLine),
  localToolStart: (vendorId) => window.pdfApi.aiLocalToolStart(vendorId),
}
