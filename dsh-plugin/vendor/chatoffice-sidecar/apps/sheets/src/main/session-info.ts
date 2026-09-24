/** Workbook session bookkeeping shared across main/BFF save pipelines. */
export interface SessionInfo {
  readonly path: string
  /// Byte-for-byte copy of the file as it was opened (in the OS temp dir).
  /// Saves patch this snapshot rather than the live path, so an external
  /// overwrite of the file can never corrupt the save base — and Save As
  /// stays usable after one. Removed when the session closes.
  readonly snapshotPath: string
  /// Digest of the snapshot (== the file at open time).
  readonly sha256: string
  readonly sheetNames: ReadonlyMap<string, string>
  readonly automaticRecoveryDisabled: boolean
  /// Set when the session opened a converted copy (.xls/.csv import): the
  /// first save routes through Save As, defaulting to this .xlsx path.
  readonly suggestSaveAs?: string
  /// Shell-created untitled workbook backed by a hidden temp file: the user
  /// never sees this path (first save routes through Save As via suggestSaveAs),
  /// crash-recovery copies stay enabled (unlike converted imports), and the
  /// temp backing file is deleted when the session retargets or closes.
  readonly blankDraft?: boolean
  /// The converted copy came from a CSV: the Save As dialog explains that
  /// formatting requires .xlsx (CSV keeps values only).
  readonly csvImport?: boolean
  /// App-owned directory containing the converted CSV/XLS copy. Removed only
  /// after the sidecar session and its independent snapshot are closed.
  readonly importTempDir?: string
  /// Set when the session opened a restored crash-recovery copy: the restore
  /// prompt was the user's confirmation, so a plain Save silently writes back
  /// to this original path (no Save As detour).
  readonly restoreTarget?: string
  /// Digest of the original file at restore time — guards the silent
  /// write-back against external modification, mirroring the sha256 check on
  /// the session's own path.
  readonly restoreTargetSha?: string
}
