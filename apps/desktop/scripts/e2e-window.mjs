/**
 * Visible-window E2E for the packaged app: launch the real exe with
 * Playwright's Electron driver, wait for the custom title bar and the mounted
 * Web UI host, exercise window controls (maximize/restore), verify the
 * close-to-tray lifetime, and save a screenshot to dist-app2/e2e-window.png.
 *
 * Usage: node scripts/e2e-window.mjs
 */

import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDesktopRunning } from './mock-llm.mjs'

const requireFromApp = createRequire(import.meta.url)
const { _electron } = requireFromApp('playwright')

const appDir = fileURLToPath(new URL('..', import.meta.url))
const exe = resolve(appDir, 'dist-app2', 'win-unpacked', 'DeepSeek Harness.exe')
const screenshot = resolve(appDir, 'dist-app2', 'e2e-window.png')

if (isDesktopRunning()) {
  console.error('DESKTOP_E2E_FAIL: DeepSeek Harness is already running; close it before this gate')
  process.exit(1)
}

const app = await _electron.launch({ executablePath: exe, timeout: 120_000 })
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

  // Close-to-tray: the close button hides the window but the process stays
  // alive (tray-owned lifetime), and the window can be shown again.
  await window.locator('.titlebar__button--close').click()
  await window.waitForTimeout(1500)
  const trayAlive = await app.evaluate(() => {
    const { BrowserWindow } = require('electron')
    const wins = BrowserWindow.getAllWindows()
    return wins.length > 0 && wins.every((w) => !w.isVisible())
  })
  if (!trayAlive) {
    throw new Error('desktop e2e: close did not hide the window with the process alive')
  }
  await app.evaluate(() => {
    const { BrowserWindow } = require('electron')
    BrowserWindow.getAllWindows()[0]?.show()
  })
  await window.waitForTimeout(800)

  await window.screenshot({ path: screenshot })
  console.log(JSON.stringify({ ok: true, title, screenshot, maximized, trayAlive }))
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
}
