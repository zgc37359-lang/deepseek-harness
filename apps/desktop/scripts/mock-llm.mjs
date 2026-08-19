/**
 * Shared mock-LLM bootstrap for packaged-desktop UI gates (ui-matrix,
 * stress-test). Starts the repo's scriptable mock LLM server on an
 * ephemeral port and returns the app environment pointing at it, so the
 * gates run keyless in CI while a real DEEPSEEK_API_KEY environment keeps
 * using the real provider unchanged.
 *
 * Usage: node scripts/ui-matrix.mjs   (packaged app must not be running)
 */

import { execFileSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const repoRoot = resolve(appDir, '..', '..')
const mockBin = resolve(repoRoot, 'packages', 'test-support', 'llm-mock-server', 'src', 'bin.ts')
const apiKey = 'desktop-ui-mock-key'

/** Whether the current environment already provides a real model backend. */
export function hasRealLlm() {
  return process.env.DEEPSEEK_API_KEY !== undefined && process.env.DEEPSEEK_API_KEY !== ''
}

/**
 * Start the mock LLM server and resolve with the app environment that
 * points at it.
 * @param successText - the fixed assistant reply the mock streams.
 * @param chunkSize - text-delta chunk size (default 8).
 * @param chunkDelayMs - delay between chunks (default 5).
 * @returns the app env plus a close() that terminates the mock server.
 */
export async function startMockLlm(successText, chunkSize = 8, chunkDelayMs = 5) {
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
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let buffer = ''
  const baseURL = await new Promise((resolveReady, reject) => {
    mock.stdout.on('data', (chunk) => {
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
        if (record.type === 'ready') {
          resolveReady(record.baseURL)
          return
        }
      }
    })
    mock.once('exit', (code) => {
      reject(new Error(`mock llm server exited before ready (code ${code})`))
    })
    mock.once('error', reject)
  })
  return {
    env: { ...process.env, DEEPSEEK_API_KEY: apiKey, DEEPSEEK_BASE_URL: baseURL },
    close: async () => {
      if (mock.exitCode === null) {
        await new Promise((resolveExit) => {
          const timer = setTimeout(() => { mock.kill() }, 2000)
          mock.once('exit', () => {
            clearTimeout(timer)
            resolveExit()
          })
          mock.kill()
        })
      }
    },
  }
}

/**
 * Resolve the app environment for a UI gate: real provider when
 * DEEPSEEK_API_KEY is present, otherwise a mock LLM server.
 * @param successText - mock reply text used only in the mock case.
 * @returns the app env, whether the mock is in use, and a close().
 */
export async function mockLlmEnv(successText) {
  if (hasRealLlm()) {
    return { env: process.env, usingMock: false, close: async () => {} }
  }
  const mock = await startMockLlm(successText)
  return { env: mock.env, usingMock: true, close: mock.close }
}

/**
 * Whether a Harness Desktop instance is already running. The packaged app
 * holds a single-instance lock, so a second launch quits immediately; gates
 * must fail with a clear message instead of a silent timeout.
 */
export function isDesktopRunning() {
  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      '(Get-Process -Name "Harness Desktop" -ErrorAction SilentlyContinue | Measure-Object).Count',
    ], { encoding: 'utf8', windowsHide: true }).trim()
    return Number(out) > 0
  } catch {
    return false
  }
}
