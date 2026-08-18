/**
 * Packaged-app UI stress lane: burst messages through the real queue,
 * large assistant output, rapid session creation, and an active-window
 * event-loop drift sample, with memory growth accounting.
 *
 * Usage: node scripts/stress-test.mjs   (packaged app must not be running)
 */

import { _electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { isDesktopRunning, mockLlmEnv } from './mock-llm.mjs'

if (isDesktopRunning()) {
  console.error('DESKTOP_STRESS_FAIL: DeepSeek Harness is already running; close it before this gate')
  process.exit(1)
}

const appDir = fileURLToPath(new URL('..', import.meta.url))
const exe = resolve(appDir, 'dist-app2', 'win-unpacked', 'DeepSeek Harness.exe')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const NOISE = /ERR_FILE_NOT_FOUND/i
const errors = []

async function unary(win, method, payload) {
  return win.evaluate(async ({ method, payload }) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'stress', method, payload })
    const raw = await window.desktop.runtime.unary(method, body)
    return JSON.parse(raw.body)
  }, { method, payload })
}

async function sessionIds(win) {
  return (await unary(win, 'session.list', {})).result.value.items.map((s) => s.sessionId)
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

async function waitForTurn(win, before, timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const now = await turnCounts(win)
    for (const [sessionId, count] of Object.entries(now)) {
      if (count > (before[sessionId] ?? 0)) {
        const hist = await unary(win, 'session.history', { sessionId })
        const events = hist.result.value.events
        const lastText = events
          .filter((e) => e.event.type === 'assistant/message')
          .slice(-1)
          .map((e) => e.event.data.message.content.filter((b) => b.type === 'text').map((b) => b.text).join(''))
        return { sessionId, lastText: lastText.at(-1) ?? '' }
      }
    }
    await sleep(1000)
  }
  throw new Error('turn did not settle')
}

async function send(win, text) {
  const ta = win.locator('textarea').first()
  await ta.click()
  await win.keyboard.press('Control+a')
  await win.keyboard.press('Backspace')
  await win.keyboard.type(text)
  await win.keyboard.press('Enter')
}

async function driftSample(app) {
  return app.evaluate(async () => {
    const samples = []
    let next = Date.now()
    for (let i = 0; i < 200; i++) {
      next += 16
      const started = Date.now()
      await new Promise((r) => setTimeout(r, Math.max(0, next - Date.now())))
      samples.push(Date.now() - started)
    }
    samples.sort((a, b) => a - b)
    return {
      p95: samples[Math.floor(samples.length * 0.95)],
      max: samples.at(-1),
      mean: samples.reduce((a, b) => a + b, 0) / samples.length,
    }
  })
}

// Mock reply satisfies every text assertion in this lane: burst replies
// must contain "burst-" within their first 30 chars, and the big-output
// turn must contain 120 lines matching /^line-\d+$/.
const mockText = `burst-ok
${Array.from({ length: 120 }, (_, i) => `line-${i + 1}`).join('\n')}`
const { env, close } = await mockLlmEnv(mockText)
// Exit-hook fallback: if the lane throws, the app process is already
// closed by Playwright teardown, but the mock server must not survive.
process.on('exit', () => { void close() })

const app = await _electron.launch({ executablePath: exe, timeout: 120000, env })
const win = await app.firstWindow({ timeout: 120000 })
win.on('console', (m) => {
  if (['error', 'warning'].includes(m.type()) && !NOISE.test(m.text())) errors.push(`${m.type()}: ${m.text().slice(0, 200)}`)
})
win.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
await win.waitForSelector('.web-ui-host', { timeout: 90000 })
await sleep(2000)
await app.evaluate(({ BrowserWindow }) => {
  const w = BrowserWindow.getAllWindows()[0]
  w.focus()
  w.moveTop()
})
await sleep(400)

const memoryBefore = await app.evaluate(() => Math.round(process.memoryUsage().rss / 1024 / 1024))

// One session for the burst (created or reused blank; the seed turn locates it).
const createBtn = win.locator('button').filter({ hasText: /^新会话$/ }).first()
await createBtn.click({ timeout: 10000 })
await sleep(1200)

// Seed once so the session has content.
const seedBefore = await turnCounts(win)
await send(win, 'reply with exactly stress-seed')
await waitForTurn(win, seedBefore)

// Burst: four queued messages back to back.
const burstBefore = await turnCounts(win)
const burstStart = Date.now()
const perTurn = []
for (let i = 1; i <= 4; i++) {
  const before = await turnCounts(win)
  await send(win, `reply with exactly burst-${i}`)
  const turn = await waitForTurn(win, before)
  perTurn.push({ label: `burst-${i}`, text: turn.lastText.slice(0, 30) })
}
const burstTotalMs = Date.now() - burstStart

// Large output.
const bigBefore = await turnCounts(win)
const bigStart = Date.now()
await send(win, 'output exactly 120 lines, each line containing its number like line-1, nothing else')
const bigTurn = await waitForTurn(win, bigBefore, 240000)
const bigLines = bigTurn.lastText.split('\n').filter((l) => /^line-\d+$/u.test(l.trim())).length
const bigOutputMs = Date.now() - bigStart

// Rapid session creation: five more.
const rapid = []
for (let i = 0; i < 5; i++) {
  const start = Date.now()
  await createBtn.click({ timeout: 10000 })
  rapid.push({ ms: Date.now() - start })
  await sleep(400)
}

// Active-window event-loop drift during steady state.
const drift = await driftSample(app)
const memoryAfter = await app.evaluate(() => Math.round(process.memoryUsage().rss / 1024 / 1024))

const result = {
  burstTotalMs,
  burstPerTurnMs: perTurn,
  bigOutput: { lines: bigLines, ms: bigOutputMs, chars: bigTurn.lastText.length },
  rapidSessions: rapid,
  eventLoopDriftMs: drift,
  memoryMiB: { before: memoryBefore, after: memoryAfter, delta: memoryAfter - memoryBefore },
  consoleErrors: errors,
}

const failures = []
if (perTurn.length !== 4 || perTurn.some((t) => !t.text.includes('burst-'))) failures.push('burst incomplete')
if (bigLines < 100) failures.push(`big output too short: ${bigLines} lines`)
if (rapid.some((r) => r.ms >= 10000)) failures.push('rapid session click stalled')
if (drift.p95 > 200) failures.push(`event-loop p95 ${drift.p95}ms > 200ms`)
if (result.memoryMiB.delta > 700) failures.push(`memory delta ${result.memoryMiB.delta}MiB > 700MiB`)
if (errors.length > 0) failures.push(`console/page errors: ${errors.length}`)

console.log(JSON.stringify({ ...result, ok: failures.length === 0, failures }, null, 2))
await app.close().catch(() => {})
await close()
if (failures.length > 0) process.exitCode = 1
