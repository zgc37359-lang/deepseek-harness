import { afterEach, describe, expect, it, vi } from 'vitest'
import { writeClipboard } from '../src/clipboard.ts'

interface DesktopBridge {
  clipboard?: { writeText(text: string): Promise<boolean> }
}

const originalDesktop = (globalThis as { desktop?: DesktopBridge }).desktop
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard')

afterEach(() => {
  if (originalDesktop === undefined) {
    delete (globalThis as { desktop?: DesktopBridge }).desktop
  } else {
    ;(globalThis as { desktop?: DesktopBridge }).desktop = originalDesktop
  }
  if (originalClipboard === undefined) {
    delete (navigator as { clipboard?: unknown }).clipboard
  } else {
    Object.defineProperty(navigator, 'clipboard', originalClipboard)
  }
})

describe('writeClipboard', () => {
  it('prefers the desktop host clipboard bridge when present', async () => {
    const writeText = vi.fn().mockResolvedValue(true)
    ;(globalThis as { desktop?: DesktopBridge }).desktop = { clipboard: { writeText } }
    const navigatorWrite = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: navigatorWrite }, configurable: true })

    await expect(writeClipboard('payload')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('payload')
    expect(navigatorWrite).not.toHaveBeenCalled()
  })

  it('returns false when the desktop bridge rejects', async () => {
    ;(globalThis as { desktop?: DesktopBridge }).desktop = {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    }

    await expect(writeClipboard('payload')).resolves.toBe(false)
  })

  it('falls back to the async Clipboard API without the desktop bridge', async () => {
    delete (globalThis as { desktop?: DesktopBridge }).desktop
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    await expect(writeClipboard('payload')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith('payload')
  })
})
