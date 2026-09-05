import type { ModelSettingsBridge } from '@chatoffice/ui'

/** the pdf preload bridge over the app-wide ai:* channels */
export const pdfModelBridge: ModelSettingsBridge = {
  getSettings: () => window.pdfApi.getAiSettings(),
  saveSettings: (view) => window.pdfApi.setAiSettings(view),
  setCurrentModel: (selection) => window.pdfApi.setAiCurrentModel(selection),
  discoverModels: (target) => window.pdfApi.aiDiscoverModels(target),
  chatofficeStatus: (withEmail) => window.pdfApi.chatofficeStatus(withEmail),
  chatofficeLogin: () => window.pdfApi.aiChatOfficeLogin(),
}
