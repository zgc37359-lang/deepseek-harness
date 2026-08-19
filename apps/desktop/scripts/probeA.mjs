/** TEMP probe: user questions, plan review, goal, todo, commands, tool catalog. Deleted after use. */
import { _electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const exe = resolve(appDir, 'dist-app2', 'win-unpacked', 'DeepSeek Harness.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (name, value) => console.log(`[${name}] ${JSON.stringify(value).slice(0, 1800)}`)

async function unary(win, method, payload) {
  return win.evaluate(async ({ method, payload }) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'probeA', method, payload })
    const raw = await window.desktop.runtime.unary(method, body)
    return JSON.parse(raw.body)
  }, { method, payload })
}

async function turnCounts(win) {
  const list = await unary(win, 'session.list', {})
  const counts = {}
  for (const s of list.result.value.items) {
    if (s.blank) { counts[s.sessionId] = 0; continue }
    const hist = await unary(win, 'session.history', { sessionId: s.sessionId })
    counts[s.sessionId] = hist.result.value.events.filter((e) => e.event.type === 'turn/end').length
  }
  return counts
}

async function waitTurn(win, before, timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const now = await turnCounts(win)
    for (const [id, count] of Object.entries(now)) {
      if (count > (before[id] ?? 0)) return id
    }
    await sleep(1000)
  }
  throw new Error('no turn')
}

async function send(win, text) {
  const ta = win.locator('textarea').first()
  await ta.click()
  await win.keyboard.press('Control+a')
  await win.keyboard.press('Backspace')
  await win.keyboard.type(text)
  await win.keyboard.press('Enter')
}

async function dump(win, name) {
  log(name, await win.evaluate(() => ({
    dialogs: [...document.querySelectorAll('[role=dialog]')].map((el) => (el.getAttribute('aria-label') || '').slice(0, 60)),
    questionPanels: document.querySelectorAll('[data-command-input], [class*=question], [class*=askUser], [data-testid="todo-panel"], [data-goal-bar]').length,
    buttons: [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0)
      .map((b) => (b.getAttribute('aria-label') || (b.textContent || '').trim()).slice(0, 40)).filter(Boolean).slice(-30),
    bodyTail: (document.body.innerText || '').slice(-150),
  })))
}

const app = await _electron.launch({ executablePath: exe, timeout: 120000 })
const win = await app.firstWindow({ timeout: 120000 })
await win.waitForSelector('.web-ui-host', { timeout: 90000 })
await sleep(2000)
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.focus()
  w.moveTop()
})
await sleep(400)

// Tool catalog in request events
const newest = (await unary(win, 'session.list', {})).result.value.items.filter((s) => !s.blank)
  .sort((a, b) => b.updatedAt - a.updatedAt)[0]
if (newest) {
  const hist = (await unary(win, 'session.history', { sessionId: newest.sessionId })).result.value.events
  for (const e of hist) {
    if (e.event.type.includes('request')) {
      const data = e.event.data
      const keys = Object.keys(data)
      const tools = Array.isArray(data.tools) ? data.tools.map((t) => (t.name ?? t.id ?? '').slice(0, 40)) : null
      log('request-event', { type: e.event.type, keys, toolCount: tools?.length, toolSample: tools?.slice(0, 40) })
      break
    }
  }
}

// 1. User question flow
let before = await turnCounts(win)
await send(win, 'use the ask_user_question tool to ask me one multiple choice question with options A and B, then wait for my answer')
await sleep(15000)
await dump(win, 'user-question-panel')
const questionButtons = win.locator('[role=dialog] button, [class*=option] button, button').filter({ hasText: /^A$|^B$|A\)|B\)/ }).first()
log('question-option-count', await win.locator('button').filter({ hasText: /^A$|^B$|A\)|B\)/ }).count())
await win.locator('button').filter({ hasText: /^A$|^A\)/ }).first().click({ timeout: 5000 }).catch((e) => log('option-click-fail', String(e).split('\n')[0]))
await sleep(8000)
await dump(win, 'user-question-after')

// 2. Plan review
before = await turnCounts(win)
await send(win, '/plan')
await sleep(1200)
if ((await win.locator('textarea').first().inputValue()).startsWith('/plan')) await win.keyboard.press('Enter')
await sleep(2500)
await send(win, 'create a short plan for adding a settings toggle to a desktop app, then exit plan mode')
await sleep(25000)
await dump(win, 'plan-review')
const approve = win.locator('button').filter({ hasText: /^确认执行$/ }).first()
log('approve-count', await approve.count())
if ((await approve.count()) > 0) {
  await approve.click()
  await sleep(8000)
}
await send(win, '/plan off')
await sleep(2500)
await dump(win, 'plan-off')

// 3. Goal save
await send(win, '/goal')
await sleep(1500)
const goalInput = win.locator('input[aria-label="目标内容"], [data-goal-bar] input').first()
log('goal-input-count', await goalInput.count())
if ((await goalInput.count()) > 0) {
  await goalInput.fill('matrix test goal')
  await win.locator('button[aria-label*="保存"], button').filter({ hasText: /^保存$/ }).first().click({ timeout: 5000 }).catch(() => {})
  await sleep(1500)
  await dump(win, 'goal-after-save')
  await win.locator('button[aria-label*="清除"], button').filter({ hasText: /清除|清空/ }).first().click({ timeout: 5000 }).catch(() => {})
  await sleep(1000)
}

// 4. Todo panel
before = await turnCounts(win)
await send(win, 'use todo_write to create exactly two todos: alpha and beta')
await sleep(20000)
await dump(win, 'todo-panel')

// 5. Commands execution
await win.locator('button[aria-label="命令"]').first().click()
await sleep(700)
log('command-items', await win.locator('[role=option]').allTextContents())
for (const cmd of ['export', 'compact', 'feedback']) {
  const item = win.locator('[role=option]').filter({ hasText: new RegExp(`^${cmd}`) }).first()
  if ((await item.count()) === 0) { log(`command-missing-${cmd}`, true); continue }
  await item.click()
  await sleep(3000)
  await dump(win, `command-${cmd}`)
  await win.keyboard.press('Escape').catch(() => {})
  await sleep(800)
  await win.locator('button[aria-label="命令"]').first().click()
  await sleep(700)
}
await win.keyboard.press('Escape').catch(() => {})

await app.close().catch(() => {})
