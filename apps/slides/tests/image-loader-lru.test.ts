// Decoded-image LRU: the loader's `loaded` map used to grow without bound (a
// 409-slide deck held 2.7 GB of decoded bitmaps). These tests pin the budget
// semantics: eviction from the cold end, src release, owner notification,
// recency refresh, mid-batch safety, and reload-after-eviction.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageLoader, MAX_DECODED_IMAGE_BYTES } from '../src/renderer/image-loader'

vi.mock('@chaoffice/docx-engine/metafile', () => ({ metafileToDataUrl: vi.fn() }))

class FakeImage {
  static instances: FakeImage[] = []
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  src = ''
  naturalWidth = 0
  naturalHeight = 0
  constructor() {
    FakeImage.instances.push(this)
  }
}

/** Settle the (single) in-flight image whose src was just assigned, at w×h. */
function decode(src: string, w: number, h: number): void {
  const img = FakeImage.instances.filter((i) => i.src === src).at(-1)!
  img.naturalWidth = w
  img.naturalHeight = h
  img.onload!()
}

const apply = () => vi.fn()

describe('createImageLoader LRU budget', () => {
  beforeEach(() => {
    FakeImage.instances = []
    vi.stubGlobal('Image', FakeImage)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('exports the documented decoded-byte budget', () => {
    expect(MAX_DECODED_IMAGE_BYTES).toBe(128 * 1024 * 1024)
  })

  it('evicts from the cold end once the budget is exceeded, releasing src and notifying', () => {
    const onEvict = vi.fn()
    const a = apply()
    // 1000×1000 RGBA = 4 MB per image; an 8 MB budget keeps exactly two
    const loader = createImageLoader(a, 16, 100, { budgetBytes: 8 * 1024 * 1024, onEvict })
    loader.load(['a', 'b', 'c'])
    decode('a', 1000, 1000)
    decode('b', 1000, 1000)
    vi.runAllTimers()
    expect(onEvict).not.toHaveBeenCalled()
    decode('c', 1000, 1000)
    vi.runAllTimers()
    expect(onEvict).toHaveBeenCalledTimes(1)
    expect(onEvict.mock.calls[0]![0]).toEqual(['a'])
    // The evicted element had its handlers detached and its bitmap released
    const evicted = FakeImage.instances[0]!
    expect(evicted.onload).toBeNull()
    expect(evicted.onerror).toBeNull()
    expect(evicted.src.startsWith('data:image/gif;base64,')).toBe(true)
    // Survivors keep their source
    expect(FakeImage.instances[1]!.src).toBe('b')
    expect(FakeImage.instances[2]!.src).toBe('c')
  })

  it('reloads an evicted url when it is collected again', () => {
    const onEvict = vi.fn()
    const loader = createImageLoader(apply(), 16, 100, { budgetBytes: 8 * 1024 * 1024, onEvict })
    loader.load(['a', 'b', 'c'])
    decode('a', 1000, 1000)
    decode('b', 1000, 1000)
    decode('c', 1000, 1000)
    vi.runAllTimers()
    expect(onEvict.mock.calls[0]![0]).toEqual(['a'])
    expect(FakeImage.instances).toHaveLength(3)
    // An edit re-collects every url: b/c are cached, a decodes again
    loader.load(['a', 'b', 'c'])
    expect(FakeImage.instances).toHaveLength(4)
    decode('a', 1000, 1000)
    vi.runAllTimers()
    // The refreshes left b older than c, and a settled after both: b is the cold end
    expect(onEvict.mock.calls[1]![0]).toEqual(['b'])
  })

  it('refreshes recency for re-collected urls so untouched ones evict first', () => {
    const onEvict = vi.fn()
    const loader = createImageLoader(apply(), 16, 100, { budgetBytes: 8 * 1024 * 1024, onEvict })
    loader.load(['a', 'b'])
    decode('a', 1000, 1000)
    decode('b', 1000, 1000)
    vi.runAllTimers()
    // Re-collect only a: b becomes the cold end even though it loaded later
    loader.load(['a'])
    loader.load(['c'])
    decode('c', 1000, 1000)
    vi.runAllTimers()
    expect(onEvict.mock.calls[0]![0]).toEqual(['b'])
  })

  it('does not evict images waiting in the pending batch', () => {
    const onEvict = vi.fn()
    const loader = createImageLoader(apply(), 16, 100, { budgetBytes: 8 * 1024 * 1024, onEvict })
    loader.load(['a', 'b', 'c'])
    // a (6 MB) and b (4 MB) settle while c is still decoding, pushing past the
    // 8 MB budget with both entries sitting in the un-flushed batch — neither
    // may be evicted
    decode('a', 1500, 1000)
    decode('b', 1000, 1000)
    expect(onEvict).not.toHaveBeenCalled()
    expect(loader.pending()).toBe(1)
    // The batch flushes only when the last pending url settles, and eviction
    // then runs after the flush — the throttler's progress is never dropped
    decode('c', 1000, 1000)
    vi.runAllTimers()
    expect(onEvict).toHaveBeenCalledTimes(1)
    expect(onEvict.mock.calls[0]![0]).toEqual(['a'])
  })

  it('keeps a single oversized image cached instead of thrashing to empty', () => {
    const onEvict = vi.fn()
    const loader = createImageLoader(apply(), 16, 100, { budgetBytes: 1024, onEvict })
    loader.load(['huge'])
    decode('huge', 4000, 4000)
    vi.runAllTimers()
    expect(onEvict).not.toHaveBeenCalled()
    expect(FakeImage.instances[0]!.src).toBe('huge')
  })

  it('counts unreadable dimensions against the budget', () => {
    const onEvict = vi.fn()
    // Two nominal 256 KB entries fit; the third evicts the first
    const loader = createImageLoader(apply(), 16, 100, { budgetBytes: 512 * 1024, onEvict })
    loader.load(['a', 'b'])
    // naturalWidth stays 0 (a fake that never decoded): the nominal size applies
    FakeImage.instances.find((i) => i.src === 'a')!.onload!()
    FakeImage.instances.find((i) => i.src === 'b')!.onload!()
    vi.runAllTimers()
    expect(onEvict).not.toHaveBeenCalled()
    loader.load(['c'])
    FakeImage.instances.find((i) => i.src === 'c')!.onload!()
    vi.runAllTimers()
    expect(onEvict.mock.calls[0]![0]).toEqual(['a'])
  })
})
