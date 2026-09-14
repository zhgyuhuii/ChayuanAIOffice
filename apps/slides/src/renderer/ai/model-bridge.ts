import type { ModelSettingsBridge } from '@chatoffice/ui/ModelSettingsPage'

/** the slides preload bridge over the app-wide ai:* channels */
export const slidesModelBridge: ModelSettingsBridge = {
  getSettings: () => window.slidesApi.getAiSettings(),
  saveSettings: (view) => window.slidesApi.setAiSettings(view),
  setCurrentModel: (selection) => window.slidesApi.setAiCurrentModel(selection),
  discoverModels: (target) => window.slidesApi.aiDiscoverModels(target),
  chatofficeStatus: (withEmail) => window.slidesApi.aiChatOfficeStatus(withEmail),
  chatofficeLogin: () => window.slidesApi.aiChatOfficeLogin(),
  localToolStatus: (vendorId) => window.slidesApi.aiLocalToolStatus(vendorId),
  localToolInstall: (vendorId, onLine) => window.slidesApi.aiLocalToolInstall(vendorId, onLine),
  localToolStart: (vendorId) => window.slidesApi.aiLocalToolStart(vendorId),
}
