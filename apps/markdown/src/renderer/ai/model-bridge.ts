import type { ModelSettingsBridge } from '@chaoffice/ui/ModelSettingsPage'

/** the markdown preload bridge over the app-wide ai:* channels */
export const markdownModelBridge: ModelSettingsBridge = {
  getSettings: () => window.markdownApi.getAiSettings(),
  saveSettings: (view) => window.markdownApi.setAiSettings(view),
  setCurrentModel: (selection) => window.markdownApi.setAiCurrentModel(selection),
  discoverModels: (target) => window.markdownApi.aiDiscoverModels(target),
  chaofficeStatus: (withEmail) => window.markdownApi.aiChaOfficeStatus(withEmail),
  chaofficeLogin: () => window.markdownApi.aiChaOfficeLogin(),
  localToolStatus: (vendorId) => window.markdownApi.aiLocalToolStatus(vendorId),
  localToolInstall: (vendorId, onLine) => window.markdownApi.aiLocalToolInstall(vendorId, onLine),
  localToolStart: (vendorId) => window.markdownApi.aiLocalToolStart(vendorId),
}
