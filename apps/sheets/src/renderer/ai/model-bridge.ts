import type { ModelSettingsBridge } from '@genoffice/ui'

/** the sheets preload bridge over the app-wide ai:* channels */
export const sheetsModelBridge: ModelSettingsBridge = {
  getSettings: () => window.desktopApi.getAiSettings(),
  saveSettings: (view) => window.desktopApi.setAiSettings(view),
  setCurrentModel: (selection) => window.desktopApi.setAiCurrentModel(selection),
  discoverModels: (target) => window.desktopApi.aiDiscoverModels(target),
  gskStatus: (withEmail) => window.desktopApi.aiGskStatus(withEmail),
  gskLogin: () => window.desktopApi.aiGskLogin(),
}
