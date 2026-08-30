/**
 * genoffice-shell client half (thin shell, plan v2.1 decisions #11/#12).
 *
 * Registers the GenOffice suite as a desktop application via the
 * `dsh.app-registry` slot (APPLICATION-SLOT.md). All heavy lifting — editors,
 * engines, wasm — lives behind the sidecar origin served by the host half;
 * this file stays a few KB and rarely changes release-to-release.
 *
 * Written as a framework-free module so it can be wrapped into the
 * __ModuleLoader__ bundle format by the packaging script without edits.
 */

(function () {
  'use strict'

  var APP_ID = 'ai.genoffice.suite'
  var DEFAULT_ORIGIN = 'http://127.0.0.1:8787' // replaced at build time

  function register(registry, ctx) {
    registry.registerApp({
      id: APP_ID,
      title: 'GenOffice',
      icon: 'genoffice', // icon key resolved by the desktop shell
      open: function (request) {
        var origin = (request && request.origin) || DEFAULT_ORIGIN
        return registry.openWindow({
          appId: APP_ID,
          url: origin + '/',
          // Credentials flow through the sidecar's own session (postMessage
          // handshake once Logto lands); nothing is stored in the shell.
          onReady: function (win) {
            win.postMessage({ type: 'genoffice:hello', appId: APP_ID }, origin)
          },
        })
      },
    })

    // Lifecycle: the plugin's registrations roll back when it unloads
    // (ctx.effect), per the dsh plugin kernel rules.
    if (ctx && ctx.effect) {
      ctx.effect(function () {
        registry.unregisterApp(APP_ID)
      })
    }
  }

  // Export for both bundle wrapping and direct inspection.
  var api = { appId: APP_ID, register: register, defaultOrigin: DEFAULT_ORIGIN }
  if (typeof module !== 'undefined' && module.exports) module.exports = api
  if (typeof window !== 'undefined') window.__genofficeShellPlugin = api
})()
