import type { ModelSettingsBridge } from '@chatoffice/ui/ModelSettingsPage'

/** the html preload bridge over the app-wide ai:* channels */
export const htmlModelBridge: ModelSettingsBridge = {
  getSettings: () => window.htmlApi.getAiSettings(),
  saveSettings: (view) => window.htmlApi.setAiSettings(view),
  setCurrentModel: (selection) => window.htmlApi.setAiCurrentModel(selection),
  discoverModels: (target) => window.htmlApi.aiDiscoverModels(target),
  chatofficeStatus: (withEmail) => window.htmlApi.aiChatOfficeStatus(withEmail),
  chatofficeLogin: () => window.htmlApi.aiChatOfficeLogin(),
  localToolStatus: (vendorId) => window.htmlApi.aiLocalToolStatus(vendorId),
  localToolInstall: (vendorId, onLine) => window.htmlApi.aiLocalToolInstall(vendorId, onLine),
  localToolStart: (vendorId) => window.htmlApi.aiLocalToolStart(vendorId),
}
