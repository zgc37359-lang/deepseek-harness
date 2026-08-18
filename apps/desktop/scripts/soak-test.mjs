/**
 * Packaged-app soak lane for Windows CI: drives N agent turns through the
 * real UI against the mock LLM, sampling main-process RSS and handle count
 * after each turn, and fails when the growth over the run exceeds budget.
 * Catches leaks that a single-turn gate cannot see.
 *
 * Usage: node scripts/soak-test.mjs   (packaged app must not be running)
 *
 * Environment:
 *   DSH_DESKTOP_SOAK_TURNS          turns to run (default 10)
 *   DSH_DESKTOP_SOAK_MEMORY_BUDGET_MIB  max RSS growth (default 100)
 *   DSH_DESKTOP_SOAK_HANDLES_BUDGET     max handle growth (default 300)
 */

import { _electron } from 'playwright'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { isDesktopRunning, mockLlmEnv } from './mock-llm.mjs'

if (isDesktopRunning()) {
  console.error('DESKTOP_SOAK_FAIL: DeepSeek Harness is already running; close it before this gate')
  process.exit(1)
}

const appDir = fileURLToPath(new URL('..', import.meta.url))
const exe = resolve(appDir, 'dist-app2', 'win-unpacked', 'DeepSeek Harness.exe')
const turns = Number(process.env.DSH_DESKTOP_SOAK_TURNS ?? 10)
const memoryBudgetMiB = Number(process.env.DSH_DESKTOP_SOAK_MEMORY_BUDGET_MIB ?? 100)
const handlesBudget = Number(process.env.DSH_DESKTOP_SOAK_HANDLES_BUDGET ?? 300)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const NOISE = /ERR_FILE_NOT_FOUND/i
const errors = []

async function unary(win, method, payload) {
  return win.evaluate(async ({ method, payload }) => {
    const body = JSON.stringify({ type: 'client-request', rpcId: 'soak', method, payload })
    const raw = await window.desktop.runtime.unary(method, body)
    return JSON.parse(raw.body)
  }, { method, payload })
}

async function turnCounts(win) {
  const sessions = (await unary(win, 'session.list', {})).result.value.items
  const counts = {}
  for (const session of sessions) {
    const hist = await unary(win, 'session.history', { sessionId: session.sessionId })
    counts[session.sessionId] = hist.result.value.events.filter((e) => e.event.type === 'turn/end').length
  }
  return counts
}

async function waitForTurn(win, before, timeoutMs = 240000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const now = await turnCounts(win)
    for (const [sessionId, count] of Object.entries(now)) {
      if (count > (before[sessionId] ?? 0)) return
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

/** Main-process RSS in MiB and handle count via the Electron main world. */
async function sample(app) {
  const memoryMiB = await app.evaluate(() => Math.round(process.memoryUsage().rss / 1024 / 1024))
  let handles = 0
  try {
    const pid = await app.evaluate(() => process.pid)
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).HandleCount`,
    ], { encoding: 'utf8', windowsHide: true }).trim()
    handles = Number(out) || 0
  } catch {
    // Handle sampling is best-effort; memory is the primary signal.
  }
  return { memoryMiB, handles }
}

const mockText = 'soak-ok'
const { env, close } = await mockLlmEnv(mockText)
process.on('exit', () => { void close() })

const app = await _electron.launch({ executablePath: exe, timeout: 120000, env })
try {
  const win = await app.firstWindow({ timeout: 120000 })
  win.on('console', (m) => {
    if (['error', 'warning'].includes(m.type()) && !NOISE.test(m.text())) errors.push(`${m.type()}: ${m.text().slice(0, 200)}`)
  })
  win.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`))
  await win.waitForSelector('.web-ui-host', { timeout: 90000 })
  await sleep(2000)

  // Seed once so the session has content, then run the turn loop.
  const seedBefore = await turnCounts(win)
  await send(win, 'reply with exactly soak-seed')
  await waitForTurn(win, seedBefore)

  const samples = [await sample(app)]
  for (let i = 0; i < turns; i++) {
    const before = await turnCounts(win)
    await send(win, `reply with exactly soak-${i}`)
    await waitForTurn(win, before)
    samples.push(await sample(app))
    await sleep(500)
  }

  const first = samples[0]
  const last = samples[samples.length - 1]
  const memoryDelta = last.memoryMiB - first.memoryMiB
  const handlesDelta = last.handles - first.handles
  const result = {
    turns,
    memoryMiB: { first: first.memoryMiB, last: last.memoryMiB, delta: memoryDelta },
    handles: { first: first.handles, last: last.handles, delta: handlesDelta },
    samples,
    consoleErrors: errors,
  }

  const failures = []
  if (memoryDelta > memoryBudgetMiB) failures.push(`memory grew ${memoryDelta}MiB > ${memoryBudgetMiB}MiB`)
  if (handlesDelta > handlesBudget) failures.push(`handles grew ${handlesDelta} > ${handlesBudget}`)
  if (errors.length > 0) failures.push(`console/page errors: ${errors.length}`)

  console.log(JSON.stringify({ ...result, ok: failures.length === 0, failures }, null, 2))
  if (failures.length > 0) process.exitCode = 1
} finally {
  await app.close().catch(() => {})
  await close()
}
