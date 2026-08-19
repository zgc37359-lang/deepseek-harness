/**
 * Capture real running screenshots of the packaged Harness Desktop app for
 * the README: main window, an answered conversation, and the settings page.
 * Runs in isolated mode (temp userData + DSH_HOME) with the mock LLM so it
 * never disturbs a live instance and needs no API key.
 *
 * Usage: node scripts/capture-screenshots.mjs   (after dist:flat packaging)
 */

import { _electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mockLlmEnv } from './mock-llm.mjs'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const exe = resolve(appDir, 'dist-app2', 'win-unpacked', 'Harness Desktop.exe')
const outDir = resolve(appDir, 'docs')
const isolatedDir = mkdtempSync(join(tmpdir(), 'dsh-shots-'))
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))

const llm = await mockLlmEnv('你好！我是 Harness Desktop 里的 Agent，运行在你自己的电脑上。我可以帮你写代码、搜索资料、操作文件系统，全程本地执行、不占端口。')

async function main() {
  const app = await _electron.launch({
    executablePath: exe,
    timeout: 120000,
    args: ['--user-data-dir=' + join(isolatedDir, 'userdata')],
    env: { ...llm.env, DSH_HOME: join(isolatedDir, 'dshhome') },
  })
  const win = await app.firstWindow({ timeout: 120000 })
  win.on('console', (message) => {
    if (message.type() === 'error') console.log(JSON.stringify({ consoleError: message.text().slice(0, 200) }))
  })
  await win.waitForSelector('.titlebar', { timeout: 30000 })
  await win.waitForSelector('.web-ui-host', { timeout: 90000 })

  // Dismiss onboarding dialogs so their modal masks do not cover the UI.
  await win.waitForSelector('[role=dialog]', { timeout: 30000 }).catch(() => {})
  for (let i = 0; i < 3; i++) {
    const dialogButton = win.locator('[role=dialog] button').filter({ hasText: /继续|保存并继续/ }).first()
    if ((await dialogButton.count()) === 0) break
    await dialogButton.click()
    await win.waitForTimeout(1200)
  }

  const unary = (method, payload) => win.evaluate(async ({ method, payload }) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'shots', method, payload })
    const raw = await window.desktop.runtime.unary(method, body)
    return JSON.parse(raw.body)
  }, { method, payload })

  // Workspace: create one if the isolated home has none, then select it.
  const wsDir = join(isolatedDir, 'workspace')
  mkdirSync(wsDir, { recursive: true })
  const wsList = await unary('workspace.list', {})
  if ((wsList?.result?.value?.items ?? []).length === 0) {
    await unary('workspace.create', { path: wsDir })
    await sleep(2500)
  }
  const chip = win.locator('button').filter({ hasText: /^选择工作区$/ }).first()
  if ((await chip.count()) > 0) {
    await chip.click()
    await sleep(800)
    const item = win.locator('[role=menuitem], [role=option]').first()
    if ((await item.count()) > 0) { await item.click(); await sleep(2500) }
  }

  // New session via the tray lane, then wait for it to appear.
  const before = await unary('session.list', {})
  const beforeCount = before?.result?.value?.items?.length ?? 0
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('tray:new-session')
  })
  let sessionId = null
  for (let i = 0; i < 30 && sessionId === null; i++) {
    await sleep(1000)
    const now = await unary('session.list', {})
    const items = now?.result?.value?.items ?? []
    const fresh = items.find((s) => !(s.sessionId in {}) && items.indexOf(s) >= beforeCount)
    if (fresh !== undefined) sessionId = fresh.sessionId
    else if (items.length > beforeCount) sessionId = items[items.length - 1].sessionId
  }
  if (sessionId === null) throw new Error('new session did not appear')
  await sleep(1500)

  // Focus and restore the window so the screenshot shows the real geometry.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]
    if (w.isMaximized()) w.unmaximize()
    w.focus()
    w.moveTop()
  })
  await sleep(800)
  await win.screenshot({ path: join(outDir, 'screenshot-main.png') })
  console.log(JSON.stringify({ shot: 'main', sessionId }))

  // Ask one question and wait for the mock answer to settle.
  const ta = win.locator('textarea').first()
  await ta.click()
  await win.keyboard.type('你好，简单介绍一下你自己')
  await win.keyboard.press('Enter')
  let settled = false
  for (let i = 0; i < 60 && !settled; i++) {
    await sleep(1000)
    const hist = await unary('session.history', { sessionId })
    const events = hist?.result?.value?.events ?? []
    settled = events.some((e) => e.event?.type === 'turn/end')
  }
  if (!settled) throw new Error('mock turn did not settle')
  await sleep(1500)
  await win.screenshot({ path: join(outDir, 'screenshot-chat.png') })
  console.log(JSON.stringify({ shot: 'chat', settled }))

  // Settings page.
  const settings = win.locator('button').filter({ hasText: /^设置$/ }).first()
  const expanded = await settings.getAttribute('aria-expanded')
  if (expanded !== 'true') await settings.click()
  await sleep(1200)
  const general = win.locator('button').filter({ hasText: /^通用设置$/ }).first()
  if ((await general.count()) > 0) {
    await general.click()
    await sleep(1000)
  }
  await win.screenshot({ path: join(outDir, 'screenshot-settings.png') })
  console.log(JSON.stringify({ shot: 'settings' }))

  await app.close().catch(() => {})
}

try {
  await main()
} finally {
  rmSync(isolatedDir, { recursive: true, force: true })
  await llm.close()
}
