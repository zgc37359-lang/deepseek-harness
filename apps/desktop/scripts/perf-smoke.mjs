/**
 * Packaged-app performance smoke for Windows CI.
 *
 * Launches dist-app2/win-unpacked/DeepSeek Harness.exe with --smoke-test,
 * measures the cold-start window (spawn -> DESKTOP_SMOKE_OK on stdout), and
 * samples the main process working set while it runs. Fails when either
 * measurement exceeds its budget. Budgets are overridable through
 * DSH_DESKTOP_COLD_START_BUDGET_MS and DSH_DESKTOP_PEAK_MEMORY_BUDGET_MIB.
 *
 * Usage: node scripts/perf-smoke.mjs
 */

import { spawn, execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const exe = resolve(appDir, 'dist-app2', 'win-unpacked', 'DeepSeek Harness.exe')
const coldStartBudgetMs = Number(process.env.DSH_DESKTOP_COLD_START_BUDGET_MS ?? 15_000)
const peakMemoryBudgetMiB = Number(process.env.DSH_DESKTOP_PEAK_MEMORY_BUDGET_MIB ?? 1024)

if (process.platform !== 'win32') {
  throw new Error('perf-smoke is a Windows-only gate')
}

/** Read the current working set (bytes) of a PID, or 0 when gone. */
function workingSetBytes(pid) {
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).WorkingSet64`,
    ], { encoding: 'utf8', windowsHide: true }).trim()
    return Number(out) || 0
  } catch {
    return 0
  }
}

const startedAt = Date.now()
const child = spawn(exe, ['--smoke-test'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })

let stdout = ''
let coldStartMs = null
child.stdout.on('data', (chunk) => {
  stdout += chunk.toString()
  if (coldStartMs === null && stdout.includes('DESKTOP_SMOKE_OK')) {
    coldStartMs = Date.now() - startedAt
  }
})

let peakMemoryMiB = 0
const memoryTimer = setInterval(() => {
  const bytes = workingSetBytes(child.pid)
  const mebibytes = bytes / 1024 / 1024
  if (mebibytes > peakMemoryMiB) peakMemoryMiB = mebibytes
}, 200)

const exitCode = await new Promise((resolveExit) => {
  child.on('exit', resolveExit)
  child.on('error', (error) => {
    console.error(`perf-smoke: failed to launch ${exe}: ${error.message}`)
    resolveExit(1)
  })
})
clearInterval(memoryTimer)

const coldStart = coldStartMs ?? Number.POSITIVE_INFINITY
console.log(JSON.stringify({
  coldStartMs: Math.round(coldStart),
  peakMemoryMiB: Math.round(peakMemoryMiB),
  coldStartBudgetMs,
  peakMemoryBudgetMiB,
  exitCode,
  ok: stdout.includes('DESKTOP_SMOKE_OK'),
}, null, 2))

const failures = []
if (!stdout.includes('DESKTOP_SMOKE_OK')) failures.push(`smoke marker missing (exit ${exitCode})`)
if (coldStart > coldStartBudgetMs) failures.push(`cold start ${Math.round(coldStart)}ms > ${coldStartBudgetMs}ms`)
if (peakMemoryMiB > peakMemoryBudgetMiB) failures.push(`peak memory ${Math.round(peakMemoryMiB)}MiB > ${peakMemoryBudgetMiB}MiB`)

if (failures.length > 0) {
  for (const failure of failures) console.error(`perf-smoke: ${failure}`)
  process.exitCode = 1
}
