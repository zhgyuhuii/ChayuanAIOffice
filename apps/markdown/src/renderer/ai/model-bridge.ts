import type { ModelSettingsBridge } from '@chatoffice/ui/ModelSettingsPage'

/** the markdown preload bridge over the app-wide ai:* channels */
export const markdownModelBridge: ModelSettingsBridge = {
  getSettings: () => window.markdownApi.getAiSettings(),
  saveSettings: (view) => window.markdownApi.setAiSettings(view),
  setCurrentModel: (selection) => window.markdownApi.setAiCurrentModel(selection),
  discoverModels: (target) => window.markdownApi.aiDiscoverModels(target),
  chatofficeStatus: (withEmail) => window.markdownApi.aiChatOfficeStatus(withEmail),
  chatofficeLogin: () => window.markdownApi.aiChatOfficeLogin(),
  localToolStatus: (vendorId) => window.markdownApi.aiLocalToolStatus(vendorId),
  localToolInstall: (vendorId, onLine) => window.markdownApi.aiLocalToolInstall(vendorId, onLine),
  localToolStart: (vendorId) => window.markdownApi.aiLocalToolStart(vendorId),
}
