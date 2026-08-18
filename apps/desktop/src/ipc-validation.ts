/**
 * Pure IPC input-validation helpers for the desktop main process. Every
 * whitelisted channel's argument checks live here so the renderer-facing
 * contract can be unit-tested without an Electron runtime; main.ts calls
 * these and only these checks.
 * @module @deepseek-ai/dsh-desktop/ipc-validation
 */

import type { WindowMenuAction } from './shared/ipc.ts'

/** The whitelisted custom window-menu actions. */
export const WINDOW_MENU_ACTIONS: readonly string[] = ['restore', 'move', 'size', 'minimize', 'maximize', 'close']

/** Whether the raw window-menu action is whitelisted. */
export function isWindowMenuAction(raw: unknown): raw is WindowMenuAction {
  return typeof raw === 'string' && (WINDOW_MENU_ACTIONS as readonly string[]).includes(raw)
}

/** Whether a runtime unary request carries two JSON strings. */
export function isRuntimeUnaryArgs(method: unknown, body: unknown): method is string {
  return typeof method === 'string' && typeof body === 'string'
}

/** Whether the runtime subscribe stream name is one of the two downlinks. */
export function isRuntimeStream(stream: unknown): stream is 'mux' | 'host' {
  return stream === 'mux' || stream === 'host'
}

/** Whether clipboard-write input is a string. */
export function isClipboardText(text: unknown): text is string {
  return typeof text === 'string'
}

/** Whether a download-save filename is a non-empty string. */
export function isDownloadFilename(filename: unknown): filename is string {
  return typeof filename === 'string' && filename.length > 0
}

/** Whether a download-save payload is a base64 string. */
export function isBase64Payload(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * Sanitize a download filename for the filesystem: every character Windows
 * forbids in a file name becomes an underscore.
 */
export function sanitizeDownloadFilename(filename: string): string {
  return filename.replace(/[\\/:*?"<>|]/g, '_')
}

/**
 * Whether a reveal request names the downloads directory itself or a path
 * below it (case-insensitive). A bare prefix check would admit sibling
 * directories whose names start with the downloads path (e.g. `Downloads2`),
 * so the match requires an exact equality or a path-separator boundary.
 */
export function isDownloadRevealPath(path: unknown, downloadsDir: string): path is string {
  if (typeof path !== 'string') return false
  const normalized = path.toLowerCase()
  const dir = downloadsDir.toLowerCase()
  return normalized === dir || normalized.startsWith(`${dir}\\`) || normalized.startsWith(`${dir}/`)
}
