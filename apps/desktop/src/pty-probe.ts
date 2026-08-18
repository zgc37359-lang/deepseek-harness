/**
 * Packaged-app PTY probe: load node-pty inside the Electron main process and
 * spawn one shell command. node-pty is N-API and ships win32 prebuilds, so
 * this verifies the native binding loads under Electron without a rebuild.
 * @module @deepseek-ai/dsh-desktop/pty-probe
 */

import { createRequire } from 'node:module'
import type { IPty } from 'node-pty'

const requireFromApp = createRequire(import.meta.url)

/** Outcome of the probe run. */
export interface PtyProbeResult {
  ok: boolean
  error?: string
}

/**
 * Spawn `cmd.exe` through node-pty and wait for the probe marker.
 * @param timeoutMs - How long to wait for the marker before failing.
 * @returns Whether the PTY round-trip succeeded.
 */
export function runPtyProbe(timeoutMs = 15_000): Promise<PtyProbeResult> {
  return new Promise((resolve) => {
    let settled = false
    let markerSeen = false
    const timer = setTimeout(() => { settle({ ok: false, error: 'timeout' }) }, timeoutMs)
    const settle = (result: PtyProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    try {
      const { spawn } = requireFromApp('node-pty') as {
        spawn: (file: string, args: string[], options: object) => IPty
      }
      const term = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'echo PTY_PROBE_OK'], {
        name: 'xterm-256color',
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
      })
      term.onData((data) => {
        if (data.includes('PTY_PROBE_OK')) markerSeen = true
      })
      term.onExit(({ exitCode }) => {
        settle(markerSeen ? { ok: true } : { ok: false, error: `pty exited with code ${exitCode}` })
      })
    } catch (error) {
      settle({ ok: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
}
