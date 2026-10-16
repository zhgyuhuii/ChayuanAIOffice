import type { ModelSettingsBridge } from '@chaoffice/ui/ModelSettingsPage'

/** the slides preload bridge over the app-wide ai:* channels */
export const slidesModelBridge: ModelSettingsBridge = {
  getSettings: () => window.slidesApi.getAiSettings(),
  saveSettings: (view) => window.slidesApi.setAiSettings(view),
  setCurrentModel: (selection) => window.slidesApi.setAiCurrentModel(selection),
  discoverModels: (target) => window.slidesApi.aiDiscoverModels(target),
  chaofficeStatus: (withEmail) => window.slidesApi.aiChaOfficeStatus(withEmail),
  chaofficeLogin: () => window.slidesApi.aiChaOfficeLogin(),
  localToolStatus: (vendorId) => window.slidesApi.aiLocalToolStatus(vendorId),
  localToolInstall: (vendorId, onLine) => window.slidesApi.aiLocalToolInstall(vendorId, onLine),
  localToolStart: (vendorId) => window.slidesApi.aiLocalToolStart(vendorId),
}
