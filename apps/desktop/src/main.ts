/**
 * Electron main process for the dsh desktop application: custom window
 * chrome, tray, single-instance, and the whitelisted IPC bridge. The Harness
 * runtime is hosted in this process in a later milestone; this milestone owns
 * the desktop shell lifecycle.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'
import {
  app,
  BrowserWindow,
  clipboard,
  crashReporter,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  protocol,
  screen,
  shell,
  Tray,
  type Rectangle,
} from 'electron'
import { IPC, type AppInfo } from './shared/ipc.ts'
import {
  isBase64Payload,
  isClipboardText,
  isDownloadFilename,
  isDownloadRevealPath,
  isRuntimeStream,
  isRuntimeUnaryArgs,
  isWindowMenuAction,
  sanitizeDownloadFilename,
} from './ipc-validation.ts'
import {
  registerRuntimeSubscription,
  runtimeBootManifest,
  runtimeBundle,
  runtimeUnary,
} from './desktop-runtime.ts'
import { bootDesktopRuntime, desktopRuntimeContext, disposeDesktopRuntime } from './desktop-boot.ts'
import { collectDiagnostics } from './diagnostics.ts'
import { runPtyProbe } from './pty-probe.ts'
import { runStreamBenchmark } from './bench-stream.ts'
import { runPerfProbe } from './perf-test.ts'
// electron-updater declares `autoUpdater` as a getter on its CJS exports, which
// Node's ESM named-export interop cannot statically detect; the default import
// (module.exports) always carries it.
import electronUpdater from 'electron-updater'
import { createUpdateController, type UpdateController } from './update.ts'
import type { UpdateStatus } from './shared/ipc.ts'

const { autoUpdater } = electronUpdater

/** 32x32 tray glyph: blue circle with a white plus. */
const TRAY_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAF+SURBVFhH7ZahUsQwEIZPIpFIHgF5DvRdModEIpFIXC5BIJFIHEgegUEheQRkJbJul9k7QfMnKdlQgeg386t0998mu2kXi5mZRqyj5fqWz4bCZyZHTI2nRxPoywbmVNRbT88m8DnG/omV4yPr6SU1HBO9rhyfYC418tY2UJca1Ij6daALzFmNnGuaVK+mIjaOj9vfHEW9+jhqzvzp7Ue4loo+0KNI7dYPwbWCLtEri4xSJjiRtgAT6B29Ek4dH+zmOZMApS1AJL2FnhH7sUsDc2op4NeJkFsMg0TSaBqKjenpGj0jjKerJGjSAniLnhGyRUnQhAUYzzfoGVE7gqIhuDai8VHcOD7MBGXVUkDVjShfMgzMSVuACfSJXllKjYjSFmAD3aFXEbm70wSxlN+CTi459CmiacZKjTdfDrk0MonUMoHuMXc1MreYUCd6wJxq9seh+zmRH1dpZszVjDSQ7IaMEprFok62XO4TzDEZcpnsjsbzNpKjJT478+/5BvSSfnSfrfhDAAAAAElFTkSuQmCC'

const MIN_WINDOW_WIDTH = 800
const MIN_WINDOW_HEIGHT = 560
const SMOKE_TEST = process.argv.includes('--smoke-test')
const PTY_PROBE = process.argv.includes('--pty-probe')
const BENCH_STREAM = process.argv.includes('--bench-stream')
const PERF_TEST = process.argv.includes('--perf-test')
const SMOKE_TIMEOUT_MS = 120_000
const SHUTDOWN_TIMEOUT_MS = 10_000

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let rendererCrashes = 0
let smokePings = 0
let smokeTimer: NodeJS.Timeout | undefined
let runtimeReady = false
let shuttingDown = false
let updateController: UpdateController | null = null

/** The task text following `--bench-stream`, or an empty string when absent. */
function benchStreamTask(): string {
  const index = process.argv.indexOf('--bench-stream')
  return index >= 0 ? (process.argv[index + 1] ?? '') : ''
}

/** The app version and environment snapshot surfaced by IPC. */
function currentAppInfo(): AppInfo {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromeVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    userData: userDataDir,
    logFile,
  }
}

/** Finish the smoke run once both the preload ping and the runtime boot landed. */
function maybeFinishSmoke(): void {
  if (!SMOKE_TEST || !runtimeReady || smokePings < 1) return
  console.log('DESKTOP_SMOKE_OK')
  if (smokeTimer !== undefined) clearTimeout(smokeTimer)
  app.exit(0)
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'dsh-bundle',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
    },
  },
])

// Crashpad must start before app ready so every later renderer process is
// monitored. Collection is local-only: dumps land in the userData
// crashDumps directory (app.getPath('crashDumps')) and are exported by the
// diagnostics bundle; nothing is uploaded.
crashReporter.start({ uploadToServer: false, compress: true })

const userDataDir = app.getPath('userData')
const logFile = join(userDataDir, 'logs', 'main.log')
mkdirSync(dirname(logFile), { recursive: true })

/** Append one timestamped line to the desktop main-process log. */
function log(level: 'info' | 'warn' | 'error', message: string): void {
  appendFileSync(logFile, `[${new Date().toISOString()}] ${level} ${message}\n`)
}

// Desktop launches may start with stdout/stderr already closed (Explorer,
// Start-Process, test harness teardown). Node's default warning printer
// writes to stderr, and the resulting EPIPE surfaces as an uncaught
// main-process exception that Electron shows as a JavaScript error dialog.
// Route warnings into the main-process log instead, and contain the EPIPE
// case specifically.
process.on('warning', (warning) => {
  log('warn', warning.message)
})
process.on('uncaughtException', (error) => {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error)
  log('error', `uncaught exception: ${detail}`)
  if ((error as NodeJS.ErrnoException).code === 'EPIPE') return
  app.exit(1)
})

/** Restore or create the main window and bring it to the foreground. */
function showMainWindow(): void {
  const win = mainWindow
  if (win === null) {
    createMainWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

/** Push the current update status to the renderer, if one exists. */
function sendUpdateStatus(status: UpdateStatus): void {
  mainWindow?.webContents.send(IPC.updatesStatus, status)
}

/** Create the frameless main window with the sandboxed renderer. */
function createMainWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    frame: false,
    show: false,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: fileURLToPath(new URL('../preload.cjs', import.meta.url)),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  mainWindow = win

  win.once('ready-to-show', () => {
    if (!SMOKE_TEST) win.show()
  })
  win.on('maximize', () => { win.webContents.send(IPC.windowMaximizedChanged, true) })
  win.on('unmaximize', () => { win.webContents.send(IPC.windowMaximizedChanged, false) })
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win.hide()
    }
  })
  win.on('blur', stopWindowDrag)
  win.on('closed', () => {
    mainWindow = null
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    log('error', `renderer gone: ${details.reason}`)
    if (isQuitting || SMOKE_TEST) return
    rendererCrashes += 1
    if (rendererCrashes <= 2) win.webContents.reload()
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => { event.preventDefault() })

  const devUrl = process.env.DSH_DESKTOP_DEV_URL
  if (devUrl !== undefined) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(fileURLToPath(new URL('../../dist/renderer/index.html', import.meta.url)))
  }
}

interface WindowDragState {
  kind: 'move' | 'size'
  base: Rectangle
  startX: number
  startY: number
}

let windowDrag: WindowDragState | null = null
let windowDragTimer: NodeJS.Timeout | null = null

/** Stop the active move/size drag loop, if any. */
function stopWindowDrag(): void {
  if (windowDragTimer !== null) clearInterval(windowDragTimer)
  windowDragTimer = null
  windowDrag = null
}

/** Start a cursor-driven move or size loop for the custom window menu. */
function beginWindowDrag(kind: 'move' | 'size'): void {
  const win = mainWindow
  if (win === null) return
  const cursor = screen.getCursorScreenPoint()
  windowDrag = { kind, base: win.getBounds(), startX: cursor.x, startY: cursor.y }
  if (windowDragTimer !== null) clearInterval(windowDragTimer)
  windowDragTimer = setInterval(() => {
    const drag = windowDrag
    const target = mainWindow
    if (drag === null || target === null) {
      stopWindowDrag()
      return
    }
    const current = screen.getCursorScreenPoint()
    const dx = current.x - drag.startX
    const dy = current.y - drag.startY
    if (drag.kind === 'move') {
      target.setPosition(drag.base.x + dx, drag.base.y + dy)
    } else {
      target.setBounds({
        ...drag.base,
        width: Math.max(MIN_WINDOW_WIDTH, drag.base.width + dx),
        height: Math.max(MIN_WINDOW_HEIGHT, drag.base.height + dy),
      })
    }
  }, 16)
}

/** Register every whitelisted IPC channel the renderer can reach. */
function registerIpc(): void {
  ipcMain.handle(IPC.ping, () => {
    if (SMOKE_TEST) {
      smokePings += 1
      maybeFinishSmoke()
    }
    return 'pong'
  })

  ipcMain.handle(IPC.appInfo, (): AppInfo => currentAppInfo())

  ipcMain.handle(IPC.diagnosticsExport, async () => {
    const win = mainWindow
    if (win === null) return { cancelled: true }
    const picked = await dialog.showOpenDialog(win, {
      title: '选择诊断包导出位置',
      properties: ['openDirectory', 'createDirectory'],
    })
    const root = picked.filePaths[0]
    if (picked.canceled || root === undefined) return { cancelled: true }
    const path = await collectDiagnostics(root, logFile, currentAppInfo(), app.getPath('crashDumps'))
    log('info', `diagnostics exported to ${path}`)
    return { cancelled: false, path }
  })

  ipcMain.handle(IPC.clipboardWriteText, (_event, text: unknown) => {
    if (!isClipboardText(text)) return false
    clipboard.writeText(text)
    // The write API is void and silently no-ops when the OS clipboard is
    // unavailable; read back so callers never report a copy that did not land.
    return clipboard.readText() === text
  })

  ipcMain.handle(IPC.downloadSave, (_event, filename: unknown, bytesBase64: unknown) => {
    if (!isDownloadFilename(filename) || !isBase64Payload(bytesBase64)) {
      return { ok: false, error: 'invalid download arguments' }
    }
    const safeName = sanitizeDownloadFilename(filename)
    const downloads = app.getPath('downloads')
    mkdirSync(downloads, { recursive: true })
    const path = join(downloads, safeName)
    try {
      writeFileSync(path, Buffer.from(bytesBase64, 'base64'))
      log('info', `download saved to ${path}`)
      return { ok: true, path }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  })

  ipcMain.handle(IPC.downloadReveal, (_event, path: unknown) => {
    if (!isDownloadRevealPath(path, app.getPath('downloads'))) return false
    shell.showItemInFolder(path)
    return true
  })

  ipcMain.handle(IPC.updatesCheck, () => {
    updateController?.check()
  })

  ipcMain.handle(IPC.updatesInstall, () => {
    updateController?.quitAndInstall()
  })

  ipcMain.handle(IPC.windowMinimize, () => {
    mainWindow?.minimize()
  })

  ipcMain.handle(IPC.windowToggleMaximize, () => {
    const win = mainWindow
    if (win === null) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  })

  ipcMain.handle(IPC.windowClose, () => {
    mainWindow?.close()
  })

  ipcMain.handle(IPC.windowIsMaximized, () => mainWindow?.isMaximized() ?? false)

  ipcMain.handle(IPC.windowMenuAction, (_event, rawAction: unknown) => {
    if (!isWindowMenuAction(rawAction)) return
    const action = rawAction
    const win = mainWindow
    if (win === null) return
    switch (action) {
      case 'restore':
        win.unmaximize()
        break
      case 'move':
        beginWindowDrag('move')
        break
      case 'size':
        beginWindowDrag('size')
        break
      case 'minimize':
        win.minimize()
        break
      case 'maximize':
        win.maximize()
        break
      case 'close':
        win.close()
        break
      default:
        action satisfies never
    }
  })

  ipcMain.handle(IPC.windowMenuBeginMove, () => { beginWindowDrag('move') })
  ipcMain.handle(IPC.windowMenuBeginSize, () => { beginWindowDrag('size') })
  ipcMain.handle(IPC.windowMenuEndDrag, () => { stopWindowDrag() })

  ipcMain.handle(IPC.runtimeUnary, (_event, method: unknown, body: unknown) => {
    // isRuntimeUnaryArgs narrows `method`; the explicit typeof narrows `body`
    // so runtimeUnary receives two strings.
    if (!isRuntimeUnaryArgs(method, body) || typeof body !== 'string') {
      return { status: 400, body: JSON.stringify({ error: 'invalid runtime request' }) }
    }
    return runtimeUnary(method, body)
  })

  ipcMain.handle(IPC.runtimeBootManifest, () => runtimeBootManifest())

  ipcMain.on(IPC.runtimeSubscribe, (event, stream: unknown) => {
    if (!isRuntimeStream(stream)) return
    const webContents = event.sender
    const dispose = registerRuntimeSubscription(webContents, stream)
    webContents.once('destroyed', dispose)
  })
}

/** Create the tray icon and its menu. */
function createTray(): void {
  const icon = nativeImage.createFromDataURL(TRAY_ICON_DATA_URL)
  tray = new Tray(icon)
  tray.setToolTip('DeepSeek Harness Desktop')
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: '打开主窗口',
      click: showMainWindow,
    },
    {
      label: '新建会话',
      click: () => {
        mainWindow?.webContents.send(IPC.trayNewSession)
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ]))
  tray.on('click', showMainWindow)
}

/** Boot the desktop shell after Electron is ready. */
function bootstrap(): void {
  if (PTY_PROBE) {
    void runPtyProbe().then((result) => {
      console.log(result.ok ? 'DESKTOP_PTY_OK' : `DESKTOP_PTY_FAIL: ${result.error ?? ''}`)
      app.exit(result.ok ? 0 : 1)
    })
    return
  }
  if (BENCH_STREAM) {
    const task = benchStreamTask()
    if (task.trim() === '') {
      console.error('DESKTOP_BENCH_STREAM_FAIL: task text required after --bench-stream')
      app.exit(1)
      return
    }
    void bootDesktopRuntime().then(async () => {
      const ctx = desktopRuntimeContext()
      if (ctx === null) throw new Error('bench-stream: runtime context unavailable')
      const result = await runStreamBenchmark(ctx, task)
      console.log(result.ok ? 'DESKTOP_BENCH_STREAM_OK' : 'DESKTOP_BENCH_STREAM_FAIL')
      console.log(JSON.stringify(result))
      app.exit(result.ok ? 0 : 1)
    }).catch((error: unknown) => {
      const detail = error instanceof Error ? error.message : String(error)
      log('error', `bench-stream failed: ${detail}`)
      console.error(`DESKTOP_BENCH_STREAM_FAIL: ${detail}`)
      app.exit(1)
    })
    return
  }
  registerIpc()
  createMainWindow()
  createTray()
  protocol.handle('dsh-bundle', async (request) => {
    const url = new URL(request.url)
    const match = decodeURIComponent(url.pathname).match(/^\/plugins\/(.+)\/client\.js$/)
    if (match === null) return new Response('not found', { status: 404 })
    const id = match[1]
    if (id === undefined) return new Response('not found', { status: 404 })
    try {
      return new Response(new Uint8Array(await runtimeBundle(id)), {
        headers: { 'content-type': 'application/javascript' },
      })
    } catch (error) {
      return new Response(String(error), { status: 404 })
    }
  })
  if (SMOKE_TEST) {
    smokeTimer = setTimeout(() => {
      console.error('DESKTOP_SMOKE_TIMEOUT')
      app.exit(1)
    }, SMOKE_TIMEOUT_MS)
  }
  log('info', `desktop boot: ${app.getVersion()} electron ${process.versions.electron}`)
  if (!SMOKE_TEST && app.isPackaged) {
    // Test hook: install-cycle gates point electron-updater at a local feed
    // (generic provider serving latest.yml + installer) instead of the
    // GitHub Releases feed. Production launches never set this variable.
    const feedUrl = process.env.DSH_DESKTOP_UPDATE_FEED_URL
    if (feedUrl !== undefined && feedUrl !== '') {
      autoUpdater.setFeedURL({ provider: 'generic', url: feedUrl })
    }
    updateController = createUpdateController(autoUpdater, sendUpdateStatus)
    sendUpdateStatus(updateController.status())
    updateController.check()
  }
  void bootDesktopRuntime().then(() => {
    runtimeReady = true
    log('info', 'desktop runtime attached')
    maybeFinishSmoke()
    if (PERF_TEST) {
      const win = mainWindow
      if (win === null) {
        console.error('DESKTOP_PERF_TEST_FAIL: no main window')
        app.exit(1)
        return
      }
      void runPerfProbe(win).then((result) => {
        console.log('DESKTOP_PERF_TEST_OK')
        console.log(JSON.stringify(result))
        app.exit(0)
      }).catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        log('error', `perf-test failed: ${detail}`)
        console.error(`DESKTOP_PERF_TEST_FAIL: ${detail}`)
        app.exit(1)
      })
    }
  }).catch((error: unknown) => {
    const detail = inspect(error, { depth: 6, colors: false })
    log('error', `desktop runtime boot failed: ${detail}`)
    if (SMOKE_TEST) {
      console.error(`DESKTOP_RUNTIME_BOOT_FAILED\n${detail}`)
      app.exit(1)
    }
  })
}

/** Graceful shutdown: dispose the Harness tree, then exit. */
async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  log('info', 'shutdown: disposing harness tree')
  const timer = setTimeout(() => {
    log('error', 'shutdown timed out; forcing exit')
    app.exit(0)
  }, SHUTDOWN_TIMEOUT_MS)
  try {
    await disposeDesktopRuntime()
  } catch (error) {
    log('error', `shutdown dispose failed: ${String(error)}`)
  }
  clearTimeout(timer)
  app.exit(0)
}

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', showMainWindow)
  app.on('before-quit', () => {
    isQuitting = true
    void shutdown()
  })
  // The tray owns application lifetime; closing the window hides it.
  app.on('window-all-closed', () => {
    // no-op
  })
  void app.whenReady().then(bootstrap)
}
