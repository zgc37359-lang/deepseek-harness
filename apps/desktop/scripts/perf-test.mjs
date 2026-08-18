/**
 * Packaged-app main-thread perf test for Windows CI: launches
 * `dist-app2/win-unpacked/DeepSeek Harness.exe` with `--perf-test` and gates
 * event-loop drift (p95), renderer frame rate, and main-process idle CPU
 * during the probe window.
 *
 * Usage: node scripts/perf-test.mjs
 *
 * Environment:
 *   DSH_DESKTOP_EVENT_LOOP_P95_BUDGET_MS   p95 drift budget (default 50)
 *   DSH_DESKTOP_FPS_MIN_BUDGET             minimum mean FPS (default 30)
 *   DSH_DESKTOP_IDLE_CPU_BUDGET_PCT        max main-process CPU during the
 *                                          window, as % of one core (default 2)
 */

import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const exe = resolve(appDir, 'dist-app2', 'win-unpacked', 'DeepSeek Harness.exe')
const eventLoopP95BudgetMs = Number(process.env.DSH_DESKTOP_EVENT_LOOP_P95_BUDGET_MS ?? 50)
const fpsMinBudget = Number(process.env.DSH_DESKTOP_FPS_MIN_BUDGET ?? 30)
const idleCpuBudgetPct = Number(process.env.DSH_DESKTOP_IDLE_CPU_BUDGET_PCT ?? 2)

if (process.platform !== 'win32') {
  throw new Error('perf-test is a Windows-only gate')
}

/** Total CPU seconds consumed by a PID so far, or 0 when gone. */
function totalCpuSeconds(pid) {
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `(Get-Process -Id ${pid} -ErrorAction SilentlyContinue).TotalProcessorTime.TotalSeconds`,
    ], { encoding: 'utf8', windowsHide: true }).trim()
    return Number(out) || 0
  } catch {
    return 0
  }
}

const child = spawn(exe, ['--perf-test'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
let stdout = ''
child.stdout.on('data', chunk => { stdout += chunk.toString() })
child.stderr.on('data', chunk => { stdout += chunk.toString() })

// Idle-CPU window: sample the main process from launch to exit. The probe
// runs a visible window for ~3 s with the main thread otherwise idle, so
// CPU here is the idle baseline, expressed as % of one core.
const wallStart = Date.now()
const cpuStart = totalCpuSeconds(child.pid)

const exitCode = await new Promise((resolveExit) => {
  child.on('exit', resolveExit)
  child.on('error', error => {
    console.error(`perf-test: failed to launch ${exe}: ${error.message}`)
    resolveExit(1)
  })
})
const wallMs = Date.now() - wallStart
const cpuDelta = totalCpuSeconds(child.pid) - cpuStart
const idleCpuPct = wallMs > 0 ? (cpuDelta / (wallMs / 1000)) * 100 : 0

const lines = stdout.split('\n').map(line => line.trim()).filter(line => line !== '')
const markerIndex = lines.findIndex(line => line.startsWith('DESKTOP_PERF_TEST_'))
if (markerIndex < 0 || !lines[markerIndex]?.startsWith('DESKTOP_PERF_TEST_OK')) {
  console.error(`perf-test: missing OK marker (exit ${exitCode}). output:\n${stdout}`)
  process.exitCode = 1
} else {
  const json = lines[markerIndex + 1]
  if (json === undefined || !json.startsWith('{')) {
    console.error(`perf-test: OK marker has no JSON payload. output:\n${stdout}`)
    process.exitCode = 1
  } else {
    const result = JSON.parse(json)
    const failures = []
    if (result.eventLoopMs.p95Ms > eventLoopP95BudgetMs) {
      failures.push(`event-loop p95 ${result.eventLoopMs.p95Ms}ms > ${eventLoopP95BudgetMs}ms`)
    }
    if (result.fps.meanFps < fpsMinBudget) {
      failures.push(`mean FPS ${result.fps.meanFps} < ${fpsMinBudget}`)
    }
    if (idleCpuPct > idleCpuBudgetPct) {
      failures.push(`idle CPU ${idleCpuPct.toFixed(2)}% > ${idleCpuBudgetPct}%`)
    }
    console.log(JSON.stringify({
      ...result,
      idleCpuPct: Number(idleCpuPct.toFixed(2)),
      budgets: { eventLoopP95BudgetMs, fpsMinBudget, idleCpuBudgetPct },
    }, null, 2))
    for (const failure of failures) console.error(`perf-test: ${failure}`)
    if (failures.length > 0 || exitCode !== 0) process.exitCode = 1
  }
}
