/**
 * PenPreferences: the ribbon's "current pen" — the color/highlight the main
 * split buttons apply without opening a palette (Word's paint-bar behavior).
 * Legacy Ribbon holds these as useState ('C00000' / 'yellow'); the service
 * form lets commands read/write the pen and lets the C2 renderer subscribe
 * for re-renders.
 */
export class PenPreferences {
  private colorHex = 'C00000'
  private highlightName = 'yellow'
  private readonly listeners = new Set<() => void>()

  color(): string {
    return this.colorHex
  }

  highlight(): string {
    return this.highlightName
  }

  setColor(hex: string): void {
    if (hex === this.colorHex) return
    this.colorHex = hex
    this.emit()
  }

  setHighlight(name: string): void {
    if (name === this.highlightName) return
    this.highlightName = name
    this.emit()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  private emit(): void {
    for (const fn of this.listeners) fn()
  }
}
