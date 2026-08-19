/** TEMP probe: workspace rename, archive, drag order, bad provider. Deleted after use. */
import { _electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const exe = resolve(appDir, 'dist-app2', 'win-unpacked', 'DeepSeek Harness.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (name, value) => console.log(`[${name}] ${JSON.stringify(value).slice(0, 1600)}`)

async function unary(win, method, payload) {
  return win.evaluate(async ({ method, payload }) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'probeB', method, payload })
    const raw = await window.desktop.runtime.unary(method, body)
    return JSON.parse(raw.body)
  }, { method, payload })
}

async function sessionIds(win) {
  return (await unary(win, 'session.list', {})).result.value.items.map((s) => s.sessionId)
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

// 1. Workspace rename dialog
const wsRow = win.locator('[class*=projectRow]').first()
const box = await wsRow.boundingBox()
await win.mouse.move(box.x + 20, box.y + box.height / 2)
await sleep(500)
await wsRow.locator('button[aria-label*="的操作"]').first().click()
await sleep(700)
await win.locator('[role=menuitem]').filter({ hasText: /重命名/ }).first().click()
await sleep(1000)
log('ws-rename-dialog', await win.evaluate(() =>
  [...document.querySelectorAll('[role=dialog] input, [role=dialog] button')].map((el) => ({
    tag: el.tagName,
    type: el.getAttribute('type'),
    value: el.value,
    text: (el.textContent || '').trim(),
    aria: el.getAttribute('aria-label') || '',
  }))))
await win.keyboard.press('Escape')
await sleep(600)

// 2. Archive a scratch session
const beforeIds = new Set(await sessionIds(win))
await win.locator('button').filter({ hasText: /^新会话$/ }).first().click()
await sleep(2500)
const scratchId = (await sessionIds(win)).find((id) => !beforeIds.has(id))
const ta = win.locator('textarea').first()
await ta.click()
await win.keyboard.type('say archive-me')
await win.keyboard.press('Enter')
await sleep(12000)
log('scratch', { id: scratchId, title: (await unary(win, 'session.list', {})).result.value.items.find((s) => s.sessionId === scratchId)?.title })
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
log('archive-row-found', row !== null)
if (row) {
  const rbox = await row.boundingBox()
  await win.mouse.move(rbox.x + 20, rbox.y + rbox.height / 2)
  await sleep(500)
  await row.locator('button[aria-label*="操作"]').first().click()
  await sleep(700)
  log('archive-menu', await win.locator('[role=menuitem]').allTextContents())
  await win.locator('[role=menuitem]').filter({ hasText: /归档会话/ }).first().click()
  await sleep(1500)
  const stillVisible = (await win.locator('[class*=sessionRow]').filter({ hasText: /archive-me/ }).count()) > 0
  const inList = (await sessionIds(win)).includes(scratchId)
  log('archive-after', { stillVisible, inList })
}

// 3. Drag reorder under manual sort
await win.locator('button[aria-label="视图选项"]').first().click()
await sleep(600)
const manual = win.locator('[role=menuitem]').filter({ hasText: /手动排序/ }).first()
if ((await manual.count()) > 0) {
  await manual.click()
  await sleep(800)
}
const rows2 = win.locator('[class*=sessionRow]')
const first = rows2.nth(0)
const second = rows2.nth(1)
const fbox = await first.boundingBox()
const sbox = await second.boundingBox()
if (fbox && sbox) {
  const beforeOrder = (await rows2.allTextContents()).slice(0, 2).map((t) => t.trim().slice(0, 20))
  await win.mouse.move(fbox.x + 30, fbox.y + fbox.height / 2)
  await win.mouse.down()
  await win.mouse.move(fbox.x + 30, fbox.y + fbox.height / 2 + 8, { steps: 5 })
  await sleep(200)
  await win.mouse.move(sbox.x + 30, sbox.y + sbox.height / 2, { steps: 8 })
  await sleep(300)
  await win.mouse.up()
  await sleep(1200)
  const afterOrder = (await rows2.allTextContents()).slice(0, 2).map((t) => t.trim().slice(0, 20))
  log('drag-order', { beforeOrder, afterOrder })
}
await win.keyboard.press('Escape').catch(() => {})

// 4. Bad provider add/remove
const settingsTrigger = win.locator('button').filter({ hasText: /^设置$/ }).first()
if ((await settingsTrigger.getAttribute('aria-expanded')) !== 'true') await settingsTrigger.click()
await sleep(800)
await win.locator('button').filter({ hasText: /^模型$/ }).first().click()
await sleep(1200)
await win.locator('button').filter({ hasText: /添加自定义提供方/ }).first().click()
await sleep(1200)
log('provider-dialog', await win.evaluate(() =>
  [...document.querySelectorAll('[role=dialog] input, [role=dialog] button')].map((el) => ({
    tag: el.tagName,
    type: el.getAttribute('type'),
    placeholder: el.getAttribute('placeholder') || '',
    text: (el.textContent || '').trim().slice(0, 40),
    aria: el.getAttribute('aria-label') || '',
  })).slice(-25)))
await win.keyboard.press('Escape')
await sleep(600)
await win.keyboard.press('Escape')
await sleep(600)

await app.close().catch(() => {})
