/**
 * Electron main process for the dsh desktop application: custom window
 * chrome, tray, single-instance, and the whitelisted IPC bridge. The Harness
 * runtime is hosted in this process in a later milestone; this milestone owns
 * the desktop shell lifecycle.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { mkdirSync } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
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
import { MemorySampler } from './memory.ts'
import { writeBase64Stream } from './download.ts'
import { appendLogLine, DEFAULT_LOG_KEEP, DEFAULT_LOG_MAX_BYTES } from './main-log.ts'
import { MAX_RELOAD_AFTER_CRASH, shouldRecoverReload } from './crash-policy.ts'
import { matchBundleRequest } from './bundle-request.ts'
import {
  clampWindowState,
  loadWindowState,
  saveWindowState,
  type WindowState,
} from './window-state.ts'
// electron-updater declares `autoUpdater` as a getter on its CJS exports, which
// Node's ESM named-export interop cannot statically detect; the default import
// (module.exports) always carries it.
import electronUpdater from 'electron-updater'
import { createUpdateController, type UpdateController } from './update.ts'
import { markUpdateChecked, updateCheckDue } from './update-throttle.ts'
import type { UpdateStatus } from './shared/ipc.ts'

const { autoUpdater } = electronUpdater

/** 32x32 tray glyph: blue circle with a white plus. */
const TRAY_ICON_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAAGa0lEQVRYhcVXe1CUVRS/wLK77C58+2QRxdDCt1A21R86apj4zFLzBb7It46TgKmpmdMfNfmoppSaMccoG3NEBxANFfGBNgMC/eGYKSqaNCk2igoJC7u/5pzd7+PbZUGbyenO3Nlv7+Oc3z3nd865VwghQoQQwul0GiWLPTPK4qiSLI4myeLAf9ybzJboX0iHw+EwkU5Zt5AkqYdkcVSYrU5IlmjPU1Du69Eerw5HBen0YuCTO8rM1miacEkWh/tJBdIe375241Z7TLA9JNvl21NGuoVkic5SKQ+qILDbHF341xRl5R5ltvvtMZrM0OlNsNj4tMG6y2sJW5aQLI5zPgDKyQm91eZEpGSDMdKCCKOECJOZ/xtMZohQLY9Fx3RDbLd4Xk8gSI7eICExaRDGT5iICKO5Q0vQuMXuLCcAf6vRE+pwrRGa8AjYo2MR37MXBiQOQu++A1lhQu9+WJGRhcJDh/HnrVs4efIUgyBwZBkhNNi85VNcvlyNcK0BekOUAoJk0zet0+pN0OqMjQRAmSQhGq0BKaPGIifne1y6dBkPHzbg0aNH3Gtr/8Ddu3chN7fbjZTR49gatJ8OQN/5BYU8TzISeveHPiKSFesiIlm+EAITJ01F2sw5YAC0mXxJi77ZuQvweNBZa21tZeXUhyePhBChsPt4QS47cvQYr/N4PLh//z5SRo+FCAnHkKHJmDR5Kt5dtYbnv9yWDUGbZP/9VHREUdDS0sICgnVZOLXbt+swfcZMhPlcRr98CICtRu3M2Z+x+4c9fpajtmDBYgg6NZll27ZsHnS5XIrwxzU1oNVr1jJ3wnVGTJ2Wqihyu9vWyIfzAr+NhF79IGjDiJGjFbPKv08KQnYFtffWrkeoRs/uzM09oMyTLLIoyZblZq5chTBNhBfAnh/3+qEL9PXjWktLK1pbvHvJv8QJmyNGAaG21L179ViRuZIJSW4Xz/RIQF3dHZ68ePE39heFUHNzc9BTdtTkU1LbtHkrhAhDamqaMl9ZWYW56fM5jIkncgYVFEbUiouPK4mCyPT8Cy/hnYwslJWVKwrUIOQTPXjwAHl5Bbh+/YbPGl4QpWfOovxchbI+O/srDj8iPPHObPXqEnPT5/ECCh3KcjRIiyieQ0K17M9Zs9NRU3Pdz00yGLLWuPFvonv8s8grOOgHQm2Vjz7+BCEaPR9OnRXFosXLeEH1lStwOLuycjmpyDmfgHSPfw5FRUd9INpIevNmLYqPl2De/IVMwIqKSh53ufxJl5o2m+cDU7NITZvFC8jnL78ymMkRWEQIiMEocZLJ3X/AzxLkgvr6enYXmXjosGQ0NTX7WYnW9O2fyBYOrJ5i8JDhaGpq4oWr16zjQkMKAwsIISd30Hdp6VkvCBU5iSt9+ydx6r12rcbPFcXFJUGVM4CY2Dhcq/FuIPMFW6QGQRYamDQId+781S7EGhoauHaoo4fakmXLIUJ1QSujoCy469scZdOc9HkICdO1s4LMCYczlq20ZOlyPyWBiUsep9CmQ1KhC2oBjdaAMWNfh8ftFVBdfQVx3XvCGNlWy2mjwSRBhGjYlMRkskR+foEfH9TWkAFQBAUjnwLAYnOyMIplueUXHOQwJJ+TMqrdr6WMwWeff4FefQZwIjFGWdGnXyJqa2v9FKq/d+zYybWhk5sRGABdGhKTXkRdXZ0iZF/ufr4VEbhwnQkT3pjE4+T7hYuW8ji5gsqrq8WlWEBWnpdfgDCNDlGSrXMAko9cZKbJU6Zz/MpCKiqqMOzVEWwNrd6I06dLFYA53+2GM6Ybhx7xxuVjfLPLC+bYseN4a8oM5a7REbmFmuGhYTpOGI2NjYoiCtETJ08hLy+f45nDy+fzyqoqTJmWygSj202Db5+aC1evXuXQpBwSlIRSQJiRJYYOT8aFC7+2Y7dcrqn6NTd77w3UaezGjd+xectWvL9hIwoLD7G1SkpOYPv2r9E1rkfHUSCpLqVy1tPqjEy+des3KDWgs3b+/HnMmfs2k5UihThFKZ1OHRqm7cwFjR1cy70XVHKJs0scc2PTpi3Yu3cfDh0uQn7+Qc4dH2z8EKPGjPeu1ejZ33L9UFs1iHK3b6xc0OPA91xyBXvdkHAKO7puUzTQXZ9O2DZmVBR1xPSOHyb2zMc+zWQgdDK5SqrH/qXi9k8z8b8/TtXPc6s942k+z6PoeW61Z6if5/8As9GN7ecyyasAAAAASUVORK5CYII='

const MIN_WINDOW_WIDTH = 800
const MIN_WINDOW_HEIGHT = 560
const WINDOW_STATE_SAVE_DELAY_MS = 500
const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000
const SMOKE_TEST = process.argv.includes('--smoke-test')
// Keep the default Electron menu (and its reload/devtools accelerators) only
// when an explicit debug flag is present; production boots menu-less.
const DEBUG_MODE = process.argv.includes('--debug') || process.env.DSH_DESKTOP_DEBUG === '1'
const PTY_PROBE = process.argv.includes('--pty-probe')
const BENCH_STREAM = process.argv.includes('--bench-stream')
const PERF_TEST = process.argv.includes('--perf-test')
const SMOKE_TIMEOUT_MS = 120_000
const SHUTDOWN_TIMEOUT_MS = 10_000
const MEMORY_SAMPLE_INTERVAL_MS = (() => {
  const parsed = Number(process.env.DSH_DESKTOP_MEMORY_SAMPLE_MS)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 60_000
})()

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let rendererCrashes = 0
let smokePings = 0
let smokeTimer: NodeJS.Timeout | undefined
let runtimeReady = false
let shuttingDown = false
let updateController: UpdateController | null = null
let windowState: WindowState | undefined
let windowStateTimer: NodeJS.Timeout | null = null

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

// Windows toast/taskbar identity; without it notifications come from
// "Electron" and taskbar grouping uses the executable path.
app.setAppUserModelId('com.deepseek-ai.dsh-desktop')

const userDataDir = app.getPath('userData')
const logFile = join(userDataDir, 'logs', 'main.log')
const windowStateFile = join(userDataDir, 'window-state.json')
const updateCheckFile = join(userDataDir, 'update-last-check.txt')

/** Parse a positive integer environment override, falling back when unset. */
function positiveEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

/** Rotation budget from the environment; defaults keep main.log bounded. */
const logMaxBytes = positiveEnv('DSH_DESKTOP_LOG_MAX_BYTES', DEFAULT_LOG_MAX_BYTES)
const logKeep = positiveEnv('DSH_DESKTOP_LOG_KEEP', DEFAULT_LOG_KEEP)

/** Append one timestamped line to the main-process log (rotating at the budget). */
function log(level: 'info' | 'warn' | 'error', message: string): void {
  appendLogLine(logFile, level, message, { maxBytes: logMaxBytes, keep: logKeep })
}

const memorySampler = new MemorySampler(MEMORY_SAMPLE_INTERVAL_MS, (sample) => {
  log('info', `memory sample ${JSON.stringify(sample)}`)
})

// Desktop launches may start with stdout/stderr already closed (Explorer,
// Start-Process, test harness teardown). Node's default warning printer
// writes to stderr, and the resulting EPIPE surfaces as an uncaught
// main-process exception that Electron shows as a JavaScript error dialog.
// Route warnings into the main-process log instead, and contain the EPIPE
// case specifically.
// Known dependency warning (Electron runtime, not our code): log once per
// message instead of every boot so main.log stays readable.
const seenWarnings = new Set<string>()
process.on('warning', (warning) => {
  if (seenWarnings.has(warning.message)) return
  seenWarnings.add(warning.message)
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

/** Save the current window bounds and maximized flag for the next launch. */
async function persistWindowState(): Promise<void> {
  const win = mainWindow
  if (win === null) return
  const bounds = win.getBounds()
  await saveWindowState(windowStateFile, { ...bounds, maximized: win.isMaximized() })
}

/** Debounce geometry persistence across resize/move/maximize events. */
function scheduleWindowStateSave(): void {
  if (windowStateTimer !== null) clearTimeout(windowStateTimer)
  windowStateTimer = setTimeout(() => { void persistWindowState() }, WINDOW_STATE_SAVE_DELAY_MS)
}

/** Create the frameless main window with the sandboxed renderer. */
function createMainWindow(): void {
  const bounds = clampWindowState(
    windowState,
    screen.getAllDisplays().map(display => ({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
    })),
    MIN_WINDOW_WIDTH,
    MIN_WINDOW_HEIGHT,
  )
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
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
  if (bounds.x !== undefined && bounds.y !== undefined) win.setPosition(bounds.x, bounds.y)
  if (bounds.maximized) win.maximize()

  win.once('ready-to-show', () => {
    if (!SMOKE_TEST) win.show()
  })
  win.on('maximize', () => {
    win.webContents.send(IPC.windowMaximizedChanged, true)
    scheduleWindowStateSave()
  })
  win.on('unmaximize', () => {
    win.webContents.send(IPC.windowMaximizedChanged, false)
    scheduleWindowStateSave()
  })
  win.on('resize', scheduleWindowStateSave)
  win.on('move', scheduleWindowStateSave)
  win.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      win.hide()
    }
    void persistWindowState()
  })
  win.on('blur', stopWindowDrag)
  win.on('closed', () => {
    mainWindow = null
  })
  win.webContents.on('render-process-gone', (_event, details) => {
    log('error', `renderer gone: ${details.reason}`)
    memorySampler.take()
    if (isQuitting || SMOKE_TEST) return
    rendererCrashes += 1
    // Budget: two auto-reloads, plus one reload that brings a live renderer
    // back to surface the crash overlay (a dead renderer shows nothing).
    if (shouldRecoverReload(rendererCrashes)) {
      win.webContents.reload()
    }
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
    const path = await collectDiagnostics(
      root,
      logFile,
      currentAppInfo(),
      app.getPath('crashDumps'),
      memorySampler.snapshot(),
    )
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

  ipcMain.handle(IPC.downloadSave, async (_event, filename: unknown, bytesBase64: unknown) => {
    if (!isDownloadFilename(filename) || !isBase64Payload(bytesBase64)) {
      return { ok: false, error: 'invalid download arguments' }
    }
    const safeName = sanitizeDownloadFilename(filename)
    const downloads = app.getPath('downloads')
    mkdirSync(downloads, { recursive: true })
    const path = join(downloads, safeName)
    try {
      const written = await writeBase64Stream(path, bytesBase64)
      const size = (await stat(path)).size
      if (size !== written) {
        await rm(path, { force: true })
        throw new Error(`download size mismatch: wrote ${written}, disk has ${size}`)
      }
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

  ipcMain.handle(IPC.shellCrashState, () => {
    return { crashed: rendererCrashes > MAX_RELOAD_AFTER_CRASH }
  })

  ipcMain.handle(IPC.shellResetCrash, () => {
    rendererCrashes = 0
  })

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
  tray.setToolTip('Harness Desktop')
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
async function bootstrap(): Promise<void> {
  if (!DEBUG_MODE) Menu.setApplicationMenu(null)
  windowState = await loadWindowState(windowStateFile)
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
    const id = matchBundleRequest(new URL(request.url))
    if (id === null) return new Response('not found', { status: 404 })
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
  memorySampler.start()
  memorySampler.take()
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
    // Boot-time automatic checks are throttled to one per day; the manual
    // "检查更新" button bypasses the gate through the updatesCheck IPC.
    void updateCheckDue(updateCheckFile, UPDATE_CHECK_INTERVAL_MS).then((due) => {
      if (!due) return
      void markUpdateChecked(updateCheckFile)
      updateController?.check()
    })
  }
  void bootDesktopRuntime().then(() => {
    runtimeReady = true
    log('info', 'desktop runtime attached')
    memorySampler.take()
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
    memorySampler.take()
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
  memorySampler.take()
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
  memorySampler.stop()
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
