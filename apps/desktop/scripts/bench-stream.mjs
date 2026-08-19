/**
 * Packaged-app streaming benchmark for Windows CI: starts the scriptable
 * mock LLM server, launches `dist-app2/win-unpacked/Harness Desktop.exe`
 * with `--bench-stream "<task>"` pointed at it, and gates first-token
 * latency, total duration, and throughput.
 *
 * Usage: node scripts/bench-stream.mjs
 *
 * Environment:
 *   DSH_DESKTOP_BENCH_TASK                 prompt text (default "answer with the streamed benchmark text")
 *   DSH_DESKTOP_BENCH_SUCCESS_TEXT         mock reply text (default below)
 *   DSH_DESKTOP_BENCH_CHUNK_SIZE           text-delta chunk size (default 8)
 *   DSH_DESKTOP_BENCH_CHUNK_DELAY_MS       delay between chunks (default 5)
 *   DSH_DESKTOP_FIRST_TOKEN_BUDGET_MS      first-token budget (default 2000)
 *   DSH_DESKTOP_STREAM_TOTAL_BUDGET_MS     end-to-end budget (default 5000)
 *   DSH_DESKTOP_MIN_CHARS_PER_SEC          minimum throughput (default 100)
 */

import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = resolve(appDir, '..', '..')
const exe = resolve(appDir, 'dist-app2', 'win-unpacked', 'Harness Desktop.exe')
const mockBin = resolve(repoRoot, 'packages', 'test-support', 'llm-mock-server', 'src', 'bin.ts')
const apiKey = 'desktop-bench-mock-key'

const task = process.env.DSH_DESKTOP_BENCH_TASK ?? 'answer with the streamed benchmark text'
const successText = process.env.DSH_DESKTOP_BENCH_SUCCESS_TEXT
  ?? 'desktop streaming benchmark reached the mock and streamed its reply'
const chunkSize = Number(process.env.DSH_DESKTOP_BENCH_CHUNK_SIZE ?? 8)
const chunkDelayMs = Number(process.env.DSH_DESKTOP_BENCH_CHUNK_DELAY_MS ?? 5)
const firstTokenBudgetMs = Number(process.env.DSH_DESKTOP_FIRST_TOKEN_BUDGET_MS ?? 2_000)
const totalBudgetMs = Number(process.env.DSH_DESKTOP_STREAM_TOTAL_BUDGET_MS ?? 5_000)
const minCharsPerSecond = Number(process.env.DSH_DESKTOP_MIN_CHARS_PER_SEC ?? 100)

if (process.platform !== 'win32') {
  throw new Error('bench-stream is a Windows-only gate')
}

/** Wait for one JSONL record of the given type on a spawned process stdout. */
async function waitForRecord(processName, stream, type) {
  let buffer = ''
  for await (const chunk of stream) {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (line.trim() === '') continue
      let record
      try {
        record = JSON.parse(line)
      } catch {
        continue
      }
      if (record.type === type) return record
    }
  }
  throw new Error(`bench-stream: ${processName} exited before its ${type} record`)
}

/** Run one child and resolve with its stdout and exit code. */
async function runChild(name, command, args, env) {
  const child = spawn(command, args, {
    cwd: repoRoot,
    windowsHide: true,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += chunk.toString() })
  child.stderr.on('data', chunk => { stderr += chunk.toString() })
  const exitCode = await new Promise((resolveExit) => {
    child.on('exit', resolveExit)
    child.on('error', error => {
      console.error(`bench-stream: failed to launch ${name}: ${error.message}`)
      resolveExit(1)
    })
  })
  return { stdout, stderr, exitCode: exitCode ?? 1 }
}

const mockEnv = { ...process.env }
const mock = spawn(process.execPath, [
  '--import', 'tsx', mockBin,
  '--port', '0',
  '--api-key', apiKey,
  '--sequence', 'success',
  '--repeat-last',
  '--success-text', successText,
  '--chunk-size', String(chunkSize),
  '--chunk-delay-ms', String(chunkDelayMs),
], {
  cwd: repoRoot,
  windowsHide: true,
  env: mockEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let result
try {
  const ready = await waitForRecord('mock llm server', mock.stdout, 'ready')
  const appEnv = {
    ...process.env,
    DEEPSEEK_API_KEY: apiKey,
    DEEPSEEK_BASE_URL: ready.baseURL,
  }
  const app = await runChild('desktop app', exe, ['--bench-stream', task], appEnv)
  const lines = app.stdout.split('\n').map(line => line.trim()).filter(line => line !== '')
  const markerIndex = lines.findIndex(line => line.startsWith('DESKTOP_BENCH_STREAM_'))
  if (markerIndex < 0) {
    console.error(`bench-stream: missing result marker. stdout:\n${app.stdout}\nstderr:\n${app.stderr}`)
    process.exitCode = 1
  } else {
    const marker = lines[markerIndex]
    const json = lines[markerIndex + 1]
    if (json === undefined || !json.startsWith('{')) {
      console.error(`bench-stream: marker ${marker} has no JSON payload. stdout:\n${app.stdout}\nstderr:\n${app.stderr}`)
      process.exitCode = 1
    } else {
      result = JSON.parse(json)
      const failures = []
      if (!result.ok) failures.push(`stream did not complete: reason=${result.reason}`)
      if (result.firstTokenMs !== null && result.firstTokenMs > firstTokenBudgetMs) {
        failures.push(`first token ${result.firstTokenMs}ms > ${firstTokenBudgetMs}ms`)
      }
      if (result.totalMs > totalBudgetMs) failures.push(`total ${result.totalMs}ms > ${totalBudgetMs}ms`)
      if (result.charsPerSecond < minCharsPerSecond) {
        failures.push(`throughput ${result.charsPerSecond}/s < ${minCharsPerSecond}/s`)
      }
      console.log(JSON.stringify({ ...result, budgets: { firstTokenBudgetMs, totalBudgetMs, minCharsPerSecond } }, null, 2))
      for (const failure of failures) console.error(`bench-stream: ${failure}`)
      if (failures.length > 0 || app.exitCode !== 0) process.exitCode = 1
    }
  }
} finally {
  if (mock.exitCode === null) {
    await new Promise((resolveExit) => {
      const timer = setTimeout(() => { mock.kill() }, 2000)
      mock.once('exit', () => { clearTimeout(timer); resolveExit() })
      mock.kill()
    })
  }
}
