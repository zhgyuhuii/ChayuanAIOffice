import type { ModelSettingsBridge } from '@chatoffice/ui/ModelSettingsPage'

/** the docs preload bridge over the app-wide ai:* channels */
export const docsModelBridge: ModelSettingsBridge = {
  getSettings: () => window.desktop.getAiSettings(),
  saveSettings: (view) => window.desktop.setAiSettings(view),
  setCurrentModel: (selection) => window.desktop.setAiCurrentModel(selection),
  discoverModels: (target) => window.desktop.aiDiscoverModels(target),
  chatofficeStatus: (withEmail) => window.desktop.aiChatOfficeStatus(withEmail),
  chatofficeLogin: () => window.desktop.aiChatOfficeLogin(),
  localToolStatus: (vendorId) => window.desktop.aiLocalToolStatus(vendorId),
  localToolInstall: (vendorId, onLine) => window.desktop.aiLocalToolInstall(vendorId, onLine),
  localToolStart: (vendorId) => window.desktop.aiLocalToolStart(vendorId),
}
