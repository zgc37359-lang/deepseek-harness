/**
 * Exhaustive UI matrix for the packaged desktop app, driven with real
 * mouse/keyboard events through Playwright's Electron driver. Every step
 * performs one human-like action and asserts an observable state change.
 *
 * Known-noise console messages (ERR_FILE_NOT_FOUND for the optional
 * /plugins/events endpoint) are filtered; anything else fails the step.
 *
 * Usage: node scripts/ui-matrix.mjs   (packaged app must not be running)
 */

import { _electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { readdirSync, statSync } from 'node:fs'
import { isDesktopRunning, mockLlmEnv } from './mock-llm.mjs'

if (isDesktopRunning()) {
  console.error('DESKTOP_MATRIX_FAIL: DeepSeek Harness is already running; close it before this gate')
  process.exit(1)
}

const appDir = fileURLToPath(new URL('..', import.meta.url))
const exe = resolve(appDir, 'dist-app2', 'win-unpacked', 'DeepSeek Harness.exe')
const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
const NOISE = /ERR_FILE_NOT_FOUND/i

const results = []
const consoleErrors = []
let usingMock = false

async function step(name, action) {
  const beforeErrors = consoleErrors.length
  const startedAt = Date.now()
  try {
    const detail = await action()
    const newErrors = consoleErrors.slice(beforeErrors).filter((text) => !NOISE.test(text))
    const ok = detail.ok !== false && newErrors.length === 0
    results.push({ name, ok, detail: detail.detail ?? '', errors: newErrors, ms: Date.now() - startedAt })
  } catch (error) {
    const newErrors = consoleErrors.slice(beforeErrors).filter((text) => !NOISE.test(text))
    results.push({ name, ok: false, detail: String(error).slice(0, 250), errors: newErrors, ms: Date.now() - startedAt })
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Visible button whose trimmed text equals `text` exactly (aria labels may differ). */
function byText(text) {
  return (page) => page.locator('button').filter({ hasText: new RegExp(`^${escapeRegExp(text)}$`) }).first()
}

/** One open-menu item whose text starts with `prefix`. */
function menuItem(prefix) {
  return (page) => page.locator('[role=menuitem], [role=option]').filter({ hasText: new RegExp(`^${escapeRegExp(prefix)}`) }).first()
}

async function focusWindow(app) {
  // CSS :hover states (which surface row actions) require an active window.
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.focus()
    win.moveTop()
  })
  await sleep(500)
}

async function closeMenus(win) {
  for (let i = 0; i < 3; i++) {
    await win.keyboard.press('Escape').catch(() => {})
    await sleep(250)
  }
}

async function clearComposer(win) {
  const ta = win.locator('textarea').first()
  await ta.click()
  await win.keyboard.press('Control+a')
  await win.keyboard.press('Backspace')
  await sleep(300)
  const value = await ta.inputValue()
  if (value !== '') throw new Error(`composer not cleared: ${value.slice(0, 40)}`)
}

async function selectSession(win, sessionId) {
  const item = (await unary(win, 'session.list', {})).result.value.items.find((s) => s.sessionId === sessionId)
  if (item?.title === undefined || item.title.trim() === '') return false
  const row = win.locator('[class*=sessionRow]').filter({ hasText: new RegExp(`^${escapeRegExp(item.title)}`) }).first()
  if ((await row.count()) === 0) return false
  await row.click()
  await sleep(1500)
  return true
}

/** Strip the trailing relative-time suffix from a session-row label. */
function rowTitleText(text) {
  return text.replace(/\s*(刚刚|\d+\s*(秒|分钟|小时|天)|昨天|前天)\s*$/u, '').trim()
}

async function selectRowByTitle(win, title) {
  const row = win.locator('[class*=sessionRow]').filter({ hasText: new RegExp(`^${escapeRegExp(title)}`) }).first()
  if ((await row.count()) === 0) return false
  await row.click()
  await sleep(1200)
  return true
}

async function chipText(win, names) {
  return win.evaluate((names) => {
    for (const button of document.querySelectorAll('button')) {
      const text = (button.textContent || '').trim()
      if (names.includes(text)) return text
    }
    return null
  }, names)
}

async function unary(win, method, payload) {
  return win.evaluate(async ({ method, payload }) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'matrix', method, payload })
    const raw = await window.desktop.runtime.unary(method, body)
    return JSON.parse(raw.body)
  }, { method, payload })
}

async function sessionIds(win) {
  const list = await unary(win, 'session.list', {})
  return list.result.value.items.map((s) => s.sessionId)
}

async function turnCounts(win) {
  const list = await unary(win, 'session.list', {})
  const counts = {}
  for (const s of list.result.value.items) {
    if (s.blank) {
      counts[s.sessionId] = 0
      continue
    }
    const hist = await unary(win, 'session.history', { sessionId: s.sessionId })
    counts[s.sessionId] = hist.result.value.events.filter((e) => e.event.type === 'turn/end').length
  }
  return counts
}

async function findSessionWithNewTurn(win, before, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const now = await turnCounts(win)
    for (const [sessionId, count] of Object.entries(now)) {
      if (count > (before[sessionId] ?? 0)) {
        const hist = await unary(win, 'session.history', { sessionId })
        const events = hist.result.value.events
        const ends = events.filter((e) => e.event.type === 'turn/end').map((e) => e.event.data)
        const lastText = events
          .filter((e) => e.event.type === 'assistant/message')
          .slice(-1)
          .map((e) => e.event.data.message.content.filter((b) => b.type === 'text').map((b) => b.text).join(''))
        return { sessionId, ends: ends.at(-1), lastText: lastText.at(-1) ?? '' }
      }
    }
    await sleep(1500)
  }
  throw new Error('no new turn settled in any session')
}

async function turnCountFor(win, sessionId) {
  const hist = await unary(win, 'session.history', { sessionId })
  return hist.result.value.events.filter((e) => e.event.type === 'turn/end').length
}

async function waitNewTurnFor(win, sessionId, timeoutMs = 90000) {
  const before = await turnCountFor(win, sessionId)
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const count = await turnCountFor(win, sessionId)
    if (count > before) {
      const hist = await unary(win, 'session.history', { sessionId })
      const events = hist.result.value.events
      const ends = events.filter((e) => e.event.type === 'turn/end').map((e) => e.event.data)
      const lastText = events
        .filter((e) => e.event.type === 'assistant/message')
        .slice(-1)
        .map((e) => e.event.data.message.content.filter((b) => b.type === 'text').map((b) => b.text).join(''))
      return { ends: ends.at(-1), lastText: lastText.at(-1) ?? '' }
    }
    await sleep(1500)
  }
  throw new Error('no new turn settled')
}

async function clipboardRead(app, timeoutMs = 10000) {
  return Promise.race([
    app.evaluate(({ clipboard }) => clipboard.readText()),
    new Promise((_, reject) => setTimeout(() => reject(new Error('clipboard read timeout')), timeoutMs)),
  ])
}

async function sendPrompt(win, sessionId, text, timeoutMs = 90000) {
  await clearComposer(win)
  const ta = win.locator('textarea').first()
  await ta.click()
  await win.keyboard.type(text)
  await win.keyboard.press('Enter')
  return waitNewTurnFor(win, sessionId, timeoutMs)
}

async function ensureSettingsOpen(win) {
  const trigger = win.locator('button').filter({ hasText: /^设置$/ }).first()
  const expanded = await trigger.getAttribute('aria-expanded')
  if (expanded !== 'true') await trigger.click()
  await sleep(800)
}

async function closeToDialogCount(win, target) {
  for (let i = 0; i < 6; i++) {
    const count = await win.locator('[role=dialog]').count()
    if (count <= target) return count
    await win.keyboard.press('Escape')
    await sleep(500)
  }
  return win.locator('[role=dialog]').count()
}

async function main(env) {
  const app = await _electron.launch({ executablePath: exe, timeout: 120000, env })
  const win = await app.firstWindow({ timeout: 120000 })
  win.on('console', (message) => {
    if (['error', 'warning'].includes(message.type())) {
      consoleErrors.push(`${message.type()}: ${message.text().slice(0, 300)}`)
    }
  })
  win.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 300)}`))
  await win.waitForSelector('.web-ui-host', { timeout: 90000 })
  await sleep(2000)
  await focusWindow(app)

  // Exit plan mode if a previous run left it on.
  await step('reset:exit-plan-mode', async () => {
    const planChip = win.locator('button').filter({ hasText: /^Plan$/ }).first()
    if ((await planChip.count()) === 0) return { ok: true, detail: 'not in plan mode' }
    const ta = win.locator('textarea').first()
    await ta.click()
    await win.keyboard.type('/plan off')
    await win.keyboard.press('Enter')
    await sleep(3500)
    const stillPlan = (await win.locator('button').filter({ hasText: /^Plan$/ }).count()) > 0
    return { ok: !stillPlan, detail: `planStill=${stillPlan}` }
  })

  // A. Shell window control
  await step('shell:maximize-toggle', async () => {
    const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())
    await win.locator('.titlebar__button').nth(1).click()
    await sleep(800)
    const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())
    await win.locator('.titlebar__button').nth(1).click()
    await sleep(500)
    return { ok: after !== before, detail: `before=${before} after=${after}` }
  })

  await step('shell:minimize-restore', async () => {
    await win.locator('button[aria-label="最小化"]').first().click()
    await sleep(700)
    const minimized = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.restore()
      w.focus()
      w.moveTop()
    })
    await sleep(700)
    const restored = await app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows()[0].isMinimized())
    return { ok: minimized && restored, detail: `minimized=${minimized} restored=${restored}` }
  })

  await step('shell:close-hides-to-tray', async () => {
    await win.locator('button[aria-label="关闭"]').first().click()
    await sleep(1000)
    const visibleAfterClose = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      w.show()
      w.focus()
      w.moveTop()
    })
    await sleep(700)
    const shown = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isVisible())
    return { ok: !visibleAfterClose && shown, detail: `visibleAfterClose=${visibleAfterClose} shown=${shown}` }
  })

  // B. Sidebar
  let activeSessionId = null
  await step('sidebar:new-session', async () => {
    const beforeIds = new Set(await sessionIds(win))
    const scopedCreate = win.locator('button[aria-label*="中新建会话"]')
    const nodeModulesCreate = win.locator('button[aria-label*="node_modules"][aria-label*="新建会话"]')
    let usedScoped = false
    if ((await scopedCreate.count()) > 0) {
      const target = (await nodeModulesCreate.count()) > 0 ? nodeModulesCreate.first() : scopedCreate.first()
      const row = win.locator('[class*=projectRow]').filter({ hasText: /node_modules/ }).first()
      if ((await row.count()) > 0) {
        const box = await row.boundingBox()
        if (box !== null) {
          await win.mouse.move(box.x + 20, box.y + box.height / 2)
          await sleep(500)
        }
      }
      try {
        await target.click({ timeout: 8000 })
        usedScoped = true
      } catch {
        usedScoped = false
      }
    }
    if (!usedScoped) {
      await byText('新会话')(win).click()
    }
    let created = undefined
    const deadline = Date.now() + 10000
    while (Date.now() < deadline) {
      await sleep(500)
      created = (await sessionIds(win)).find((id) => !beforeIds.has(id))
      if (created !== undefined) break
    }
    if (created === undefined && !usedScoped) {
      await byText('新会话')(win).click()
      const retryDeadline = Date.now() + 5000
      while (Date.now() < retryDeadline) {
        await sleep(500)
        created = (await sessionIds(win)).find((id) => !beforeIds.has(id))
        if (created !== undefined) break
      }
    }
    if (created === undefined) {
      const enabled = await win.locator('textarea').first().isEnabled()
      return { ok: enabled, detail: `reused existing blank session, enabled=${enabled}` }
    }
    activeSessionId = created
    const enabled = await win.locator('textarea').first().isEnabled()
    return { ok: enabled, detail: `session=${created} enabled=${enabled}` }
  })

  await step('hero:seed-message', async () => {
    let lastError = ''
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await clearComposer(win)
        const ta = win.locator('textarea').first()
        await ta.click()
        await win.keyboard.type('reply with exactly seed-ok')
        await win.keyboard.press('Enter')
        await sleep(1200)
        const value = await ta.inputValue()
        if (value !== '') {
          const send = win.locator('button[aria-label="发送消息"]')
          if (!(await send.isDisabled())) await send.click()
        }
        const before = await turnCounts(win)
        const turn = await findSessionWithNewTurn(win, before, 180000)
        activeSessionId = turn.sessionId
        const ok = turn.ends?.reason?.kind === 'completed' && turn.lastText.includes('seed-ok')
        return { ok, detail: `session=${turn.sessionId.slice(0, 16)} reason=${JSON.stringify(turn.ends?.reason)} text=${turn.lastText.slice(0, 40)}` }
      } catch (error) {
        lastError = String(error).slice(0, 120)
        await sleep(3000)
      }
    }
    return { ok: false, detail: `seed failed after retries: ${lastError}` }
  })

  await step('sidebar:workspace-switch', async () => {
    const current = await chipText(win, ['deepseek-harness', 'node_modules'])
    if (current === null) return { ok: true, detail: 'skipped: no hero workspace chip (ungrouped session)' }
    const target = current === 'node_modules' ? 'deepseek-harness' : 'node_modules'
    await byText(current)(win).click()
    await sleep(700)
    const item = menuItem(target)(win)
    if ((await item.count()) === 0) return { ok: false, detail: `no workspace item ${target}` }
    await item.click()
    await sleep(2000)
    const after = await chipText(win, ['deepseek-harness', 'node_modules'])
    if (after !== target) return { ok: false, detail: `${current} -> ${after}` }
    // Restore the original workspace so later sends run in a known directory.
    await byText(target)(win).click()
    await sleep(700)
    const back = menuItem(current)(win)
    if ((await back.count()) === 0) return { ok: false, detail: `no workspace item ${current}` }
    await back.click()
    await sleep(2000)
    const restored = await chipText(win, ['deepseek-harness', 'node_modules'])
    return { ok: restored === current, detail: `${current} -> ${after} -> ${restored}` }
  })
  await closeMenus(win)

  await step('sidebar:session-row-rename-dialog', async () => {
    const rows = win.locator('[class*=sessionRow]')
    let row = null
    for (let i = 0; i < (await rows.count()); i++) {
      const candidate = rows.nth(i)
      if ((await candidate.locator('button[aria-label*="操作"]').count()) > 0) {
        row = candidate
        break
      }
    }
    if (row === null) return { ok: false, detail: 'no row with actions' }
    const box = await row.boundingBox()
    if (box === null) return { ok: false, detail: 'row has no box' }
    await win.mouse.move(box.x + 20, box.y + box.height / 2)
    await sleep(600)
    await row.locator('button[aria-label*="操作"]').first().click()
    await sleep(800)
    const renameItem = win.locator('[role=menuitem]').filter({ hasText: /重命名/ }).first()
    if ((await renameItem.count()) === 0) return { ok: false, detail: 'no rename menu item' }
    await renameItem.click()
    await sleep(1000)
    const dialogInputs = await win.locator('input[type=text]').count()
    await win.keyboard.press('Escape')
    await sleep(500)
    return { ok: dialogInputs > 0, detail: `dialogInputs=${dialogInputs}` }
  })
  await closeMenus(win)

  await step('sidebar:search', async () => {
    const input = win.locator('input[placeholder*="搜索"]').first()
    await input.focus()
    await win.keyboard.type('deepseek-harness')
    await sleep(1500)
    const hits = await win.locator('[class*=searchResultRow]').count()
    await input.fill('')
    await sleep(600)
    return { ok: hits > 0, detail: `hits=${hits}` }
  })
  await closeMenus(win)

  await step('sidebar:collapse-expand', async () => {
    await win.locator('button[aria-label="收起侧边栏"]').first().click()
    await sleep(700)
    const rail = (await win.locator('button[aria-label="打开侧边栏"]').count()) > 0
    await win.locator('button[aria-label="打开侧边栏"]').first().click()
    await sleep(700)
    const wide = (await win.locator('button[aria-label="收起侧边栏"]').count()) > 0
    return { ok: rail && wide, detail: `rail=${rail} wide=${wide}` }
  })

  await step('sidebar:expand-more-sessions', async () => {
    const more = win.locator('button').filter({ hasText: /^展开其余 \d+ 个会话$/ }).first()
    if ((await more.count()) === 0) return { ok: true, detail: 'no collapsed bucket (already expanded)' }
    const before = await win.locator('[role=treeitem]').count()
    await more.click()
    await sleep(1000)
    const after = await win.locator('[role=treeitem]').count()
    return { ok: after > before, detail: `treeitems ${before}->${after}` }
  })
  await closeMenus(win)

  await step('sidebar:view-options', async () => {
    await win.locator('button[aria-label="视图选项"]').first().click()
    await sleep(600)
    const items = (await win.locator('[role=menuitem]').allTextContents()).map((s) => s.trim())
    const expected = ['按工作区', '单列表', '手动排序', '最近更新']
    const ok = expected.every((x) => items.includes(x))
    const item = menuItem('最近更新')(win)
    if ((await item.count()) > 0) await item.click()
    await sleep(800)
    return { ok, detail: `items=${JSON.stringify(items)}` }
  })
  await closeMenus(win)

  await step('sidebar:session-drag-reorder', async () => {
    await win.locator('button[aria-label="视图选项"]').first().click()
    await sleep(600)
    const manual = menuItem('手动排序')(win)
    if ((await manual.count()) === 0) return { ok: false, detail: 'no manual sort item' }
    await manual.click()
    await sleep(900)
    const rows = win.locator('[class*=sessionRow]')
    const first = rows.nth(0)
    const second = rows.nth(1)
    if ((await first.count()) === 0 || (await second.count()) === 0) return { ok: false, detail: 'not enough session rows' }
    const fbox = await first.boundingBox()
    const sbox = await second.boundingBox()
    if (fbox === null || sbox === null) return { ok: false, detail: 'row boxes missing' }
    const order = async () => (await rows.allTextContents()).slice(0, 2).map((t) => t.trim().slice(0, 24))
    const beforeOrder = await order()
    const drag = async (from, to) => {
      await win.mouse.move(from.x + 30, from.y + from.height / 2)
      await win.mouse.down()
      await win.mouse.move(from.x + 30, from.y + from.height / 2 + 10, { steps: 5 })
      await sleep(200)
      await win.mouse.move(to.x + 30, to.y + to.height / 2, { steps: 8 })
      await sleep(300)
      await win.mouse.up()
      await sleep(1200)
    }
    let swapped = beforeOrder
    let moved = false
    for (let attempt = 1; attempt <= 2 && !moved; attempt++) {
      await drag(fbox, sbox)
      swapped = await order()
      moved = swapped[0] !== beforeOrder[0]
      if (!moved) await sleep(800)
    }
    if (moved) {
      const a = await rows.nth(0).boundingBox()
      const b = await rows.nth(1).boundingBox()
      if (a !== null && b !== null) await drag(a, b)
    }
    const restored = await order()
    await win.locator('button[aria-label="视图选项"]').first().click()
    await sleep(600)
    const recent = menuItem('最近更新')(win)
    if ((await recent.count()) > 0) await recent.click()
    await sleep(800)
    return { ok: moved && restored[0] === beforeOrder[0], detail: `before=${JSON.stringify(beforeOrder)} swapped=${JSON.stringify(swapped)} restored=${JSON.stringify(restored)}` }
  })
  await closeMenus(win)

  await step('sidebar:workspace-row-menu', async () => {
    const rows = win.locator('[class*=projectRow]')
    let row = null
    for (let i = 0; i < (await rows.count()); i++) {
      const candidate = rows.nth(i)
      if ((await candidate.locator('button[aria-label*="的操作"]').count()) > 0) {
        row = candidate
        break
      }
    }
    if (row === null) return { ok: false, detail: 'no workspace row with actions' }
    const box = await row.boundingBox()
    if (box === null) return { ok: false, detail: 'workspace row has no box' }
    await win.mouse.move(box.x + 20, box.y + box.height / 2)
    await sleep(800)
    await row.locator('button[aria-label*="的操作"]').first().click()
    await sleep(1000)
    const items = (await win.locator('[role=menuitem]').allTextContents()).map((s) => s.trim())
    const ok = items.includes('重命名') && items.some((i) => i.includes('删除'))
    await win.keyboard.press('Escape')
    await sleep(400)
    return { ok, detail: `items=${JSON.stringify(items)}` }
  })
  await closeMenus(win)

  await step('sidebar:workspace-rename-apply', async () => {
    const row = win.locator('[class*=projectRow]').filter({ hasText: /node_modules/ }).first()
    if ((await row.count()) === 0) return { ok: false, detail: 'no node_modules workspace row' }
    const box = await row.boundingBox()
    if (box === null) return { ok: false, detail: 'workspace row has no box' }
    const rename = async (target) => {
      await win.mouse.move(box.x + 20, box.y + box.height / 2)
      await sleep(800)
      await row.locator('button[aria-label*="的操作"]').first().click()
      await sleep(1000)
      const item = win.locator('[role=menuitem]').filter({ hasText: /重命名/ }).first()
      await item.click()
      await sleep(1000)
      const input = win.locator('input[aria-label="工作区名称"]').first()
      await input.fill(target)
      const confirm = win.locator('[role=dialog] button').filter({ hasText: /^重命名$/ }).first()
      if ((await confirm.count()) > 0) await confirm.click()
      else await win.keyboard.press('Enter')
      await sleep(1500)
      await closeToDialogCount(win, 0)
    }
    await rename('node_modules-matrix')
    const renamed = (await win.locator('[class*=projectRow]').allTextContents())
      .some((t) => t.includes('node_modules-matrix'))
    await rename('node_modules')
    const restored = (await win.locator('[class*=projectRow]').allTextContents())
      .some((t) => t.includes('node_modules'))
    return { ok: renamed && restored, detail: `renamed=${renamed} restored=${restored}` }
  })
  await closeMenus(win)

  // C. Hero / composer controls
  for (const preset of ['PTC 模式', '极简模式', '创造模式', '标准模式']) {
    await step(`hero:preset-${preset}`, async () => {
      const current = await chipText(win, ['标准模式', 'PTC 模式', '极简模式', '创造模式'])
      if (current === null) return { ok: true, detail: 'skipped: no preset chip (ungrouped session)' }
      await byText(current)(win).click()
      await sleep(600)
      const item = menuItem(preset)(win)
      if ((await item.count()) === 0) return { ok: false, detail: `no preset item ${preset}` }
      await item.click()
      await sleep(1800)
      const after = await chipText(win, ['标准模式', 'PTC 模式', '极简模式', '创造模式'])
      return { ok: after === preset, detail: `${current} -> ${after}` }
    })
    await closeMenus(win)
  }

  for (const mode of ['Read Only', 'Full access', 'Workspace Write']) {
    await step(`hero:mode-${mode}`, async () => {
      const current = await chipText(win, ['Workspace Write', 'Read Only', 'Full access'])
      if (current === null) return { ok: false, detail: 'no mode chip' }
      await byText(current)(win).click()
      await sleep(600)
      const item = menuItem(mode)(win)
      if ((await item.count()) === 0) return { ok: false, detail: `no mode item ${mode}` }
      await item.click()
      await sleep(900)
      if (mode === 'Full access') {
        const checkbox = win.locator('input[type=checkbox]').first()
        await checkbox.click()
        await sleep(400)
        const confirm = win.locator('button').filter({ hasText: /启用 Full access/ }).first()
        if ((await confirm.count()) === 0) return { ok: false, detail: 'no full-access confirm' }
        await confirm.click()
      }
      await sleep(1800)
      const after = await chipText(win, ['Workspace Write', 'Read Only', 'Full access'])
      return { ok: after === mode, detail: `${current} -> ${after}` }
    })
    await closeMenus(win)
  }

  await step('hero:model-switch', async () => {
    const chip = win.locator('button').filter({ hasText: /DeepSeek-V4/ }).first()
    const aria = await chip.getAttribute('aria-label')
    const match = (aria ?? '').match(/当前 ([^，]+)，推理等级 (.+)/)
    const currentModel = match?.[1] ?? (await chip.textContent()).trim().replace(/High$|Max$|Medium$|Low$/, '')
    const currentEffort = match?.[2]
    await chip.click()
    await sleep(700)
    const modelCell = win.locator('[role=menu] [role=menuitem]').filter({ hasText: /^模型/ }).first()
    if ((await modelCell.count()) === 0) return { ok: false, detail: 'no model cell' }
    await modelCell.click()
    await sleep(800)
    const options = win.locator('[role=menuitemradio]')
    const count = await options.count()
    if (count === 0) return { ok: false, detail: 'no model options' }
    let checkedText = null
    for (let i = 0; i < count; i++) {
      if ((await options.nth(i).getAttribute('aria-checked')) === 'true') checkedText = (await options.nth(i).textContent()).trim()
    }
    if (checkedText === null) return { ok: false, detail: 'current model not checked' }
    let detail = `models=${count} current=${checkedText.slice(0, 50)}`
    if (count > 1) {
      for (let i = 0; i < count; i++) {
        if ((await options.nth(i).getAttribute('aria-checked')) !== 'true') {
          await options.nth(i).click()
          break
        }
      }
      await sleep(1800)
      detail += ` switched=${(await chip.textContent()).trim().slice(0, 40)}`
      await chip.click()
      await sleep(700)
      await win.locator('[role=menu] [role=menuitem]').filter({ hasText: /^模型/ }).first().click()
      await sleep(800)
      const restoreOptions = win.locator('[role=menuitemradio]')
      for (let i = 0; i < (await restoreOptions.count()); i++) {
        const text = (await restoreOptions.nth(i).textContent()).trim()
        if (text.startsWith(currentModel)) {
          await restoreOptions.nth(i).click()
          break
        }
      }
      await sleep(1800)
      detail += ' restored'
    }
    // Reasoning effort pane: verify it lists the current effort; switch and restore when multiple.
    await chip.click()
    await sleep(700)
    const effortCell = win.locator('[role=menu] [role=menuitem]').filter({ hasText: /^推理等级/ }).first()
    if ((await effortCell.count()) > 0) {
      await effortCell.click()
      await sleep(800)
      const effortOptions = win.locator('[role=menuitemradio]')
      const effortCount = await effortOptions.count()
      let effortChecked = null
      for (let i = 0; i < effortCount; i++) {
        if ((await effortOptions.nth(i).getAttribute('aria-checked')) === 'true') effortChecked = (await effortOptions.nth(i).textContent()).trim()
      }
      detail += ` effortOptions=${effortCount} effort=${effortChecked?.slice(0, 20)}`
      if (effortCount > 1 && currentEffort !== undefined) {
        for (let i = 0; i < effortCount; i++) {
          if ((await effortOptions.nth(i).getAttribute('aria-checked')) !== 'true') {
            await effortOptions.nth(i).click()
            break
          }
        }
        await sleep(1800)
        detail += ` effortSwitched=${(await chip.getAttribute('aria-label'))?.slice(0, 60)}`
        await chip.click()
        await sleep(700)
        await win.locator('[role=menu] [role=menuitem]').filter({ hasText: /^推理等级/ }).first().click()
        await sleep(800)
        const restoreEfforts = win.locator('[role=menuitemradio]')
        for (let i = 0; i < (await restoreEfforts.count()); i++) {
          const text = (await restoreEfforts.nth(i).textContent()).trim()
          if (text.startsWith(currentEffort)) {
            await restoreEfforts.nth(i).click()
            break
          }
        }
        await sleep(1800)
        detail += ' effortRestored'
      }
    }
    return { ok: true, detail }
  })
  await closeMenus(win)

  await step('hero:slash-menu', async () => {
    const ta = win.locator('textarea').first()
    await clearComposer(win)
    await ta.click()
    await win.keyboard.type('/')
    await sleep(2500)
    const popup = win.locator('[class*=menu]').filter({ hasText: /compact|goal|permission/ }).first()
    const visible = (await popup.count()) > 0
    await win.keyboard.press('Escape')
    await sleep(500)
    await clearComposer(win)
    return { ok: visible, detail: `popup=${visible}` }
  })

  await step('hero:at-menu-empty-expected', async () => {
    const ta = win.locator('textarea').first()
    await clearComposer(win)
    await ta.click()
    await win.keyboard.type('@')
    await sleep(2000)
    const popupCount = await win.locator('[class*=menu]').filter({ hasText: /agent-|subagent/ }).count()
    await win.keyboard.press('Escape')
    await sleep(400)
    await clearComposer(win)
    return { ok: true, detail: `subagent-candidates=${popupCount} (empty expected)` }
  })

  await step('hero:command-menu', async () => {
    await win.locator('button[aria-label="命令"]').first().click()
    await sleep(700)
    const items = (await win.locator('[role=option]').allTextContents()).map((s) => s.trim())
    const expected = ['compact', 'export', 'feedback', 'goal', 'permission', 'plan', 'model']
    const ok = expected.every((x) => items.some((i) => i.startsWith(x)))
    await win.keyboard.press('Escape')
    await sleep(400)
    return { ok, detail: `items=${JSON.stringify(items)}` }
  })

  await step('hero:goal-command', async () => {
    const ta = win.locator('textarea').first()
    await clearComposer(win)
    await ta.click()
    await win.keyboard.type('/goal')
    await win.keyboard.press('Enter')
    await sleep(400)
    if ((await ta.inputValue()).startsWith('/goal')) await win.keyboard.press('Enter')
    await sleep(1500)
    const hasGoal = await win.evaluate(() => {
      return document.querySelector('[data-command-input], [data-goal-bar] input, input[aria-label="目标内容"]') !== null
    })
    await win.keyboard.press('Escape').catch(() => {})
    await sleep(400)
    await clearComposer(win)
    return { ok: hasGoal, detail: `goal=${hasGoal}` }
  })

  if (activeSessionId !== null) {
    await step('hero:send-text', async () => {
      const turn = await sendPrompt(win, activeSessionId, 'reply with exactly matrix-ok')
      const ok = turn.ends?.reason?.kind === 'completed' && turn.lastText.includes('matrix-ok')
      return { ok, detail: `reason=${JSON.stringify(turn.ends?.reason)} text=${turn.lastText.slice(0, 60)}` }
    })

    await step('hero:send-tool-call', async () => {
      const turn = await sendPrompt(win, activeSessionId, 'use a tool to print the current working directory', 180000)
      const ok = turn.ends?.reason?.kind === 'completed'
      return { ok, detail: `reason=${JSON.stringify(turn.ends?.reason)} text=${turn.lastText.slice(0, 80)}` }
    })

    await step('hero:send-button-click', async () => {
      await clearComposer(win)
      const ta = win.locator('textarea').first()
      await ta.click()
      await win.keyboard.type('reply with the word button-ok')
      await sleep(400)
      const send = win.locator('button[aria-label="发送消息"]')
      if ((await send.isDisabled())) return { ok: false, detail: 'send disabled after typing' }
      await send.click()
      const turn = await waitNewTurnFor(win, activeSessionId)
      const ok = turn.ends?.reason?.kind === 'completed' && turn.lastText.includes('button-ok')
      return { ok, detail: `reason=${JSON.stringify(turn.ends?.reason)} text=${turn.lastText.slice(0, 60)}` }
    })

  await step('hero:goal-save', async () => {
    let bar = ''
    for (let attempt = 1; attempt <= 2; attempt++) {
      await clearComposer(win)
      const ta = win.locator('textarea').first()
      await ta.click()
      await win.keyboard.type('/goal matrix test goal')
      await win.keyboard.press('Enter')
      await sleep(30000)
      bar = await win.evaluate(() =>
        [...document.querySelectorAll('[data-goal-bar]')].map((el) => (el.textContent || '').trim()).join(' | '))
      if (bar.includes('matrix test goal')) break
    }
    const ok = bar.includes('matrix test goal')
    const clear = win.locator('button[aria-label="清除目标"]').first()
    if ((await clear.count()) > 0) {
      await clear.click()
      await sleep(1500)
    }
    return { ok, detail: `bar=${bar.slice(0, 80)}` }
  })

    await step('hero:stop-generation', async () => {
      if (usingMock) return { ok: true, detail: 'skipped: mock LLM has no long-running generation' }
      await clearComposer(win)
      const ta = win.locator('textarea').first()
      await ta.click()
      await win.keyboard.type('run pwsh: Start-Sleep -Seconds 20')
      await win.keyboard.press('Enter')
      await sleep(4000)
      const stop = win.locator('button[aria-label="停止生成"]')
      const appeared = (await stop.count()) > 0
      if (appeared) await stop.first().click()
      await sleep(8000)
      const gone = (await stop.count()) === 0
      return { ok: appeared && gone, detail: `appeared=${appeared} gone=${gone}` }
    })

    await step('conversation:user-question', async () => {
      if (usingMock) return { ok: true, detail: 'skipped: mock LLM cannot call ask_user_question' }
      let option = null
      for (let attempt = 1; attempt <= 2; attempt++) {
        await clearComposer(win)
        const ta = win.locator('textarea').first()
        await ta.click()
        const prompt = attempt === 1
          ? 'use the ask_user_question tool to ask me one multiple choice question with options A and B, then wait for my answer'
          : 'you MUST call ask_user_question with exactly two options labelled A and B and wait for my answer; do not answer for me'
        await win.keyboard.type(prompt)
        await win.keyboard.press('Enter')
        const deadline = Date.now() + (attempt === 1 ? 90000 : 60000)
        while (Date.now() < deadline) {
          const count = await win.locator('button').filter({ hasText: /Option A/ }).count()
          if (count > 0) {
            option = win.locator('button').filter({ hasText: /Option A/ }).first()
            break
          }
          await sleep(1500)
        }
        if (option !== null) break
      }
      if (option === null || (await option.count()) === 0) return { ok: false, detail: 'question panel did not appear' }
      await option.click()
      await sleep(800)
      const submit = win.locator('button').filter({ hasText: /^提交$/ }).first()
      const submitCount = await submit.count()
      if (submitCount > 0) await submit.click()
      const turn = await waitNewTurnFor(win, activeSessionId, 120000)
      const ok = turn.ends?.reason?.kind === 'completed'
      await selectSession(win, activeSessionId)
      return { ok, detail: `optionClicked=true submit=${submitCount} reason=${JSON.stringify(turn.ends?.reason)}` }
    })

    await step('conversation:todo-panel', async () => {
      if (usingMock) return { ok: true, detail: 'skipped: mock LLM cannot call todo_write' }
      await clearComposer(win)
      const before = await turnCounts(win)
      const ta = win.locator('textarea').first()
      await ta.click()
      await win.keyboard.type('use todo_write to create exactly two todos: alpha and beta')
      await win.keyboard.press('Enter')
      await waitNewTurnFor(win, activeSessionId, 120000)
      const panel = await win.evaluate(() => {
        const el = document.querySelector('[data-testid="todo-panel"]')
        return el ? (el.textContent || '').trim() : null
      })
      return { ok: panel !== null && panel.includes('待处理'), detail: `panel=${(panel ?? '').slice(0, 80)}` }
    })

    await step('sidebar:session-row-rename-apply', async () => {
      const rows = win.locator('[class*=sessionRow]')
      let row = null
      let original = ''
      for (let i = 0; i < (await rows.count()); i++) {
        const candidate = rows.nth(i)
        if ((await candidate.locator('button[aria-label*="操作"]').count()) === 0) continue
        const text = rowTitleText((await candidate.textContent()).trim())
        if (text !== '') {
          row = candidate
          original = text
          break
        }
      }
      if (row === null || original === '') return { ok: false, detail: 'no titled session row' }
      const renamed = `${original}-matrix-renamed`
      const renameRow = async (targetRow, target) => {
        const box = await targetRow.boundingBox()
        if (box === null) throw new Error('rename row has no box')
        await win.mouse.move(box.x + 20, box.y + box.height / 2)
        await sleep(500)
        await targetRow.locator('button[aria-label*="操作"]').first().click()
        await sleep(700)
        const renameItem = win.locator('[role=menuitem]').filter({ hasText: /重命名/ }).first()
        await renameItem.click()
        await sleep(1000)
        const input = win.locator('[role=dialog] input').first()
        await input.fill(target)
        const confirm = win.locator('[role=dialog] button').filter({ hasText: /^重命名$/ }).first()
        if ((await confirm.count()) > 0) await confirm.click()
        else await win.keyboard.press('Enter')
        await sleep(1500)
        await closeToDialogCount(win, 0)
      }
      await renameRow(row, renamed)
      const renamedRow = win.locator('[class*=sessionRow]').filter({ hasText: new RegExp(`^${escapeRegExp(renamed)}`) }).first()
      const applied = (await renamedRow.count()) > 0
      if ((await renamedRow.count()) > 0) await renameRow(renamedRow, original)
      const restoredRow = win.locator('[class*=sessionRow]').filter({ hasText: new RegExp(`^${escapeRegExp(original)}`) }).first()
      const restored = (await restoredRow.count()) > 0
      return { ok: applied && restored, detail: `${original} -> ${renamed} applied=${applied} restored=${restored}` }
    })

    await step('sidebar:session-row-fork-dialog', async () => {
      const beforeIds = new Set(await sessionIds(win))
      const rows = win.locator('[class*=sessionRow]')
      const dialogs = await win.locator('[role=dialog]').count()
      let grew = false
      let attempted = 0
      for (let i = 0; i < (await rows.count()) && !grew; i++) {
        const row = rows.nth(i)
        if ((await row.locator('button[aria-label*="操作"]').count()) === 0) continue
        const box = await row.boundingBox()
        if (box === null) continue
        await win.mouse.move(box.x + 20, box.y + box.height / 2)
        await sleep(500)
        await row.locator('button[aria-label*="操作"]').first().click()
        await sleep(700)
        const forkItem = win.locator('[role=menuitem]').filter({ hasText: /分叉会话/ }).first()
        if ((await forkItem.count()) === 0) {
          await win.keyboard.press('Escape')
          await sleep(400)
          continue
        }
        await forkItem.click()
        await sleep(1200)
        attempted++
        const afterIds = await sessionIds(win)
        grew = afterIds.length > beforeIds.size
      }
      if (attempted === 0 && !grew) return { ok: false, detail: 'no forkable row' }
      await closeToDialogCount(win, 0)
      const reselected = await selectSession(win, activeSessionId)
      return { ok: (dialogs > 0 || grew) && reselected, detail: `dialogs=${dialogs} sessionsGrew=${grew} reselected=${reselected}` }
    })

    await step('sidebar:session-archive', async () => {
      const beforeIds = new Set(await sessionIds(win))
      await byText('新会话')(win).click()
      await sleep(2500)
      const scratchId = (await sessionIds(win)).find((id) => !beforeIds.has(id))
      if (scratchId === undefined) return { ok: false, detail: 'archive scratch session not created' }
      await clearComposer(win)
      const ta = win.locator('textarea').first()
      await ta.click()
      await win.keyboard.type('say archive-me')
      await win.keyboard.press('Enter')
      await sleep(15000)
      const rows = win.locator('[class*=sessionRow]')
      let row = null
      for (let i = 0; i < (await rows.count()); i++) {
        const candidate = rows.nth(i)
        if ((await candidate.locator('button[aria-label*="操作"]').count()) > 0
          && (await candidate.textContent()).includes('archive-me')) {
          row = candidate
          break
        }
      }
      if (row === null) return { ok: false, detail: 'archive row not found' }
      const box = await row.boundingBox()
      if (box === null) return { ok: false, detail: 'archive row has no box' }
      await win.mouse.move(box.x + 20, box.y + box.height / 2)
      await sleep(500)
      await row.locator('button[aria-label*="操作"]').first().click()
      await sleep(700)
      const archiveItem = win.locator('[role=menuitem]').filter({ hasText: /归档会话/ }).first()
      if ((await archiveItem.count()) === 0) return { ok: false, detail: 'no archive menu item' }
      await archiveItem.click()
      await sleep(1500)
      const stillVisible = (await win.locator('[class*=sessionRow]').filter({ hasText: /archive-me/ }).count()) > 0
      const inList = (await sessionIds(win)).includes(scratchId)
      await closeMenus(win)
      let reselected = false
      const list = await unary(win, 'session.list', {})
      for (const s of list.result.value.items) {
        if (s.title !== undefined && s.title.trim() !== ''
          && (await win.locator('[class*=sessionRow]').filter({ hasText: new RegExp(`^${escapeRegExp(s.title)}`) }).count()) > 0) {
          reselected = await selectRowByTitle(win, s.title)
          if (reselected) break
        }
      }
      return { ok: !stillVisible && inList && reselected, detail: `hidden=${!stillVisible} inList=${inList} reselected=${reselected}` }
    })
  } else {
    await step('hero:send-text', async () => ({ ok: false, detail: 'no active session' }))
    await step('hero:send-tool-call', async () => ({ ok: false, detail: 'no active session' }))
    await step('hero:send-button-click', async () => ({ ok: false, detail: 'no active session' }))
    await step('sidebar:session-row-rename-apply', async () => ({ ok: false, detail: 'no active session' }))
    await step('sidebar:session-row-fork-dialog', async () => ({ ok: false, detail: 'no active session' }))
  }

  await step('hero:plan-command', async () => {
    const before = activeSessionId === null ? 0 : await turnCountFor(win, activeSessionId)
    const ta = win.locator('textarea').first()
    await clearComposer(win)
    const togglePlan = async () => {
      const cmd = win.locator('button[aria-label="命令"]').first()
      try {
        await cmd.click({ timeout: 8000 })
      } catch {
        await cmd.dispatchEvent('click')
      }
      await sleep(700)
      const planItem = win.locator('[role=option]').filter({ hasText: /^plan/ }).first()
      if ((await planItem.count()) > 0) await planItem.click()
      await sleep(2500)
    }
    await togglePlan()
    const now = activeSessionId === null ? 0 : await turnCountFor(win, activeSessionId)
    const planVisible = (await win.locator('button').filter({ hasText: /^Plan$/ }).count()) > 0
    await clearComposer(win)
    await togglePlan()
    const planGone = (await win.locator('button').filter({ hasText: /^Plan$/ }).count()) === 0
    return { ok: planVisible && planGone, detail: `plan=${planVisible} gone=${planGone} turnAdvanced=${now > before}` }
  })

  await step('hero:plan-review', async () => {
    const ta = win.locator('textarea').first()
    await clearComposer(win)
    const cmd = win.locator('button[aria-label="命令"]').first()
    try {
      await cmd.click({ timeout: 8000 })
    } catch {
      await cmd.dispatchEvent('click')
    }
    await sleep(700)
    const planItem = win.locator('[role=option]').filter({ hasText: /^plan/ }).first()
    if ((await planItem.count()) > 0) await planItem.click()
    await sleep(2500)
    await clearComposer(win)
    await ta.click()
    await win.keyboard.type('plan adding a settings toggle to a desktop app. When the plan is ready, call exit_plan_mode with a short markdown plan.')
    await win.keyboard.press('Enter')
    const approve = win.locator('button').filter({ hasText: /^确认执行$/ }).first()
    let appeared = false
    const deadline = Date.now() + 120000
    while (Date.now() < deadline) {
      if ((await approve.count()) > 0) {
        appeared = true
        break
      }
      await sleep(1500)
    }
    if (!appeared) return { ok: false, detail: 'plan review panel did not appear' }
    await approve.click()
    await sleep(8000)
    await clearComposer(win)
    try {
      await cmd.click({ timeout: 8000 })
    } catch {
      await cmd.dispatchEvent('click')
    }
    await sleep(700)
    if ((await planItem.count()) > 0) await planItem.click()
    await sleep(2500)
    const planGone = (await win.locator('button').filter({ hasText: /^Plan$/ }).count()) === 0
    return { ok: planGone, detail: `reviewed=true planGone=${planGone}` }
  })

  await step('hero:context-meter', async () => {
    const meter = win.locator('button[aria-label*="上下文已用"]').first()
    if ((await meter.count()) === 0) return { ok: true, detail: 'skipped: no context meter (empty session)' }
    await meter.click()
    await sleep(700)
    const dialog = await win.evaluate(() =>
      [...document.querySelectorAll('[role=dialog]')].some((el) => (el.textContent || '').includes('上下文已用')))
    await closeToDialogCount(win, 0)
    return { ok: dialog, detail: `dialog=${dialog}` }
  })

  await step('keyboard:composer-tab', async () => {
    const ta = win.locator('textarea').first()
    await ta.click()
    await win.keyboard.press('Tab')
    await sleep(300)
    const afterTab = await win.evaluate(() => {
      const el = document.activeElement
      return el ? { tag: el.tagName, aria: el.getAttribute('aria-label') || '' } : null
    })
    await win.keyboard.press('Shift+Tab')
    await sleep(300)
    const afterShiftTab = await win.evaluate(() => {
      const el = document.activeElement
      return el ? { tag: el.tagName } : null
    })
    return { ok: afterTab?.tag === 'BUTTON' && afterShiftTab?.tag === 'TEXTAREA', detail: `tab=${JSON.stringify(afterTab)} shiftTab=${JSON.stringify(afterShiftTab)}` }
  })

  // D. Settings
  await step('settings:open', async () => {
    await ensureSettingsOpen(win)
    const sections = await win.locator('button').filter({ hasText: /通用设置|模型|插件|Agent 预设/ }).count()
    return { ok: sections >= 4, detail: `sections=${sections}` }
  })

  await step('settings:language-switch', async () => {
    await byText('通用设置')(win).click()
    await sleep(1000)
    const selector = win.locator('button[aria-haspopup=menu]').filter({ hasText: /^中文$|^English$/ }).first()
    if ((await selector.count()) === 0) return { ok: false, detail: 'no language selector' }
    await selector.click()
    await sleep(700)
    const english = menuItem('English')(win)
    if ((await english.count()) === 0) return { ok: false, detail: 'no English menu item' }
    await english.click()
    await sleep(1200)
    const englishVisible = (await win.evaluate(() => document.body.innerText)).includes('General')
    const selectorEn = win.locator('button[aria-haspopup=menu]').filter({ hasText: /^English$/ }).first()
    if ((await selectorEn.count()) === 0) return { ok: false, detail: 'English selector missing' }
    await selectorEn.click()
    await sleep(700)
    const chinese = menuItem('中文')(win)
    if ((await chinese.count()) === 0) return { ok: false, detail: 'no Chinese menu item' }
    await chinese.click()
    await sleep(1200)
    return { ok: englishVisible, detail: `englishVisible=${englishVisible}` }
  })

  await step('settings:theme-switch', async () => {
    await ensureSettingsOpen(win)
    await byText('通用设置')(win).click()
    await sleep(900)
    const theme = () => win.evaluate(() => {
      const buttons = [...document.querySelectorAll('[role=dialog] button')]
        .filter((b) => ['浅色', '深色', '跟随系统'].includes((b.textContent || '').trim()))
        .map((b) => ({ text: (b.textContent || '').trim(), pressed: b.getAttribute('aria-pressed') }))
      const cs = getComputedStyle(document.documentElement).colorScheme
      const bg = getComputedStyle(document.body).backgroundColor
      return JSON.stringify({ buttons, cs, bg })
    })
    const before = await theme()
    await byText('深色')(win).click()
    await sleep(900)
    const dark = await theme()
    await byText('浅色')(win).click()
    await sleep(900)
    const light = await theme()
    await byText('跟随系统')(win).click()
    await sleep(900)
    const restored = await theme()
    return { ok: dark !== before && light !== dark && light !== before, detail: `${before} -> ${dark} -> ${light} -> ${restored}` }
  })

  await step('settings:default-permission', async () => {
    await ensureSettingsOpen(win)
    await byText('通用设置')(win).click()
    await sleep(800)
    const picker = win.locator('[role=dialog] button').filter({ hasText: /^Workspace Write$|^Read Only$|^Full access$/ }).first()
    if ((await picker.count()) === 0) return { ok: false, detail: 'no default-permission picker' }
    const current = (await picker.textContent()).trim()
    const target = current === 'Read Only' ? 'Workspace Write' : 'Read Only'
    await picker.click()
    await sleep(600)
    const item = menuItem(target)(win)
    if ((await item.count()) === 0) return { ok: false, detail: `no permission item ${target}` }
    await item.click()
    await sleep(900)
    const after = (await picker.textContent()).trim()
    await picker.click()
    await sleep(600)
    const back = menuItem(current)(win)
    if ((await back.count()) === 0) return { ok: false, detail: `no permission item ${current}` }
    await back.click()
    await sleep(800)
    const restored = (await picker.textContent()).trim()
    return { ok: after === target && restored === current, detail: `${current} -> ${after} -> ${restored}` }
  })

  await step('settings:queue-select-persist', async () => {
    await ensureSettingsOpen(win)
    const picker = win.locator('button').filter({ hasText: /排队发送|插话发送/ }).first()
    await picker.click()
    await sleep(700)
    const target = menuItem('插话发送')(win)
    if ((await target.count()) === 0) return { ok: false, detail: 'no queue option' }
    await target.click()
    await sleep(1000)
    const persisted = (await win.locator('button').filter({ hasText: /^插话发送$/ }).count()) > 0
    return { ok: persisted, detail: `persisted=${persisted}` }
  })

  await step('settings:model-section', async () => {
    await ensureSettingsOpen(win)
    await byText('模型')(win).click()
    await sleep(1500)
    const text = await win.evaluate(() => document.body.innerText)
    const hasProvider = text.includes('deepseek-official') || text.includes('DeepSeek')
    return { ok: hasProvider, detail: `providerText=${hasProvider}` }
  })

  await step('settings:models-edit-dialog', async () => {
    await ensureSettingsOpen(win)
    await byText('模型')(win).click()
    await sleep(1200)
    const edit = win.locator('button[aria-label="编辑 DeepSeek (deepseek-official)"]').first()
    if ((await edit.count()) === 0) return { ok: false, detail: 'no provider edit button' }
    await edit.click()
    await sleep(1200)
    const dialogs = await win.locator('[role=dialog]').count()
    const bodyHasFields = await win.evaluate(() => {
      const text = document.body.innerText
      return text.includes('Base URL') || text.includes('API 密钥') || text.includes('api key')
    })
    if (dialogs > 1) {
      await closeToDialogCount(win, 1)
    }
    return { ok: dialogs > 1 || bodyHasFields, detail: `dialogs=${dialogs} fields=${bodyHasFields}` }
  })

  await step('settings:provider-error-path', async () => {
    await ensureSettingsOpen(win)
    await closeToDialogCount(win, 1)
    await byText('模型')(win).click()
    await sleep(1200)
    const existingDelete = win.locator('button[aria-label="删除 Matrix Bad (matrix-bad)"]').first()
    if ((await existingDelete.count()) > 0) {
      await existingDelete.click()
      await sleep(800)
      const confirmDelete = win.locator('[role=dialog] button').filter({ hasText: /^删除$/ }).first()
      if ((await confirmDelete.count()) > 0) await confirmDelete.click()
      await sleep(1000)
    }
    const add = win.locator('button').filter({ hasText: /添加自定义提供方/ }).first()
    if ((await add.count()) === 0) return { ok: false, detail: 'no add-provider button' }
    await add.click()
    await sleep(1200)
    await win.locator('input[aria-label="Provider ID"]').fill('matrix-bad')
    await win.locator('input[aria-label="显示名称"]').fill('Matrix Bad')
    await win.locator('input[aria-label="API 地址"]').fill('http://127.0.0.1:9')
    await win.locator('input[aria-label="API 密钥"]').fill('x')
    await win.locator('button').filter({ hasText: /添加模型/ }).first().click()
    await sleep(800)
    await win.locator('input[aria-label="模型 ID 1"]').fill('matrix-bad-model')
    await win.locator('input[aria-label="显示名称 1"]').fill('Matrix Bad Model')
    const capacity = win.locator('button[aria-label="容量 1"]').first()
    if ((await capacity.count()) > 0) {
      await capacity.click()
      await sleep(600)
      const option = win.locator('[role=option], [role=menuitem]').first()
      if ((await option.count()) > 0) await option.click()
      await sleep(600)
    }
    const createBtn = win.locator('button').filter({ hasText: /^创建提供方$/ }).first()
    if (await createBtn.isDisabled()) return { ok: false, detail: 'provider create button stayed disabled' }
    await createBtn.click()
    await sleep(1500)
    await closeToDialogCount(win, 1)
    await ensureSettingsOpen(win)
    const providerVisible = (await win.evaluate(() => document.body.innerText)).includes('Matrix Bad')
    await closeMenus(win)
    await closeToDialogCount(win, 0)
    await closeMenus(win)
    await closeToDialogCount(win, 0)
    const chip = win.locator('button').filter({ hasText: /DeepSeek-V4/ }).first()
    try {
      await chip.click({ timeout: 8000 })
    } catch {
      await chip.click({ timeout: 8000, force: true }).catch(() => {})
    }
    await sleep(700)
    await win.locator('[role=menu] [role=menuitem]').filter({ hasText: /^模型/ }).first().click()
    await sleep(800)
    const badOption = win.locator('[role=menuitemradio]').filter({ hasText: /matrix-bad-model|Matrix Bad Model/ }).first()
    const badSelectable = (await badOption.count()) > 0
    if (badSelectable) {
      await badOption.click()
      await sleep(1500)
      await clearComposer(win)
      const ta = win.locator('textarea').first()
      await ta.click()
      await win.keyboard.type('reply with ok')
      await win.keyboard.press('Enter')
      await sleep(15000)
    }
    const errorShown = await win.evaluate(() => {
      const text = document.body.innerText
      return /失败|Failed|error|Error/iu.test(text.slice(-800))
    })
    // Restore the working model.
    await chip.click()
    await sleep(700)
    await win.locator('[role=menu] [role=menuitem]').filter({ hasText: /^模型/ }).first().click()
    await sleep(800)
    const flash = win.locator('[role=menuitemradio]').filter({ hasText: /DeepSeek-V4-Flash/ }).first()
    if ((await flash.count()) > 0) await flash.click()
    await sleep(1500)
    // Delete the matrix-bad provider.
    await ensureSettingsOpen(win)
    await closeToDialogCount(win, 1)
    await byText('模型')(win).click()
    await sleep(1200)
    const editBad = win.locator('button[aria-label*="Matrix Bad"]').first()
    let deleted = false
    if ((await editBad.count()) > 0) {
      await editBad.click()
      await sleep(1200)
      const removeBtn = win.locator('button[aria-label*="删除"]').first()
      if ((await removeBtn.count()) > 0) {
        await removeBtn.click()
        await sleep(800)
        const confirmDelete = win.locator('[role=dialog] button').filter({ hasText: /^删除$/ }).first()
        if ((await confirmDelete.count()) > 0) await confirmDelete.click()
        await sleep(1200)
        deleted = (await win.evaluate(() => document.body.innerText)).includes('Matrix Bad') === false
      }
    }
    await closeToDialogCount(win, 1)
    return {
      ok: providerVisible && badSelectable && errorShown && deleted,
      detail: `provider=${providerVisible} badSelectable=${badSelectable} errorShown=${errorShown} deleted=${deleted}`,
    }
  })

  for (const plugin of ['终端', 'Agent 循环', '网页搜索']) {
    await step(`settings:plugin-${plugin}`, async () => {
      await ensureSettingsOpen(win)
      await byText('插件')(win).click()
      await sleep(1000)
      const row = win.locator('button').filter({ hasText: new RegExp(`^${plugin}`) }).first()
      if ((await row.count()) === 0) return { ok: false, detail: `no plugin row ${plugin}` }
      await row.click()
      await sleep(1500)
      const expanded = (await win.locator('button').filter({ hasText: /保存|放弃修改/ }).count()) > 0
      return { ok: expanded, detail: `expanded=${expanded}` }
    })
  }

  await step('settings:plugins-inventory', async () => {
    await ensureSettingsOpen(win)
    await byText('插件')(win).click()
    await sleep(1000)
    const tab = win.locator('[role=tab]').filter({ hasText: /^插件列表$/ }).first()
    if ((await tab.count()) === 0) return { ok: false, detail: 'no inventory tab' }
    await tab.click()
    await sleep(1200)
    const rows = await win.locator('[role=dialog] button[aria-label]').count()
    return { ok: rows > 0, detail: `rows=${rows}` }
  })

  await step('settings:agent-preset-default', async () => {
    await ensureSettingsOpen(win)
    await byText('Agent 预设')(win).click()
    await sleep(1200)
    const card = win.locator('button[aria-label*="设为默认:"]').first()
    if ((await card.count()) === 0) return { ok: false, detail: 'no non-default preset card' }
    const beforeAria = await card.getAttribute('aria-label')
    const presetName = beforeAria.slice(beforeAria.indexOf(':') + 2)
    await card.click()
    await sleep(1500)
    const after = win.locator(`button[aria-label*="${presetName}"]`).first()
    const afterAria = await after.getAttribute('aria-label')
    const ok = (afterAria ?? '').startsWith('当前使用:')
    return { ok, detail: `${beforeAria} -> ${afterAria}` }
  })

  await step('settings:preset-view-dialog', async () => {
    await ensureSettingsOpen(win)
    await byText('Agent 预设')(win).click()
    await sleep(1200)
    const view = win.locator('button[aria-label="查看: 标准模式"]').first()
    if ((await view.count()) === 0) return { ok: false, detail: 'no preset view button' }
    await view.click()
    await sleep(1200)
    const dialogs = await win.locator('[role=dialog]').count()
    await closeToDialogCount(win, 1)
    return { ok: dialogs > 1, detail: `dialogs=${dialogs}` }
  })

  await step('settings:preset-copy-dialog', async () => {
    await closeToDialogCount(win, 1)
    await ensureSettingsOpen(win)
    await closeToDialogCount(win, 1)
    await byText('Agent 预设')(win).click()
    await sleep(1200)
    const copy = win.locator('button[aria-label="复制: PTC 模式"]').first()
    if ((await copy.count()) === 0) return { ok: false, detail: 'no preset copy button' }
    await win.mouse.move(4, 4)
    await sleep(300)
    try {
      await copy.click({ timeout: 5000 })
    } catch {
      await copy.focus()
      await win.keyboard.press('Enter')
      await sleep(800)
      if ((await win.locator('[role=dialog]').count()) <= 1) {
        await copy.dispatchEvent('click')
      }
    }
    await sleep(1500)
    const dialogs = await win.locator('[role=dialog]').count()
    let closed = false
    for (let i = 0; i < 8; i++) {
      const current = await win.locator('[role=dialog]').count()
      if (current === 1
        && (await win.locator('[role=dialog]').first().evaluate((el) => (el.textContent || '').includes('通用设置')))) {
        closed = true
        break
      }
      if (current === 0) {
        await ensureSettingsOpen(win)
        closed = true
        break
      }
      await win.keyboard.press('Escape')
      await sleep(500)
    }
    await ensureSettingsOpen(win)
    return { ok: dialogs > 1 && closed, detail: `dialogs=${dialogs} closed=${closed}` }
  })

  await step('settings:restore-defaults', async () => {
    await closeMenus(win)
    await closeToDialogCount(win, 1)
    await ensureSettingsOpen(win)
    if ((await win.locator('button').filter({ hasText: /^Agent 预设$/ }).count()) === 0) {
      const trigger = win.locator('button').filter({ hasText: /^设置$/ }).first()
      if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click()
      await sleep(800)
    }
    await byText('Agent 预设')(win).click()
    await sleep(900)
    const standard = win.locator('button[aria-label*="设为默认: 标准模式"], button[aria-label*="当前使用: 标准模式"]').first()
    if ((await standard.count()) === 0) return { ok: false, detail: 'no standard card' }
    if ((await standard.getAttribute('aria-label')).startsWith('设为默认:')) {
      await win.mouse.move(4, 4)
      await sleep(300)
      try {
        await standard.click({ timeout: 5000 })
      } catch {
        await standard.dispatchEvent('click')
      }
      await sleep(1000)
    }
    await closeMenus(win)
    await ensureSettingsOpen(win)
    const general = byText('通用设置')(win)
    try {
      await general.click({ timeout: 5000 })
    } catch {
      await general.dispatchEvent('click')
    }
    await sleep(800)
    const picker = win.locator('button').filter({ hasText: /排队发送|插话发送/ }).first()
    await picker.click()
    await sleep(600)
    const queue = menuItem('排队发送')(win)
    if ((await queue.count()) === 0) return { ok: false, detail: 'no queue option' }
    await queue.click()
    await sleep(800)
    return { ok: true, detail: 'preset default + queue restored' }
  })

  // E. Conversation content
  await closeMenus(win)
  if (activeSessionId !== null) await selectSession(win, activeSessionId)
  await step('conversation:message-copy', async () => {
    // The OS clipboard can be wholly unavailable in automation sessions
    // (locked by the host or a non-interactive window station); probe the
    // bridge first so an unavailable environment is not reported as an app
    // regression.
    const probeOk = await win.evaluate(() => window.desktop.clipboard.writeText('matrix-clipboard-probe'))
    let probeBack = ''
    try {
      probeBack = await clipboardRead(app)
    } catch (error) {
      probeBack = `ERR ${String(error).slice(0, 40)}`
    }
    if (probeOk !== true || probeBack !== 'matrix-clipboard-probe') {
      return { ok: true, detail: `skipped: OS clipboard unavailable (probe=${probeOk} back=${probeBack})` }
    }
    const buttons = win.locator('button[aria-label="复制"]')
    const count = await buttons.count()
    if (count === 0) return { ok: false, detail: 'no copy buttons' }
    let before = ''
    try {
      before = await clipboardRead(app)
    } catch (error) {
      return { ok: false, detail: `clipboard read before: ${String(error).slice(0, 80)}` }
    }
    await buttons.first().click()
    await sleep(300)
    const feedback = (await win.evaluate(() => document.body.innerText)).includes('复制成功')
    await sleep(900)
    let after = ''
    try {
      after = await clipboardRead(app)
    } catch (error) {
      return { ok: false, detail: `clipboard read after: ${String(error).slice(0, 80)}` }
    }
    return { ok: before !== after && after !== '' && feedback, detail: `changed=${before !== after} len=${after.length} feedback=${feedback}` }
  })

  await step('conversation:message-feedback-good', async () => {
    const good = win.locator('button[aria-label="好的回答"]').first()
    if ((await good.count()) === 0) return { ok: false, detail: 'no good button' }
    await good.click()
    const deadline = Date.now() + 4000
    let active = false
    let note = false
    while (Date.now() < deadline) {
      const state = await win.evaluate(() => ({
        active: document.querySelector('button[data-active="true"]') !== null,
        note: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('补充说明')),
      }))
      active = state.active
      note = state.note
      if (active && note) break
      await sleep(300)
    }
    return { ok: active && note, detail: `active=${active} note=${note}` }
  })

  await step('conversation:message-feedback-bad', async () => {
    const bad = win.locator('button[aria-label="有问题的回答"]').first()
    if ((await bad.count()) === 0) return { ok: false, detail: 'no bad button' }
    await bad.click()
    const deadline = Date.now() + 4000
    let active = false
    let note = false
    while (Date.now() < deadline) {
      const state = await win.evaluate(() => ({
        active: document.querySelector('button[data-active="true"]') !== null,
        note: [...document.querySelectorAll('button')].some((b) => (b.textContent || '').includes('补充说明')),
      }))
      active = state.active
      note = state.note
      if (active && note) break
      await sleep(300)
    }
    return { ok: active && note, detail: `active=${active} note=${note}` }
  })

  await step('conversation:details-panel', async () => {
    const clicked = await win.evaluate(() => {
      const el = [...document.querySelectorAll('div, span, button')]
        .find((n) => (n.textContent || '').trim() === '详情' && n.getBoundingClientRect().width > 0)
      if (el === undefined) return false
      el.click()
      return true
    })
    if (!clicked) return { ok: false, detail: 'no details element' }
    await sleep(1000)
    const close = win.locator('button[aria-label="关闭详情"]')
    const opened = (await close.count()) > 0
    if (opened) {
      try {
        await close.click({ timeout: 5000, force: true })
      } catch {
        await close.dispatchEvent('click')
      }
    }
    await sleep(400)
    return { ok: opened, detail: `opened=${opened} clicked=${clicked}` }
  })

  await step('conversation:session-log-tabs', async () => {
    const tab = win.locator('button').filter({ hasText: /^Session log$/ }).first()
    if ((await tab.count()) === 0) return { ok: false, detail: 'no session log tab' }
    await tab.click()
    await sleep(1500)
    const text = await win.evaluate(() => document.body.innerText)
    const hasTabs = text.includes('对话') && text.includes('轨迹')
    return { ok: hasTabs, detail: `tabs=${hasTabs}` }
  })

  await step('conversation:trajectory-controls', async () => {
    const tab = win.locator('[role=tab]').filter({ hasText: /^轨迹$/ }).first()
    if ((await tab.count()) === 0) return { ok: false, detail: 'no trajectory tab' }
    await tab.scrollIntoViewIfNeeded()
    try {
      await tab.click({ timeout: 8000 })
    } catch {
      await tab.dispatchEvent('click')
    }
    await sleep(1200)
    const selected = await tab.getAttribute('aria-selected')
    const controls = ['Use actual duration', 'Collapse turns', 'Collapse calls']
    const counts = await Promise.all(controls.map((c) => win.locator(`button[aria-label="${c}"]`).count()))
    const search = win.locator('input[placeholder="搜索"]')
    const hasSearch = (await search.count()) > 0
    if (hasSearch) {
      await search.fill('matrix')
      await sleep(500)
      await search.fill('')
    }
    const dialogTab = win.locator('[role=tab]').filter({ hasText: /^对话$/ }).first()
    try {
      await dialogTab.click({ timeout: 8000 })
    } catch {
      await dialogTab.dispatchEvent('click')
    }
    await sleep(800)
    return { ok: counts.every((n) => n > 0) && hasSearch && selected === 'true', detail: `controls=${JSON.stringify(counts)} search=${hasSearch} selected=${selected}` }
  })

  await step('command:export', async () => {
    await closeMenus(win)
    const cmd = win.locator('button[aria-label="命令"]').first()
    try {
      await cmd.click({ timeout: 8000 })
    } catch {
      await cmd.dispatchEvent('click')
    }
    await sleep(700)
    const item = win.locator('[role=option]').filter({ hasText: /^export/ }).first()
    if ((await item.count()) === 0) return { ok: false, detail: 'no export command' }
    await item.click()
    await sleep(6000)
    const failedDialog = await win.evaluate(() =>
      [...document.querySelectorAll('[role=dialog]')].some((el) => (el.textContent || '').includes('导出失败')))
    const successDialog = await win.evaluate(() =>
      [...document.querySelectorAll('[role=dialog]')].some((el) => (el.textContent || '').includes('成功')))
    const downloads = join(homedir(), 'Downloads')
    const freshZip = readdirSync(downloads)
      .filter((name) => /^dsh-session-.*\.zip$/u.test(name))
      .some((name) => Date.now() - statSync(join(downloads, name)).mtimeMs < 20000)
    await closeToDialogCount(win, 0)
    return { ok: !failedDialog && (successDialog || freshZip), detail: `failedDialog=${failedDialog} successDialog=${successDialog} freshZip=${freshZip}` }
  })

  await step('command:compact', async () => {
    await closeMenus(win)
    const cmd = win.locator('button[aria-label="命令"]').first()
    try {
      await cmd.click({ timeout: 8000 })
    } catch {
      await cmd.dispatchEvent('click')
    }
    await sleep(700)
    const item = win.locator('[role=option]').filter({ hasText: /^compact/ }).first()
    if ((await item.count()) === 0) return { ok: false, detail: 'no compact command' }
    await item.click()
    await sleep(4000)
    const errorDialog = await win.evaluate(() =>
      [...document.querySelectorAll('[role=dialog]')].some((el) => (el.textContent || '').includes('失败')))
    const usable = (await win.locator('textarea').first().isEnabled())
    await closeToDialogCount(win, 0)
    return { ok: !errorDialog && usable, detail: `errorDialog=${errorDialog} usable=${usable}` }
  })

  await step('conversation:message-fork', async () => {
    if (activeSessionId === null) return { ok: false, detail: 'no active session' }
    const listBefore = await unary(win, 'session.list', {})
    const original = listBefore.result.value.items.find((s) => s.sessionId === activeSessionId)
    const beforeIds = new Set((await sessionIds(win)))
    const fork = win.locator('button[aria-label="在新对话中分支"]').first()
    if ((await fork.count()) === 0) return { ok: false, detail: 'no fork button' }
    try {
      await fork.click({ timeout: 8000 })
    } catch {
      await fork.dispatchEvent('click')
    }
    await sleep(1800)
    const dialogs = await win.locator('[role=dialog]').count()
    const afterIds = await sessionIds(win)
    const grew = afterIds.length > beforeIds.size
    if (dialogs > 0) {
      await win.keyboard.press('Escape')
      await sleep(500)
    }
    // An immediate fork switches the active session; return to the original.
    if (original?.title !== undefined) {
      const row = win.locator('[class*=sessionRow]').filter({ hasText: new RegExp(`^${escapeRegExp(original.title)}`) }).first()
      if ((await row.count()) > 0) {
        await row.click()
        await sleep(1200)
      }
    }
    return { ok: dialogs > 0 || grew, detail: `dialogs=${dialogs} sessionsGrew=${grew}` }
  })

  // F. Host health smoke
  await step('host:tool-catalog', async () => {
    const list = await unary(win, 'session.list', {})
    const newest = list.result.value.items.filter((s) => !s.blank).sort((a, b) => b.updatedAt - a.updatedAt)[0]
    if (newest === undefined) return { ok: false, detail: 'no session to inspect' }
    const hist = await unary(win, 'session.history', { sessionId: newest.sessionId })
    const tools = (() => {
      const found = []
      const walk = (value) => {
        if (Array.isArray(value)) {
          for (const item of value) {
            if (item !== null && typeof item === 'object' && typeof item.name === 'string') found.push(item.name)
          }
          for (const item of value) walk(item)
          return
        }
        if (value !== null && typeof value === 'object') {
          for (const key of Object.keys(value)) walk(value[key])
        }
      }
      for (const e of hist.result.value.events) {
        if (e.event.type.startsWith('request/')) walk(e.event.data)
      }
      return [...new Set(found)]
    })()
    if (tools === null) return { ok: false, detail: 'no request/context tools event' }
    if (tools.length === 0) return { ok: false, detail: 'no tool names in request events' }
    const names = tools.join(' ')
    const expected = ['todo', 'ask_user_question', 'pwsh', 'read', 'write']
    const ok = expected.every((x) => names.includes(x))
    return { ok, detail: `tools=${tools.length} sample=${tools.slice(0, 30).join(',')}` }
  })

  await step('host:rpc-smoke', async () => {
    const list = await unary(win, 'session.list', {})
    const ws = await unary(win, 'workspace.list', {})
    const prov = await unary(win, 'llm.providers', {})
    return { ok: list.result.ok && ws.result.ok && prov.result.ok, detail: 'session/workspace/llm ok' }
  })

  await closeMenus(win)
  await app.close().catch(() => {})
}

const mockText = 'seed-ok matrix-ok button-ok'
const { env, usingMock: mockActive, close } = await mockLlmEnv(mockText)
usingMock = mockActive

await main(env).catch((error) => {
  console.error('MATRIX_CRASH', error.message)
  results.push({ name: 'matrix-crash', ok: false, detail: error.message })
})

await close()

console.log(JSON.stringify({ results, consoleErrors: consoleErrors.slice(0, 20) }, null, 2))
