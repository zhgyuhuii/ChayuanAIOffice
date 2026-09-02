import type { ModelSettingsBridge } from '@genoffice/ui'

/** the pdf preload bridge over the app-wide ai:* channels */
export const pdfModelBridge: ModelSettingsBridge = {
  getSettings: () => window.pdfApi.getAiSettings(),
  saveSettings: (view) => window.pdfApi.setAiSettings(view),
  setCurrentModel: (selection) => window.pdfApi.setAiCurrentModel(selection),
  discoverModels: (target) => window.pdfApi.aiDiscoverModels(target),
  gskStatus: (withEmail) => window.pdfApi.gskStatus(withEmail),
  gskLogin: () => window.pdfApi.aiGskLogin(),
}
