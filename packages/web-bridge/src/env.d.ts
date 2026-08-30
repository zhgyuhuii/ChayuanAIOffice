/**
 * Editor shims install preload-shaped globals; typed loosely here so the
 * bridge package stays independent of each app's shared ipc types.
 */
export {}

declare global {
  interface Window {
    markdownApi?: { [method: string]: unknown }
    desktop?: unknown
    aiOffice?: { [method: string]: unknown }
    aiOfficeProject?: { [method: string]: unknown }
    aiOfficeTabs?: { [method: string]: unknown }
  }
}
