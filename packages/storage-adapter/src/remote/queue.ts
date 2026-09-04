/**
 * Pending sync queue (plan consensus Q5/Q6): when an auto-save to the remote
 * default location fails, the latest bytes land in a per-document slot on
 * local disk (atomic tmp+rename), and flush retries push them to the bucket.
 *
 * The queue is deliberately dumb: one slot per document (latest bytes win),
 * the slot files on disk are the only state (startup recovery = constructing
 * the queue again), and conflicts are never resolved silently — a flush that
 * finds the remote changed reports the slot back for user adjudication.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, renameSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { RemoteStorageClient } from './client.js'

export interface QueueSlotMeta {
  configId: string
  key: string
  /** ETag the document was loaded with; null for brand-new remote files. */
  expectedEtag: string | null
  queuedAtMs: number
  sizeBytes: number
}

export type FlushOutcome =
  | { slot: QueueSlotMeta; outcome: 'synced'; etag: string }
  | { slot: QueueSlotMeta; outcome: 'conflict'; currentEtag: string | null }
  | { slot: QueueSlotMeta; outcome: 'error'; message: string }

interface SlotPayload extends QueueSlotMeta {
  base64: string
}

export interface PendingSyncQueue {
  /** Writes the document's slot atomically; overwrites any previous pending bytes. */
  enqueue(configId: string, key: string, bytes: Uint8Array, expectedEtag: string | null): void
  /** Drops the slot (user chose to keep the remote version or gave up). */
  discard(configId: string, key: string): void
  /** Pending slots, newest last; optionally filtered by config. Payload bytes excluded. */
  status(configId?: string): QueueSlotMeta[]
  /**
   * Flushes pending slots against the bucket. Conflict slots stay queued —
   * `force: true` pushes them anyway (the "overwrite" adjudication).
   */
  flush(options?: { configId?: string; key?: string; force?: boolean }): Promise<FlushOutcome[]>
}

export interface PendingSyncQueueParams {
  /** Directory holding the `<sha256>.json` slot files. */
  dir: string
  /** Resolves the client for a config; throw here marks the slot errored. */
  resolveClient: (configId: string) => RemoteStorageClient
}

export function createPendingSyncQueue(params: PendingSyncQueueParams): PendingSyncQueue {
  function slotFile(configId: string, key: string): string {
    const digest = createHash('sha256').update(`${configId}/${key}`).digest('hex')
    return join(params.dir, `${digest}.json`)
  }

  function readSlot(file: string): SlotPayload | null {
    try {
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<SlotPayload>
      if (
        typeof raw.configId !== 'string' ||
        typeof raw.key !== 'string' ||
        typeof raw.base64 !== 'string'
      )
        return null
      return {
        configId: raw.configId,
        key: raw.key,
        expectedEtag: typeof raw.expectedEtag === 'string' ? raw.expectedEtag : null,
        queuedAtMs: typeof raw.queuedAtMs === 'number' ? raw.queuedAtMs : 0,
        sizeBytes: typeof raw.sizeBytes === 'number' ? raw.sizeBytes : 0,
        base64: raw.base64,
      }
    } catch {
      return null
    }
  }

  function allSlots(): { file: string; slot: SlotPayload }[] {
    let entries: string[]
    try {
      entries = readdirSync(params.dir)
    } catch {
      return []
    }
    const out: { file: string; slot: SlotPayload }[] = []
    for (const entry of entries) {
      if (!entry.endsWith('.json') || entry.includes('.tmp-')) continue
      const file = join(params.dir, entry)
      const slot = readSlot(file)
      if (slot) out.push({ file, slot })
    }
    // Same-millisecond enqueues tie on queuedAtMs — break ties by key so the
    // processing order (and flush outcome order) is deterministic.
    out.sort(
      (a, b) =>
        a.slot.queuedAtMs - b.slot.queuedAtMs ||
        (a.slot.key < b.slot.key ? -1 : a.slot.key > b.slot.key ? 1 : 0),
    )
    return out
  }

  return {
    enqueue(configId, key, bytes, expectedEtag) {
      mkdirSync(params.dir, { recursive: true })
      const payload: SlotPayload = {
        configId,
        key,
        expectedEtag,
        queuedAtMs: Date.now(),
        sizeBytes: bytes.length,
        base64: Buffer.from(bytes).toString('base64'),
      }
      const file = slotFile(configId, key)
      const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
      writeFileSync(tmp, JSON.stringify(payload), { encoding: 'utf8', mode: 0o600 })
      renameSync(tmp, file)
    },

    discard(configId, key) {
      rmSync(slotFile(configId, key), { force: true })
    },

    status(configId) {
      return allSlots()
        .filter((entry) => !configId || entry.slot.configId === configId)
        .map((entry) => ({
          configId: entry.slot.configId,
          key: entry.slot.key,
          expectedEtag: entry.slot.expectedEtag,
          queuedAtMs: entry.slot.queuedAtMs,
          sizeBytes: entry.slot.sizeBytes,
        }))
    },

    async flush(options = {}) {
      const outcomes: FlushOutcome[] = []
      for (const { file, slot } of allSlots()) {
        if (options.configId && slot.configId !== options.configId) continue
        if (options.key && slot.key !== options.key) continue
        try {
          const client = params.resolveClient(slot.configId)
          if (!options.force && slot.expectedEtag !== null) {
            const head = await client.headObject(slot.key)
            if (head === null || head.etag !== slot.expectedEtag) {
              outcomes.push({
                slot,
                outcome: 'conflict',
                currentEtag: head === null ? null : head.etag,
              })
              continue
            }
          }
          const put = await client.putObject(slot.key, Buffer.from(slot.base64, 'base64'))
          rmSync(file, { force: true })
          outcomes.push({ slot, outcome: 'synced', etag: put.etag })
        } catch (error) {
          outcomes.push({
            slot,
            outcome: 'error',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      }
      return outcomes
    },
  }
}
