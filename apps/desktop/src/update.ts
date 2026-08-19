/**
 * Application-update controller over electron-updater. The controller is a
 * plain event translator so the state machine can be unit-tested without an
 * Electron runtime; main.ts supplies the real AppUpdater and the renderer
 * receives every transition through IPC.
 * @module @deepseek-ai/dsh-desktop/update
 */

import type { UpdateStatus } from './shared/ipc.ts'

/** The subset of electron-updater's AppUpdater the controller relies on. */
export interface AutoUpdaterLike {
  on(event: string, listener: (...args: unknown[]) => void): unknown
  checkForUpdates(): Promise<unknown> | void
  quitAndInstall(): void
}

/** Command surface exposed to the main process. */
export interface UpdateController {
  check(): void
  quitAndInstall(): void
  status(): UpdateStatus
}

/**
 * Whether an updater error means there is no update to offer at all, from the
 * user's perspective. electron-updater reports this as an empty feed ("No
 * published versions"), a missing production release (releases/latest 404 or
 * "Unable to find latest version"), or a missing channel file (latest.yml /
 * latest-rc.yml not among the release assets). All of those mean "up to
 * date", not a failure.
 */
export function isNoPublishedVersions(message: string): boolean {
  return /no published versions|unable to find latest version|cannot find [^\n]*latest|404 not found/i.test(message)
}

/** The first "NNN Status" line of an electron-updater HttpError message, or null. */
function httpStatusLine(message: string): string | null {
  const match = message.match(/^(\d{3} [^\n]+)/)
  return match === null ? null : match[1]
}

/**
 * Map one updater error message to a user-facing status: no-update conditions
 * become not-available; HttpError dumps (which carry a raw response-headers
 * block) become a short status line instead of the dump; everything else keeps
 * its message.
 */
function errorStatus(message: string): UpdateStatus {
  if (isNoPublishedVersions(message)) return { kind: 'not-available' }
  const statusLine = httpStatusLine(message)
  if (statusLine !== null) {
    return { kind: 'error', message: '检查更新失败（' + statusLine + '），请稍后重试' }
  }
  return { kind: 'error', message }
}

/**
 * Translate electron-updater events into UpdateStatus transitions.
 * @param updater - The AppUpdater instance to subscribe to.
 * @param emit - Called with every status transition.
 * @returns The controller commands plus the latest status.
 */
export function createUpdateController(
  updater: AutoUpdaterLike,
  emit: (status: UpdateStatus) => void,
): UpdateController {
  let status: UpdateStatus = { kind: 'idle' }
  const versionOf = (info: unknown): string => {
    const version = (info as { version?: unknown }).version
    return typeof version === 'string' ? version : ''
  }
  const set = (next: UpdateStatus): void => {
    status = next
    emit(next)
  }
  updater.on('checking-for-update', () => { set({ kind: 'checking' }) })
  updater.on('update-available', (info) => { set({ kind: 'available', version: versionOf(info) }) })
  updater.on('update-not-available', () => { set({ kind: 'not-available' }) })
  updater.on('download-progress', (progress) => {
    const percent = (progress as { percent?: unknown }).percent
    set({ kind: 'downloading', percent: typeof percent === 'number' ? Math.round(percent) : 0 })
  })
  updater.on('update-downloaded', (info) => { set({ kind: 'downloaded', version: versionOf(info) }) })
  updater.on('error', (error) => {
    const message = error instanceof Error ? error.message : String(error)
    set(errorStatus(message))
  })
  return {
    check: () => {
      const result = updater.checkForUpdates()
      if (result instanceof Promise) {
        void result.catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          set(errorStatus(message))
        })
      }
    },
    quitAndInstall: () => {
      updater.quitAndInstall()
    },
    status: () => status,
  }
}
