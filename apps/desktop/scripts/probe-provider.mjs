/** TEMP provider create probe. Deleted after use. */
import { _electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const exe = resolve(appDir, 'dist-app2', 'win-unpacked', 'DeepSeek Harness.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

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
const settings = win.locator('button').filter({ hasText: /^设置$/ }).first()
if ((await settings.getAttribute('aria-expanded')) !== 'true') await settings.click()
await sleep(800)
await win.locator('button').filter({ hasText: /^模型$/ }).first().click()
await sleep(1200)
await win.locator('button').filter({ hasText: /添加自定义提供方/ }).first().click()
await sleep(1200)
await win.locator('input[aria-label="Provider ID"]').fill('matrix-bad')
await win.locator('input[aria-label="显示名称"]').fill('Matrix Bad')
await win.locator('input[aria-label="API 地址"]').fill('http://127.0.0.1:9')
await win.locator('input[aria-label="API 密钥"]').fill('x')
const state = () => win.evaluate(() => {
  const create = [...document.querySelectorAll('[role=dialog] button')]
    .find((b) => (b.textContent || '').trim() === '创建提供方')
  return {
    createDisabled: create ? create.disabled : null,
    dialogButtons: [...document.querySelectorAll('[role=dialog] button')]
      .map((b) => ({ text: (b.textContent || '').trim(), aria: b.getAttribute('aria-label') || '' }))
      .filter((b) => b.text || b.aria),
    inputs: [...document.querySelectorAll('[role=dialog] input')]
      .map((i) => ({ aria: i.getAttribute('aria-label') || '', value: i.value })),
  }
})
console.log('BEFORE_ADD_MODEL', JSON.stringify(await state()))
await win.locator('button').filter({ hasText: /添加模型/ }).first().click()
await sleep(800)
console.log('AFTER_ADD_MODEL', JSON.stringify(await state()))
await win.locator('input[aria-label="模型 ID 1"]').fill('matrix-bad-model')
await win.locator('input[aria-label="显示名称 1"]').fill('Matrix Bad Model')
await sleep(400)
console.log('AFTER_FILL', JSON.stringify(await state()))
await win.locator('input[aria-label="模型 ID 1"]').press('Enter')
await sleep(600)
console.log('AFTER_ENTER', JSON.stringify(await state()))
const addConfirm = win.locator('[role=dialog] button').filter({ hasText: /^添加$/ }).first()
console.log('ADD_CONFIRM_COUNT', await addConfirm.count())
if ((await addConfirm.count()) > 0) {
  await addConfirm.click()
  await sleep(600)
}
console.log('AFTER_CONFIRM', JSON.stringify(await state()))
await app.close().catch(() => {})
