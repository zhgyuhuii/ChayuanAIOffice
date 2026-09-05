import type { ModelSettingsBridge } from '@chatoffice/ui'

/** the slides preload bridge over the app-wide ai:* channels */
export const slidesModelBridge: ModelSettingsBridge = {
  getSettings: () => window.slidesApi.getAiSettings(),
  saveSettings: (view) => window.slidesApi.setAiSettings(view),
  setCurrentModel: (selection) => window.slidesApi.setAiCurrentModel(selection),
  discoverModels: (target) => window.slidesApi.aiDiscoverModels(target),
  chatofficeStatus: (withEmail) => window.slidesApi.aiChatOfficeStatus(withEmail),
  chatofficeLogin: () => window.slidesApi.aiChatOfficeLogin(),
}
