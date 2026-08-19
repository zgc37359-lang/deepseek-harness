/**
 * Sandboxed preload bridge: exposes the whitelisted `window.desktop` API to
 * the renderer through contextBridge. Compiled to one CommonJS bundle because
 * Electron sandboxed preloads cannot load ESM.
 * @module @deepseek-ai/dsh-desktop/preload
 */

import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type DesktopApi, type UpdateStatus, type WindowMenuAction } from './shared/ipc.ts'

/** Subscribe to a main-process push event and return the disposer. */
function subscribe(channel: string, callback: () => void): () => void {
  const listener = (): void => { callback() }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: DesktopApi = {
  ping: () => ipcRenderer.invoke(IPC.ping),
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  window: {
    minimize: () => ipcRenderer.invoke(IPC.windowMinimize),
    toggleMaximize: () => ipcRenderer.invoke(IPC.windowToggleMaximize),
    close: () => ipcRenderer.invoke(IPC.windowClose),
    isMaximized: () => ipcRenderer.invoke(IPC.windowIsMaximized),
    onMaximizedChanged: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, maximized: boolean): void => { callback(maximized) }
      ipcRenderer.on(IPC.windowMaximizedChanged, listener)
      return () => {
        ipcRenderer.removeListener(IPC.windowMaximizedChanged, listener)
      }
    },
    menuAction: (action: WindowMenuAction) => ipcRenderer.invoke(IPC.windowMenuAction, action),
    beginMove: () => ipcRenderer.invoke(IPC.windowMenuBeginMove),
    beginSize: () => ipcRenderer.invoke(IPC.windowMenuBeginSize),
    endDrag: () => ipcRenderer.invoke(IPC.windowMenuEndDrag),
  },
  tray: {
    onNewSession: callback => subscribe(IPC.trayNewSession, callback),
    onShow: callback => subscribe(IPC.trayShow, callback),
  },
  shell: {
    crashState: () => ipcRenderer.invoke(IPC.shellCrashState),
    resetCrash: () => ipcRenderer.invoke(IPC.shellResetCrash),
  },
  runtime: {
    unary: (method, body) => ipcRenderer.invoke(IPC.runtimeUnary, method, body),
    subscribe: (stream, onFrame, onEnd) => {
      ipcRenderer.send(IPC.runtimeSubscribe, stream)
      const frameListener = (_event: Electron.IpcRendererEvent, source: unknown, envelope: unknown): void => {
        if (source === stream) onFrame(envelope)
      }
      const endListener = (_event: Electron.IpcRendererEvent, source: unknown): void => {
        if (source === stream) onEnd()
      }
      ipcRenderer.on(IPC.runtimeEvent, frameListener)
      ipcRenderer.on(IPC.runtimeEventEnd, endListener)
      return () => {
        ipcRenderer.removeListener(IPC.runtimeEvent, frameListener)
        ipcRenderer.removeListener(IPC.runtimeEventEnd, endListener)
      }
    },
    getBootManifest: () => ipcRenderer.invoke(IPC.runtimeBootManifest),
  },
  diagnostics: {
    export: () => ipcRenderer.invoke(IPC.diagnosticsExport),
  },
  clipboard: {
    writeText: (text: string) => ipcRenderer.invoke(IPC.clipboardWriteText, text),
  },
  download: {
    save: (filename: string, bytesBase64: string) => ipcRenderer.invoke(IPC.downloadSave, filename, bytesBase64),
    reveal: (path: string) => ipcRenderer.invoke(IPC.downloadReveal, path),
  },
  updates: {
    check: () => ipcRenderer.invoke(IPC.updatesCheck),
    install: () => ipcRenderer.invoke(IPC.updatesInstall),
    onStatus: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus): void => { callback(status) }
      ipcRenderer.on(IPC.updatesStatus, listener)
      return () => {
        ipcRenderer.removeListener(IPC.updatesStatus, listener)
      }
    },
  },
}

contextBridge.exposeInMainWorld('desktop', api)
// Readiness probe: the smoke test resolves on the first ping.
void ipcRenderer.invoke(IPC.ping)
