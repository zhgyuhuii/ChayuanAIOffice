import type { ModelSettingsBridge } from '@chaoffice/ui/ModelSettingsPage'

/** the html preload bridge over the app-wide ai:* channels */
export const htmlModelBridge: ModelSettingsBridge = {
  getSettings: () => window.htmlApi.getAiSettings(),
  saveSettings: (view) => window.htmlApi.setAiSettings(view),
  setCurrentModel: (selection) => window.htmlApi.setAiCurrentModel(selection),
  discoverModels: (target) => window.htmlApi.aiDiscoverModels(target),
  chaofficeStatus: (withEmail) => window.htmlApi.aiChaOfficeStatus(withEmail),
  chaofficeLogin: () => window.htmlApi.aiChaOfficeLogin(),
  localToolStatus: (vendorId) => window.htmlApi.aiLocalToolStatus(vendorId),
  localToolInstall: (vendorId, onLine) => window.htmlApi.aiLocalToolInstall(vendorId, onLine),
  localToolStart: (vendorId) => window.htmlApi.aiLocalToolStart(vendorId),
}
