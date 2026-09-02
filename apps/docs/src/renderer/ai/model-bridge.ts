import type { ModelSettingsBridge } from '@genoffice/ui'

/** the docs preload bridge over the app-wide ai:* channels */
export const docsModelBridge: ModelSettingsBridge = {
  getSettings: () => window.desktop.getAiSettings(),
  saveSettings: (view) => window.desktop.setAiSettings(view),
  setCurrentModel: (selection) => window.desktop.setAiCurrentModel(selection),
  discoverModels: (target) => window.desktop.aiDiscoverModels(target),
  gskStatus: (withEmail) => window.desktop.aiGskStatus(withEmail),
  gskLogin: () => window.desktop.aiGskLogin(),
}
