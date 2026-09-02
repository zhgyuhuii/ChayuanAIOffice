import type { ModelSettingsBridge } from '@genoffice/ui'

/** the markdown preload bridge over the app-wide ai:* channels */
export const markdownModelBridge: ModelSettingsBridge = {
  getSettings: () => window.markdownApi.getAiSettings(),
  saveSettings: (view) => window.markdownApi.setAiSettings(view),
  setCurrentModel: (selection) => window.markdownApi.setAiCurrentModel(selection),
  discoverModels: (target) => window.markdownApi.aiDiscoverModels(target),
  gskStatus: (withEmail) => window.markdownApi.aiGskStatus(withEmail),
  gskLogin: () => window.markdownApi.aiGskLogin(),
}
