/**
 * "Load earlier" visibility gate for the packaged desktop app.
 *
 * Launches the packaged exe with a temporary profile and a copy of the real
 * session home, restores the known oversized session, clicks "加载更早", and
 * asserts that the visible chat flow gains nodes instead of silently loading
 * continuation chunks. Fails non-zero on no growth or any renderer page error.
 *
 * Usage: node scripts/load-older-e2e.mjs [exe-path]
 */

import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(fileURLToPath(new URL('../package.json', import.meta.url)))
const { _electron } = require('playwright')

const appDir = fileURLToPath(new URL('..', import.meta.url))
const exe = process.argv[2] ?? join(appDir, 'dist-app2', 'win-unpacked', 'DeepSeek Harness.exe')
const SESSION_ID = 'session-7d7829f4-f93e-4e3b-9b50-6a73a762b14c'

const root = mkdtempSync(join(tmpdir(), 'dsh-load-older-e2e-'))
const profile = join(root, 'profile')
const home = join(root, 'home')
const cleanup = () => {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    // Best-effort cleanup.
  }
}

if (!existsSync(exe)) {
  console.error(`load-older-e2e: exe not found: ${exe}`)
  cleanup()
  process.exit(1)
}

cpSync(resolve('C:/Users/cc/.dsh'), home, {
  recursive: true,
  filter: source => !source.endsWith('.credentials.yaml'),
})

const pageErrors = []
try {
  const app = await _electron.launch({
    executablePath: exe,
    timeout: 120000,
    args: [`--user-data-dir=${profile}`],
    env: { ...process.env, DSH_HOME: home },
  })
  const win = await app.firstWindow({ timeout: 120000 })
  win.on('pageerror', error => pageErrors.push(String(error).slice(0, 300)))

  await win.waitForSelector('.web-ui-host', { timeout: 120000 })
  await win.evaluate(sessionId => {
    localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId }))
  }, SESSION_ID)
  await win.reload({ waitUntil: 'domcontentloaded' })
  await win.waitForSelector('textarea', { timeout: 120000 })
  await new Promise(resolve => setTimeout(resolve, 2000))

  const nodeCount = () => win.locator('[data-chat-anchor-key]').count().catch(() => -1)
  const before = await nodeCount()
  if (before <= 0) {
    console.error(`load-older-e2e: no chat nodes before clicking (${before})`)
    await app.close().catch(() => {})
    cleanup()
    process.exit(1)
  }

  const button = win.getByRole('button', { name: '加载更早' })
  let clicks = 0
  let after = before
  let skipHintSeen = false
  while (clicks < 2 && (await button.count()) > 0) {
    await button.first().click({ timeout: 15000 }).catch(() => {})
    await new Promise(resolve => setTimeout(resolve, 2000))
    after = await nodeCount()
    skipHintSeen ||= (await win.getByText(/已跳过 \d+ 页超长内容/).count()) > 0
    clicks += 1
  }

  await app.close().catch(() => {})
  if (clicks === 0 || after <= before) {
    console.error(`load-older-e2e: no visible progress (before ${before}, after ${after}, clicks ${clicks})`)
    cleanup()
    process.exit(1)
  }
  if (!skipHintSeen) {
    console.error('load-older-e2e: skipped-pages hint never appeared')
    cleanup()
    process.exit(1)
  }
  if (pageErrors.length > 0) {
    console.error(`load-older-e2e: renderer page errors: ${pageErrors.join('\n')}`)
    cleanup()
    process.exit(1)
  }
  console.log(`load-older-e2e: OK (nodes ${before} -> ${after} after ${clicks} click(s))`)
  cleanup()
} catch (error) {
  console.error(`load-older-e2e: FAILED: ${String(error).split('\n').slice(0, 8).join('\n')}`)
  cleanup()
  process.exit(1)
}
