/**
 * Whitelisted IPC surface shared by the Electron main process, preload, and
 * renderer. Every channel used by the desktop shell must be declared here.
 */
export const IPC = {
  ping: 'desktop:ping',
  appInfo: 'desktop:app-info',
  windowMinimize: 'window:minimize',
  windowToggleMaximize: 'window:toggle-maximize',
  windowClose: 'window:close',
  windowIsMaximized: 'window:is-maximized',
  windowMaximizedChanged: 'window:maximized-changed',
  windowMenuAction: 'window-menu:action',
  windowMenuBeginMove: 'window-menu:begin-move',
  windowMenuBeginSize: 'window-menu:begin-size',
  windowMenuEndDrag: 'window-menu:end-drag',
  runtimeUnary: 'runtime:unary',
  runtimeSubscribe: 'runtime:subscribe',
  runtimeEvent: 'runtime:event',
  runtimeEventEnd: 'runtime:event-end',
  runtimeBootManifest: 'runtime:boot-manifest',
  diagnosticsExport: 'diagnostics:export',
  clipboardWriteText: 'clipboard:write-text',
  downloadSave: 'downloads:save',
  downloadReveal: 'downloads:reveal',
  updatesCheck: 'updates:check',
  updatesInstall: 'updates:install',
  updatesStatus: 'updates:status',
  trayNewSession: 'tray:new-session',
  trayShow: 'tray:show',
  shellCrashState: 'shell:crash-state',
  shellResetCrash: 'shell:reset-crash',
} as const

/** Actions the custom title-bar menu can request from the main process. */
export type WindowMenuAction = 'restore' | 'move' | 'size' | 'minimize' | 'maximize' | 'close'

/** Version and environment facts surfaced by the desktop About surface. */
export interface AppInfo {
  appVersion: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: string
  arch: string
  userData: string
  logFile: string
}

/** Update flow state pushed from the main process to the renderer. */
export type UpdateStatus =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; version: string }
  | { kind: 'not-available' }
  | { kind: 'downloading'; percent: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string }

/** The preload bridge shape exposed to the renderer as `window.desktop`. */
export interface DesktopApi {
  ping(): Promise<string>
  getAppInfo(): Promise<AppInfo>
  window: {
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    isMaximized(): Promise<boolean>
    onMaximizedChanged(callback: (maximized: boolean) => void): () => void
    menuAction(action: WindowMenuAction): Promise<void>
    beginMove(): Promise<void>
    beginSize(): Promise<void>
    endDrag(): Promise<void>
  }
  tray: {
    onNewSession(callback: () => void): () => void
    onShow(callback: () => void): () => void
  }
  shell: {
    crashState(): Promise<{ crashed: boolean }>
    resetCrash(): Promise<void>
  }
  runtime: {
    unary(method: string, body: string): Promise<{ status: number; body: string }>
    subscribe(
      stream: 'mux' | 'host',
      onFrame: (envelope: unknown) => void,
      onEnd: () => void,
    ): () => void
    getBootManifest(): Promise<unknown>
  }
  diagnostics: {
    export(): Promise<{ cancelled: true } | { cancelled: false; path: string }>
  }
  clipboard: {
    writeText(text: string): Promise<boolean>
  }
  download: {
    save(filename: string, bytesBase64: string): Promise<{ ok: boolean; path?: string; error?: string }>
    reveal(path: string): Promise<boolean>
  }
  updates: {
    check(): Promise<void>
    install(): Promise<void>
    onStatus(callback: (status: UpdateStatus) => void): () => void
  }
}
