/** TEMP export verification. Deleted after use. */
import { _electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const exe = resolve(appDir, 'dist-app2', 'win-unpacked', 'DeepSeek Harness.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const app = await _electron.launch({ executablePath: exe, timeout: 120000 })
const win = await app.firstWindow({ timeout: 120000 })
await win.waitForSelector('.web-ui-host', { timeout: 90000 })
await sleep(2500)
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.focus()
  w.moveTop()
})
await sleep(400)

await win.locator('button[aria-label="命令"]').first().click()
await sleep(800)
await win.locator('[role=option]').filter({ hasText: /^export/ }).first().click()
await sleep(6000)
const state = await win.evaluate(() => ({
  dialogs: [...document.querySelectorAll('[role=dialog]')].map((el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 220)),
  revealButton: [...document.querySelectorAll('[role=dialog] button')]
    .some((b) => ['Show in folder', '在文件夹中显示'].includes((b.textContent || '').trim())),
}))
console.log('EXPORT_STATE', JSON.stringify(state))
await app.close().catch(() => {})
