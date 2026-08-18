/**
 * Main-thread performance probes for the desktop shell: event-loop drift and
 * renderer frame rate. The drift sampler is injectable for deterministic
 * tests; the frame probe runs in the renderer through `executeJavaScript`.
 * @module @deepseek-ai/dsh-desktop/perf-test
 */

import type { BrowserWindow } from 'electron'

/** Event-loop drift summary over one sampling window. */
export interface DriftSummary {
  /** Average observed interval delta in milliseconds. */
  readonly meanMs: number
  /** Nearest-rank 95th percentile of observed deltas in milliseconds. */
  readonly p95Ms: number
  /** Largest observed delta in milliseconds. */
  readonly maxMs: number
}

/** Injectables for {@link measureEventLoopDrift}. */
export interface DriftOptions {
  /** Nominal tick interval. */
  readonly intervalMs: number
  /** Sampling window length; the last tick that reaches it ends the run. */
  readonly durationMs: number
  /** Schedule one tick; returns a cancellable handle. */
  readonly schedule: (callback: () => void, delayMs: number) => unknown
  /** Cancel a pending scheduled tick. */
  readonly cancel: (handle: unknown) => void
  /** Monotonic clock. */
  readonly now: () => number
}

/** Renderer frame-rate probe result. */
export interface FpsResult {
  readonly frameCount: number
  readonly elapsedMs: number
  readonly meanFps: number
}

/** Combined `--perf-test` probe result. */
export interface PerfProbeResult {
  readonly eventLoopMs: DriftSummary
  readonly fps: FpsResult
}

/**
 * Summarize observed interval deltas into mean, p95 (nearest rank), and max.
 * @param deltas - observed deltas in milliseconds.
 * @returns the summary; empty samples report zeros.
 */
export function summarizeDrift(deltas: readonly number[]): DriftSummary {
  if (deltas.length === 0) return { meanMs: 0, p95Ms: 0, maxMs: 0 }
  const sorted = [...deltas].sort((a, b) => a - b)
  const sum = deltas.reduce((total, delta) => total + delta, 0)
  const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)
  return {
    meanMs: sum / deltas.length,
    p95Ms: sorted[p95Index] ?? 0,
    maxMs: sorted[sorted.length - 1] ?? 0,
  }
}

/**
 * Sample the event loop by scheduling a repeating tick and recording the
 * actual clock deltas. Each tick schedules the next one only after firing.
 * @param options - tick and clock injectables.
 * @returns the observed deltas in milliseconds.
 */
export async function measureEventLoopDrift(options: DriftOptions): Promise<number[]> {
  const start = options.now()
  let last = start
  const deltas: number[] = []
  await new Promise<void>((resolve) => {
    let handle: unknown
    const tick = (): void => {
      const current = options.now()
      deltas.push(current - last)
      last = current
      if (current - start >= options.durationMs) {
        options.cancel(handle)
        resolve()
        return
      }
      handle = options.schedule(tick, options.intervalMs)
    }
    handle = options.schedule(tick, options.intervalMs)
  })
  return deltas
}

/** Renderer frame-rate result shape returned by the injected probe script. */
interface FrameProbeScriptResult {
  readonly frameCount: number
  readonly elapsedMs: number
}

/**
 * Count `requestAnimationFrame` callbacks in the renderer over the window.
 * The window must be visible; hidden windows throttle rAF to zero.
 * @param window - the main window whose web contents run the probe.
 * @param durationMs - probe window length.
 * @returns the frame count, elapsed time, and mean frames per second.
 */
export async function measureRendererFps(window: BrowserWindow, durationMs: number): Promise<FpsResult> {
  const result = await window.webContents.executeJavaScript(`new Promise((resolve) => {
    let frameCount = 0
    const startedAt = performance.now()
    const tick = (now) => {
      frameCount += 1
      if (now - startedAt >= ${durationMs}) {
        resolve({ frameCount, elapsedMs: now - startedAt })
        return
      }
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })`) as FrameProbeScriptResult
  return {
    ...result,
    meanFps: result.elapsedMs > 0 ? (result.frameCount / result.elapsedMs) * 1000 : 0,
  }
}

/**
 * Run the combined main-thread probe: event-loop drift, then renderer frame
 * rate. Waits for the page load before starting so the renderer can paint.
 * @param window - the main window.
 * @param intervalMs - nominal drift tick interval.
 * @param durationMs - probe window length for both measurements.
 * @returns the combined results.
 */
export async function runPerfProbe(
  window: BrowserWindow,
  intervalMs = 16,
  durationMs = 3000,
): Promise<PerfProbeResult> {
  if (window.webContents.isLoading()) {
    await new Promise<void>((resolve) => {
      window.webContents.once('did-finish-load', () => resolve())
    })
  }
  const deltas = await measureEventLoopDrift({
    intervalMs,
    durationMs,
    schedule: (callback, delayMs) => setTimeout(callback, delayMs),
    cancel: handle => clearTimeout(handle as NodeJS.Timeout),
    now: () => performance.now(),
  })
  const fps = await measureRendererFps(window, durationMs)
  return { eventLoopMs: summarizeDrift(deltas), fps }
}
