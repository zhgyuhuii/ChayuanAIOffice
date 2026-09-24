/**
 * Editor shims install preload-shaped globals; typed loosely here so the
 * bridge package stays independent of each app's shared ipc types.
 */
export {}

declare global {
  interface Window {
    markdownApi?: { [method: string]: unknown }
    desktop?: unknown
    chatOffice?: { [method: string]: unknown }
    chatOfficeProject?: { [method: string]: unknown }
    chatOfficeTabs?: { [method: string]: unknown }
  }
}
