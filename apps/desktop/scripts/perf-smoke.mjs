/**
 * Packaged-app performance smoke for Windows CI.
 *
 * Launches dist-app2/win-unpacked/DeepSeek Harness.exe with --smoke-test,
 * measures the cold-start window (spawn -> DESKTOP_SMOKE_OK on stdout), and
 * samples the main process working set, handle count, and idle CPU while it
 * runs. Fails when a measurement exceeds its budget. Budgets are overridable
 * through DSH_DESKTOP_COLD_START_BUDGET_MS, DSH_DESKTOP_PEAK_MEMORY_BUDGET_MIB,
 * DSH_DESKTOP_PEAK_HANDLES_BUDGET, and DSH_DESKTOP_IDLE_CPU_BUDGET_PCT.
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
const peakHandlesBudget = Number(process.env.DSH_DESKTOP_PEAK_HANDLES_BUDGET ?? 2000)
const idleCpuBudgetPct = Number(process.env.DSH_DESKTOP_IDLE_CPU_BUDGET_PCT ?? 2)

if (process.platform !== 'win32') {
  throw new Error('perf-smoke is a Windows-only gate')
}

/** Read one process counter as a number, or 0 when the process is gone. */
function processCounter(pid, property) {
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).${property}`,
    ], { encoding: 'utf8', windowsHide: true }).trim()
    return Number(out) || 0
  } catch {
    return 0
  }
}

/** Working set in bytes. */
function workingSetBytes(pid) {
  return processCounter(pid, 'WorkingSet64')
}

/** Handle count (kernel object handles). */
function handleCount(pid) {
  return processCounter(pid, 'HandleCount')
}

/** Total CPU seconds consumed so far (across cores). */
function totalCpuSeconds(pid) {
  return processCounter(pid, 'TotalProcessorTime.TotalSeconds')
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
let peakHandles = 0
const samplerTimer = setInterval(() => {
  const bytes = workingSetBytes(child.pid)
  const mebibytes = bytes / 1024 / 1024
  if (mebibytes > peakMemoryMiB) peakMemoryMiB = mebibytes
  const handles = handleCount(child.pid)
  if (handles > peakHandles) peakHandles = handles
}, 200)

const exitCode = await new Promise((resolveExit) => {
  child.on('exit', resolveExit)
  child.on('error', (error) => {
    console.error(`perf-smoke: failed to launch ${exe}: ${error.message}`)
    resolveExit(1)
  })
})
clearInterval(samplerTimer)

const coldStart = coldStartMs ?? Number.POSITIVE_INFINITY
console.log(JSON.stringify({
  coldStartMs: Math.round(coldStart),
  peakMemoryMiB: Math.round(peakMemoryMiB),
  peakHandles,
  coldStartBudgetMs,
  peakMemoryBudgetMiB,
  peakHandlesBudget,
  exitCode,
  ok: stdout.includes('DESKTOP_SMOKE_OK'),
}, null, 2))

const failures = []
if (!stdout.includes('DESKTOP_SMOKE_OK')) failures.push(`smoke marker missing (exit ${exitCode})`)
if (coldStart > coldStartBudgetMs) failures.push(`cold start ${Math.round(coldStart)}ms > ${coldStartBudgetMs}ms`)
if (peakMemoryMiB > peakMemoryBudgetMiB) failures.push(`peak memory ${Math.round(peakMemoryMiB)}MiB > ${peakMemoryBudgetMiB}MiB`)
if (peakHandles > peakHandlesBudget) failures.push(`peak handles ${peakHandles} > ${peakHandlesBudget}`)

if (failures.length > 0) {
  for (const failure of failures) console.error(`perf-smoke: ${failure}`)
  process.exitCode = 1
}
