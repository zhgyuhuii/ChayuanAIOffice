import type { ModelSettingsBridge } from '@chatoffice/ui'

/** the slides preload bridge over the app-wide ai:* channels */
export const slidesModelBridge: ModelSettingsBridge = {
  getSettings: () => window.slidesApi.getAiSettings(),
  saveSettings: (view) => window.slidesApi.setAiSettings(view),
  setCurrentModel: (selection) => window.slidesApi.setAiCurrentModel(selection),
  discoverModels: (target) => window.slidesApi.aiDiscoverModels(target),
  gskStatus: (withEmail) => window.slidesApi.aiGskStatus(withEmail),
  gskLogin: () => window.slidesApi.aiGskLogin(),
}
