/**
 * Local self-hosted tool probes — the wire shape behind the model-settings
 * "one-click install" card for the 本地与自建 vendor group. The main process
 * fills it per vendor + platform (@chatoffice/ai-host/src/local-tools); the
 * renderer only reads the flags, so this module stays dependency-free.
 */

/** Result of a local-tool status probe (ai:local-tool-status). */
export interface LocalToolStatus {
  /** vendor id from the settings catalog (ollama, lm-studio, codex, …) */
  vendorId: string
  /** this vendor has a local-tool mapping — false = the UI shows no card */
  supported: boolean
  /** binary/app found on this machine */
  installed: boolean
  /** the fixed localhost endpoint answered (service is up) */
  running: boolean
  /** product version when the probe could read one */
  version?: string
  /** main can offer the one-click install on this platform */
  installable: boolean
  /** main can offer to start the local server */
  startable: boolean
  /** short human note (found path, why unsupported, …) */
  detail?: string
}

/** Result of ai:local-tool-install / ai:local-tool-start. */
export interface LocalToolOpResult {
  ok: boolean
  /** final summary line (success note or failure reason) */
  message?: string
}
