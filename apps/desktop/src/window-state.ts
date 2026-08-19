/**
 * Main-window geometry persistence: load the last window state (bounds +
 * maximized), validate it against the current display layout, and save it
 * back. The display geometry is injected so the validation logic stays
 * unit-testable without an Electron runtime.
 * @module @deepseek-ai/dsh-desktop/window-state
 */

import { readFile, writeFile } from 'node:fs/promises'

/** One saved window geometry: bounds plus the maximized flag. */
export interface WindowState {
  x?: number
  y?: number
  width: number
  height: number
  maximized: boolean
}

/** Geometry the main window falls back to without stored state. */
export const DEFAULT_WINDOW_STATE: WindowState = { width: 1280, height: 800, maximized: false }

/** One display's bounds, injected from Electron's screen module. */
export interface DisplayGeometry {
  x: number
  y: number
  width: number
  height: number
}

/** Minimum overlap (px) for a restored window to count as visible. */
const MIN_VISIBLE_OVERLAP = 8

/**
 * Normalize a stored window state against the current display layout: enforce
 * the minimum size, and drop the position when the window would land entirely
 * off every display (a monitor was unplugged), letting the OS re-center it.
 * @param state - the stored state, or undefined when none exists.
 * @param displays - the current display bounds.
 * @param minWidth - the window's minimum width.
 * @param minHeight - the window's minimum height.
 * @returns the geometry the main window should open with.
 */
export function clampWindowState(
  state: WindowState | undefined,
  displays: readonly DisplayGeometry[],
  minWidth: number,
  minHeight: number,
): WindowState {
  if (state === undefined) return { ...DEFAULT_WINDOW_STATE }
  const width = Math.max(minWidth, Math.round(state.width))
  const height = Math.max(minHeight, Math.round(state.height))
  const result: WindowState = { width, height, maximized: state.maximized }
  if (state.x === undefined || state.y === undefined || displays.length === 0) {
    return result
  }
  const visible = displays.some((display) => {
    const overlapX = Math.min(state.x as number + width, display.x + display.width) - Math.max(state.x as number, display.x)
    const overlapY = Math.min(state.y as number + height, display.y + display.height) - Math.max(state.y as number, display.y)
    return overlapX >= MIN_VISIBLE_OVERLAP && overlapY >= MIN_VISIBLE_OVERLAP
  })
  if (visible) {
    result.x = state.x
    result.y = state.y
  }
  return result
}

/**
 * Read and parse a stored window state; malformed or absent files yield
 * undefined so the caller falls back to the default geometry.
 * @param file - the state file path.
 * @returns the parsed state, or undefined when absent or unparsable.
 */
export async function loadWindowState(file: string): Promise<WindowState | undefined> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return undefined
  }
  try {
    const raw = JSON.parse(text) as Record<string, unknown>
    if (typeof raw.width !== 'number' || typeof raw.height !== 'number') return undefined
    const state: WindowState = {
      width: raw.width,
      height: raw.height,
      maximized: raw.maximized === true,
    }
    if (typeof raw.x === 'number') state.x = raw.x
    if (typeof raw.y === 'number') state.y = raw.y
    return state
  } catch {
    return undefined
  }
}

/**
 * Persist one window state for the next launch.
 * @param file - the state file path.
 * @param state - the geometry to save.
 */
export async function saveWindowState(file: string, state: WindowState): Promise<void> {
  await writeFile(file, JSON.stringify(state), 'utf8')
}
