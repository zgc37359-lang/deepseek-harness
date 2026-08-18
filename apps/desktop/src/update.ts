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
    set({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
  })
  return {
    check: () => {
      const result = updater.checkForUpdates()
      if (result instanceof Promise) {
        void result.catch((error: unknown) => {
          set({ kind: 'error', message: error instanceof Error ? error.message : String(error) })
        })
      }
    },
    quitAndInstall: () => {
      updater.quitAndInstall()
    },
    status: () => status,
  }
}
