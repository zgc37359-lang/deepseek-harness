import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clampWindowState,
  DEFAULT_WINDOW_STATE,
  loadWindowState,
  saveWindowState,
  type DisplayGeometry,
  type WindowState,
} from '../src/window-state.ts'

/** A 1920x1080 primary display at the origin, plus a 1080p display to the right. */
const PRIMARY: DisplayGeometry = { x: 0, y: 0, width: 1920, height: 1080 }
const SECONDARY: DisplayGeometry = { x: 1920, y: 0, width: 1920, height: 1080 }

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-window-state-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('clampWindowState', () => {
  it('falls back to the default geometry for no stored state', () => {
    expect(clampWindowState(undefined, [PRIMARY], 800, 560)).toEqual(DEFAULT_WINDOW_STATE)
  })

  it('clamps undersized windows to the minimum, keeping the position', () => {
    const state: WindowState = { x: 100, y: 100, width: 10, height: 10, maximized: false }
    expect(clampWindowState(state, [PRIMARY], 800, 560)).toEqual({
      x: 100,
      y: 100,
      width: 800,
      height: 560,
      maximized: false,
    })
  })

  it('keeps a position that is at least partially visible on some display', () => {
    const state: WindowState = { x: 1900, y: 100, width: 1200, height: 800, maximized: false }
    // 20px overlap with the primary display, fully on the secondary display.
    expect(clampWindowState(state, [PRIMARY, SECONDARY], 800, 560)).toEqual(state)
  })

  it('drops the position when the window is entirely off every display', () => {
    const state: WindowState = { x: 5000, y: 5000, width: 1200, height: 800, maximized: false }
    expect(clampWindowState(state, [PRIMARY], 800, 560)).toEqual({
      width: 1200,
      height: 800,
      maximized: false,
    })
  })

  it('passes the maximized flag through untouched', () => {
    const state: WindowState = { x: 0, y: 0, width: 900, height: 600, maximized: true }
    expect(clampWindowState(state, [PRIMARY], 800, 560).maximized).toBe(true)
  })

  it('keeps an unpositioned state with its size', () => {
    const state: WindowState = { width: 1000, height: 700, maximized: false }
    expect(clampWindowState(state, [PRIMARY], 800, 560)).toEqual(state)
  })
})

describe('window-state persistence', () => {
  it('round-trips a saved state through loadWindowState', async () => {
    const file = join(dir, 'window-state.json')
    const state: WindowState = { x: 12, y: 34, width: 1440, height: 900, maximized: true }
    await saveWindowState(file, state)
    await expect(loadWindowState(file)).resolves.toEqual(state)
  })

  it('returns undefined for a missing file', async () => {
    await expect(loadWindowState(join(dir, 'absent.json'))).resolves.toBeUndefined()
  })

  it('returns undefined for invalid JSON', async () => {
    const { writeFileSync } = await import('node:fs')
    const file = join(dir, 'bad.json')
    writeFileSync(file, '{not json')
    await expect(loadWindowState(file)).resolves.toBeUndefined()
  })

  it('returns undefined for JSON without numeric width and height', async () => {
    const { writeFileSync } = await import('node:fs')
    const file = join(dir, 'shapeless.json')
    writeFileSync(file, '{"x": 1, "maximized": true}')
    await expect(loadWindowState(file)).resolves.toBeUndefined()
  })

  it('tolerates missing optional fields', async () => {
    const { writeFileSync } = await import('node:fs')
    const file = join(dir, 'minimal.json')
    writeFileSync(file, '{"width": 1280, "height": 800}')
    await expect(loadWindowState(file)).resolves.toEqual({
      width: 1280,
      height: 800,
      maximized: false,
    })
  })
})
