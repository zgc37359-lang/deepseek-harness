/**
 * Visible-window E2E for the packaged app: launch the real exe with
 * Playwright's Electron driver, wait for the custom title bar and the mounted
 * Web UI host, exercise window controls (maximize/restore), verify the
 * close-to-tray lifetime, assert the always-visible update entry, simulate the
 * tray new-session flow, verify renderer crash recovery (two reloads then the
 * crash overlay), and save a screenshot to dist-app2/e2e-window.png.
 *
 * DSH_E2E_ISOLATED=1 runs beside a live instance: temp userData + DSH_HOME and
 * no running-instance guard, so the gate never disturbs a real app session.
 *
 * Usage: node scripts/e2e-window.mjs
 */

import { createRequire } from 'node:module'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDesktopRunning } from './mock-llm.mjs'

const requireFromApp = createRequire(import.meta.url)
const { _electron } = requireFromApp('playwright')

const appDir = fileURLToPath(new URL('..', import.meta.url))
const exe = resolve(appDir, 'dist-app2', 'win-unpacked', 'DeepSeek Harness.exe')
const screenshot = resolve(appDir, 'dist-app2', 'e2e-window.png')

const isolated = process.env.DSH_E2E_ISOLATED === '1'
const isolatedDir = isolated ? mkdtempSync(join(tmpdir(), 'dsh-e2e-')) : null
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

if (isDesktopRunning() && !isolated) {
  console.error('DESKTOP_E2E_FAIL: DeepSeek Harness is already running; close it before this gate (or use DSH_E2E_ISOLATED=1)')
  process.exit(1)
}

async function unary(win, method, payload) {
  return win.evaluate(async ({ method, payload }) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'e2e-window', method, payload })
    const raw = await window.desktop.runtime.unary(method, body)
    return JSON.parse(raw.body)
  }, { method, payload })
}

async function sessionCount(win) {
  const res = await unary(win, 'session.list', {})
  return res?.result?.value?.items?.length ?? 0
}

/** Make sure at least one workspace exists and is selected in the UI. */
async function ensureWorkspace(win) {
  const list = await unary(win, 'workspace.list', {})
  const workspaces = list?.result?.value?.items ?? []
  if (workspaces.length === 0) {
    const wsDir = join(isolatedDir ?? tmpdir(), 'e2e-workspace')
    mkdirSync(wsDir, { recursive: true })
    await unary(win, 'workspace.create', { path: wsDir })
    await sleep(2500)
  }
  const chip = win.locator('button').filter({ hasText: /^选择工作区$/ }).first()
  if ((await chip.count()) > 0) {
    await chip.click()
    await sleep(800)
    const item = win.locator('[role=menuitem], [role=option]').first()
    if ((await item.count()) > 0) { await item.click(); await sleep(2500) }
  }
}

const app = await _electron.launch({
  executablePath: exe,
  timeout: 120_000,
  ...isolated
    ? {
        args: [`--user-data-dir=${join(isolatedDir, 'userdata')}`],
        // A key presence skips the first-run "add an API key" onboarding step
        // whose modal mask would otherwise intercept every title-bar click.
        env: { ...process.env, DSH_HOME: join(isolatedDir, 'dshhome'), DEEPSEEK_API_KEY: 'e2e-dummy-key' },
      }
    : {},
})
try {
  const window = await app.firstWindow({ timeout: 120_000 })
  window.on('console', (message) => console.log(JSON.stringify({ console: message.type(), text: message.text() })))
  window.on('pageerror', (error) => console.log(JSON.stringify({ pageerror: String(error) })))
  window.on('requestfailed', (request) => {
    const failure = request.failure()
    console.log(JSON.stringify({ requestfailed: request.url(), error: failure?.errorText }))
  })
  console.log(JSON.stringify({ windowUrl: window.url() }))
  await window.waitForSelector('.titlebar', { timeout: 30_000 })
  await window.waitForSelector('.web-ui-host', { timeout: 90_000 })
  const title = await window.locator('.titlebar__title').textContent()
  const manifest = await window.evaluate(() => window.desktop.runtime.getBootManifest())
  if (manifest === null || manifest.entries.length === 0) {
    throw new Error(`desktop e2e: boot manifest entries are empty: ${JSON.stringify(manifest)}`)
  }

  // Always-visible update entry in the custom title bar (fork feed status).
  await window.waitForSelector('.titlebar__update-button', { timeout: 30_000 })

  // Wait for the onboarding dialog to render (the web UI mounts a moment
  // after the title bar), then dismiss every onboarding step so their modal
  // masks stop intercepting title-bar clicks.
  await window.waitForSelector('[role=dialog]', { timeout: 30_000 }).catch(() => {})
  for (let i = 0; i < 3; i++) {
    const dialogButton = window.locator('[role=dialog] button').filter({ hasText: /继续|保存并继续/ }).first()
    if ((await dialogButton.count()) === 0) break
    await dialogButton.click()
    await window.waitForTimeout(1200)
  }

  // Window controls: maximize then restore through the custom title bar.
  const maximizeBtn = window.locator('.titlebar__button').nth(1)
  await maximizeBtn.click()
  await window.waitForTimeout(800)
  const maximized = await window.evaluate(() => window.desktop.window.isMaximized())
  await maximizeBtn.click()
  await window.waitForTimeout(800)
  const restored = !(await window.evaluate(() => window.desktop.window.isMaximized()))
  if (!maximized || !restored) {
    throw new Error(`desktop e2e: maximize/restore round-trip failed (maximized=${maximized} restored=${restored})`)
  }

  // Tray "new session": simulate the tray menu event and expect a session.
  await ensureWorkspace(window)
  const before = await sessionCount(window)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('tray:new-session')
  })
  let created = false
  for (let i = 0; i < 30 && !created; i++) {
    await window.waitForTimeout(1000)
    created = (await sessionCount(window)) > before
  }
  if (!created) {
    throw new Error(`desktop e2e: tray new-session did not create a session (before=${before})`)
  }

  // Close-to-tray: the close button hides the window but the process stays
  // alive (tray-owned lifetime), and the window can be shown again.
  await window.locator('.titlebar__button--close').click()
  await window.waitForTimeout(1500)
  const trayAlive = await app.evaluate(({ BrowserWindow }) => {
    const wins = BrowserWindow.getAllWindows()
    return wins.length > 0 && wins.every((w) => !w.isVisible())
  })
  if (!trayAlive) {
    throw new Error('desktop e2e: close did not hide the window with the process alive')
  }
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.show()
  })
  await window.waitForTimeout(800)

  await window.screenshot({ path: screenshot })
  console.log(JSON.stringify({ ok: true, title, screenshot, maximized, trayAlive }))

  // Renderer crash recovery (Playwright page bindings die with the renderer,
  // so recovery is asserted through main-process webContents state): the two
  // budgeted crashes auto-reload, the third reload brings the renderer back
  // into the crash-overlay state, and a fourth crash stays dead (no reload
  // loop). The overlay itself is covered by the component spec.
  for (let i = 0; i < 3; i++) {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer()
    })
    await sleep(4000)
  }
  const recovered = await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0]?.webContents
    return { crashed: wc?.isCrashed(), url: wc?.getURL() }
  })
  if (recovered.crashed) {
    throw new Error(`desktop e2e: renderer not recovered after the budget reload: ${JSON.stringify(recovered)}`)
  }
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.forcefullyCrashRenderer()
  })
  await sleep(3000)
  const spent = await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0]?.webContents
    return { crashed: wc?.isCrashed(), url: wc?.getURL() }
  })
  if (!spent.crashed) {
    throw new Error(`desktop e2e: expected the renderer to stay dead once the reload budget is spent: ${JSON.stringify(spent)}`)
  }
  console.log(JSON.stringify({ crashRecovery: 'ok', recovered, spent }))
} catch (error) {
  try {
    const window = app.windows()[0]
    if (window !== undefined) {
      const html = await window.evaluate(() => document.documentElement?.outerHTML.slice(0, 1500) ?? '')
      console.log(JSON.stringify({ failureUrl: window.url(), html }))
    }
  } catch {
    // Diagnostics are best-effort; the original error still propagates.
  }
  throw error
} finally {
  await app.close().catch(() => {})
  if (isolatedDir !== null) rmSync(isolatedDir, { recursive: true, force: true })
}
