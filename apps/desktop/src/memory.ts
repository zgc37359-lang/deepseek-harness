/**
 * Main-process memory observability for the desktop shell.
 *
 * Electron hosts the Harness runtime in the main process and the full web UI
 * in the renderer, so a single RSS number cannot attribute memory pressure.
 * The sampler records the main-process V8/OS usage plus every Electron
 * process metric (main, renderer, GPU, utility) on a cadence and around
 * lifecycle events, keeps a bounded ring buffer, and hands the samples to
 * the diagnostics export.
 * @module @deepseek-ai/dsh-desktop/memory
 */

import { app } from 'electron'

const MIB = 1024 * 1024
const MAX_SAMPLES = 120

const roundMiB = (bytes: number): number => Math.round(bytes / MIB)
// app.getAppMetrics() reports workingSetSize/privateBytes in kilobytes.
const roundKibMiB = (kib: number): number => Math.round(kib / 1024)

/** One child-process metric from `app.getAppMetrics()`. */
export interface ProcessMemorySnapshot {
  pid: number
  type: string
  /** Resident set size in MiB; absent when the platform metric is unavailable. */
  workingSetMiB?: number
  /** Private bytes in MiB; absent when the platform metric is unavailable. */
  privateMiB?: number
}

/** The per-process memory field Electron reports (sizes in kilobytes). */
export interface ProcessMetricMemory {
  workingSetSize?: number
  privateBytes?: number
}

/** Main-process usage from `process.memoryUsage()`, normalized to MiB. */
export interface MainMemorySnapshot {
  rssMiB: number
  heapUsedMiB: number
  heapTotalMiB: number
  externalMiB: number
  arrayBuffersMiB: number
}

/** One timestamped memory snapshot over every Electron process. */
export interface MemorySample {
  at: string
  main: MainMemorySnapshot
  processes: ProcessMemorySnapshot[]
}

/**
 * Map one Electron process metric to the snapshot shape.
 * @param pid - the process id.
 * @param type - the Electron process type label.
 * @param memory - the process memory metric, when the platform provides it.
 * @returns the normalized snapshot (fields omitted when unavailable).
 */
export function processMemorySnapshot(
  pid: number,
  type: string,
  memory?: ProcessMetricMemory,
): ProcessMemorySnapshot {
  const snapshot: ProcessMemorySnapshot = { pid, type }
  if (memory !== undefined) {
    if (memory.workingSetSize !== undefined) snapshot.workingSetMiB = roundKibMiB(memory.workingSetSize)
    if (memory.privateBytes !== undefined) snapshot.privateMiB = roundKibMiB(memory.privateBytes)
  }
  return snapshot
}

/** Collect one memory snapshot from the running Electron app. */
export function collectMemorySample(): MemorySample {
  const usage = process.memoryUsage()
  const processes = app.getAppMetrics().map(metric =>
    processMemorySnapshot(metric.pid, metric.type, metric.memory))
  return {
    at: new Date().toISOString(),
    main: {
      rssMiB: roundMiB(usage.rss),
      heapUsedMiB: roundMiB(usage.heapUsed),
      heapTotalMiB: roundMiB(usage.heapTotal),
      externalMiB: roundMiB(usage.external),
      arrayBuffersMiB: roundMiB(usage.arrayBuffers ?? 0),
    },
    processes,
  }
}

/**
 * Periodic memory sampler with a bounded ring buffer.
 *
 * The cadence sample is logged by the caller; lifecycle-event callers use
 * {@link take} to force a snapshot outside the cadence.
 */
export class MemorySampler {
  private readonly samples: MemorySample[] = []
  private timer: NodeJS.Timeout | null = null

  /**
   * @param intervalMs - cadence between periodic samples.
   * @param onSample - sink for every collected sample (log line).
   */
  constructor(
    private readonly intervalMs: number,
    private readonly onSample: (sample: MemorySample) => void,
  ) {}

  /** Collect and retain one sample immediately (also used by the timer). */
  take(): MemorySample {
    const sample = collectMemorySample()
    this.samples.push(sample)
    if (this.samples.length > MAX_SAMPLES) this.samples.shift()
    this.onSample(sample)
    return sample
  }

  /** Begin periodic sampling; a no-op when already running. */
  start(): void {
    if (this.timer !== null) return
    this.timer = setInterval(() => this.take(), this.intervalMs)
  }

  /** Stop periodic sampling; the retained ring buffer stays available. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** A copy of the retained samples, oldest first. */
  snapshot(): readonly MemorySample[] {
    return [...this.samples]
  }
}
