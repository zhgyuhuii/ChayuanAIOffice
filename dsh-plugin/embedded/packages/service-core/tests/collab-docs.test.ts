import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { openLocalArea } from '@chatoffice/storage-adapter'
import { createCollabDocsApi } from '../src/index.js'

const dirs: string[] = []

function tempArea() {
  const dir = mkdtempSync(join(tmpdir(), 'chatoffice-collab-'))
  dirs.push(dir)
  return openLocalArea({ rootDir: dir })
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

/** Simulates a client editing a Y.Text and shipping its update to the service. */
function clientEdit(text: string, insert: string, at = text.length): Uint8Array {
  const doc = new Y.Doc()
  doc.getText('content').insert(0, text)
  const before = Y.encodeStateVector(doc)
  doc.getText('content').insert(at, insert)
  return Y.encodeStateAsUpdate(doc, before)
}

describe('collabDocs service', () => {
  it('applies updates from two clients and merges both edits', () => {
    const api = createCollabDocsApi({ area: tempArea() })
    api.applyUpdate('doc1', clientEdit('', 'hello '))
    api.applyUpdate('doc1', clientEdit('', 'world'))
    const merged = new Y.Doc()
    Y.applyUpdate(merged, api.getState('doc1'))
    expect(merged.getText('content').toString()).toContain('hello ')
    expect(merged.getText('content').toString()).toContain('world')
    expect(api.frameCount('doc1')).toBe(2)
  })

  it('persists the update log and rebuilds state from a fresh instance', () => {
    const area = tempArea()
    createCollabDocsApi({ area }).applyUpdate('doc2', clientEdit('', 'persisted'))
    const revived = new Y.Doc()
    Y.applyUpdate(revived, createCollabDocsApi({ area }).getState('doc2'))
    expect(revived.getText('content').toString()).toBe('persisted')
  })

  it('computes minimal diffs for late joiners via state vectors', () => {
    const api = createCollabDocsApi({ area: tempArea() })
    api.applyUpdate('doc3', clientEdit('', 'full history'))
    const client = new Y.Doc() // knows nothing
    const diff = api.getDiff('doc3', Y.encodeStateVector(client))
    Y.applyUpdate(client, diff)
    expect(client.getText('content').toString()).toBe('full history')
    // An up-to-date client gets an empty diff
    expect(api.getDiff('doc3', Y.encodeStateVector(client)).length).toBeLessThanOrEqual(2)
  })
})
