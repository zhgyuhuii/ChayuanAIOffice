import type { ModelSettingsBridge } from '@chatoffice/ui'

/** the docs preload bridge over the app-wide ai:* channels */
export const docsModelBridge: ModelSettingsBridge = {
  getSettings: () => window.desktop.getAiSettings(),
  saveSettings: (view) => window.desktop.setAiSettings(view),
  setCurrentModel: (selection) => window.desktop.setAiCurrentModel(selection),
  discoverModels: (target) => window.desktop.aiDiscoverModels(target),
  chatofficeStatus: (withEmail) => window.desktop.aiChatOfficeStatus(withEmail),
  chatofficeLogin: () => window.desktop.aiChatOfficeLogin(),
}
