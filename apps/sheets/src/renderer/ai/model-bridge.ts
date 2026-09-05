import type { ModelSettingsBridge } from '@chatoffice/ui'

/** the sheets preload bridge over the app-wide ai:* channels */
export const sheetsModelBridge: ModelSettingsBridge = {
  getSettings: () => window.desktopApi.getAiSettings(),
  saveSettings: (view) => window.desktopApi.setAiSettings(view),
  setCurrentModel: (selection) => window.desktopApi.setAiCurrentModel(selection),
  discoverModels: (target) => window.desktopApi.aiDiscoverModels(target),
  chatofficeStatus: (withEmail) => window.desktopApi.aiChatOfficeStatus(withEmail),
  chatofficeLogin: () => window.desktopApi.aiChatOfficeLogin(),
}
