/** TEMP probe: goal-with-text, stop generation, bad provider, keyboard tab. Deleted after use. */
import { _electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const exe = resolve(appDir, 'dist-app2', 'win-unpacked', 'DeepSeek Harness.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (name, value) => console.log(`[${name}] ${JSON.stringify(value).slice(0, 1500)}`)

async function unary(win, method, payload) {
  return win.evaluate(async ({ method, payload }) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'probeC', method, payload })
    const raw = await window.desktop.runtime.unary(method, body)
    return JSON.parse(raw.body)
  }, { method, payload })
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
    dialogs: [...document.querySelectorAll('[role=dialog]')].map((el) => (el.getAttribute('aria-label') || (el.textContent || '').trim().slice(0, 40))).slice(0, 6),
    goalBar: [...document.querySelectorAll('[data-goal-bar]')].map((el) => (el.textContent || '').trim().slice(0, 80)),
    stop: document.querySelectorAll('button[aria-label="停止生成"]').length,
    bodyTail: (document.body.innerText || '').slice(-160),
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

// 1. Goal with text
await send(win, '/goal matrix test goal')
await sleep(20000)
await dump(win, 'goal-with-text')
const goalClear = win.locator('[data-goal-bar] button').filter({ hasText: /清除|清空|Clear/ }).first()
log('goal-clear-count', await goalClear.count())
if ((await goalClear.count()) > 0) {
  await goalClear.click()
  await sleep(1500)
  await dump(win, 'goal-cleared')
}

// 2. Stop generation
await send(win, 'run pwsh: Start-Sleep -Seconds 20')
await sleep(4000)
await dump(win, 'stop-before')
const stop = win.locator('button[aria-label="停止生成"]').first()
log('stop-count', await stop.count())
if ((await stop.count()) > 0) {
  await stop.click()
  await sleep(8000)
  await dump(win, 'stop-after')
}

// 3. Bad provider
const settingsTrigger = win.locator('button').filter({ hasText: /^设置$/ }).first()
if ((await settingsTrigger.getAttribute('aria-expanded')) !== 'true') await settingsTrigger.click()
await sleep(800)
await win.locator('button').filter({ hasText: /^模型$/ }).first().click()
await sleep(1200)
await win.locator('button').filter({ hasText: /添加自定义提供方/ }).first().click()
await sleep(1200)
await win.locator('input[aria-label="Provider ID"]').fill('matrix-bad')
await win.locator('input[aria-label="显示名称"]').fill('Matrix Bad')
await win.locator('input[aria-label="API 地址"]').fill('http://127.0.0.1:9')
await win.locator('input[aria-label="API 密钥"]').fill('x')
await win.locator('button').filter({ hasText: /获取可用模型/ }).first().click()
await sleep(2500)
await dump(win, 'provider-fetch-models')
await win.locator('button').filter({ hasText: /添加模型/ }).first().click()
await sleep(800)
log('add-model-fields', await win.evaluate(() =>
  [...document.querySelectorAll('[role=dialog] input')].map((el) => ({
    aria: el.getAttribute('aria-label') || '',
    placeholder: el.getAttribute('placeholder') || '',
    value: el.value,
  })).slice(-8)))
await win.keyboard.press('Escape')
await sleep(500)
await win.keyboard.press('Escape')
await sleep(600)

// 4. Keyboard tab from composer
const ta = win.locator('textarea').first()
await ta.click()
await win.keyboard.press('Tab')
await sleep(300)
log('tab-after', await win.evaluate(() => {
  const el = document.activeElement
  return el ? { tag: el.tagName, aria: el.getAttribute('aria-label') || '', text: (el.textContent || '').trim().slice(0, 30) } : null
}))
await win.keyboard.press('Shift+Tab')
await sleep(300)
log('shift-tab-after', await win.evaluate(() => {
  const el = document.activeElement
  return el ? { tag: el.tagName, aria: el.getAttribute('aria-label') || '' } : null
}))

await app.close().catch(() => {})
