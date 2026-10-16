import type { ModelSettingsBridge } from '@chaoffice/ui/ModelSettingsPage'

/** the docs preload bridge over the app-wide ai:* channels */
export const docsModelBridge: ModelSettingsBridge = {
  getSettings: () => window.desktop.getAiSettings(),
  saveSettings: (view) => window.desktop.setAiSettings(view),
  setCurrentModel: (selection) => window.desktop.setAiCurrentModel(selection),
  discoverModels: (target) => window.desktop.aiDiscoverModels(target),
  chaofficeStatus: (withEmail) => window.desktop.aiChaOfficeStatus(withEmail),
  chaofficeLogin: () => window.desktop.aiChaOfficeLogin(),
  localToolStatus: (vendorId) => window.desktop.aiLocalToolStatus(vendorId),
  localToolInstall: (vendorId, onLine) => window.desktop.aiLocalToolInstall(vendorId, onLine),
  localToolStart: (vendorId) => window.desktop.aiLocalToolStart(vendorId),
}
