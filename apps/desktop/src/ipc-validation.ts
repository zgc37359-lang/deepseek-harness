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
 * Windows device names reserved regardless of extension (CON, PRN, AUX, NUL,
 * COM1-9, LPT1-9). The Win32 check applies to the base name before the first
 * dot, case-insensitively; prefixing keeps the download usable instead of
 * creating a file other programs cannot open.
 */
const WINDOWS_RESERVED_BASE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/

/**
 * Sanitize a download filename for the filesystem: every character Windows
 * forbids in a file name becomes an underscore; reserved device base names get
 * an underscore prefix; trailing dots and spaces (silently stripped by Win32,
 * which would make the saved path ambiguous) become underscores.
 */
export function sanitizeDownloadFilename(filename: string): string {
  const sanitized = filename.replace(/[\\/:*?"<>|]/g, '_')
  const base = sanitized.split('.')[0] ?? ''
  const renamed = WINDOWS_RESERVED_BASE_NAMES.test(base.toLowerCase())
    ? `_${sanitized}`
    : sanitized
  return renamed.replace(/[. ]+$/, '_')
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
