import { describe, expect, it, vi } from 'vitest'
import { measureEventLoopDrift, summarizeDrift } from '../src/perf-test.ts'

describe('summarizeDrift', () => {
  it('computes mean, p95 (nearest rank), and max', () => {
    const deltas = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

    const summary = summarizeDrift(deltas)

    expect(summary.meanMs).toBe(5.5)
    expect(summary.p95Ms).toBe(10)
    expect(summary.maxMs).toBe(10)
  })

  it('returns zero summaries for an empty sample', () => {
    expect(summarizeDrift([])).toEqual({ meanMs: 0, p95Ms: 0, maxMs: 0 })
  })
})

describe('measureEventLoopDrift', () => {
  it('collects the actual interval deltas until the duration elapses', async () => {
    const callbacks: Array<() => void> = []
    const cancel = vi.fn()
    let current = 0
    let handle = 0
    const promise = measureEventLoopDrift({
      intervalMs: 10,
      durationMs: 30,
      schedule: (callback) => {
        callbacks.push(callback)
        handle += 1
        return handle
      },
      cancel,
      now: () => current,
    })

    current = 10
    callbacks[0]?.()
    current = 25
    callbacks[1]?.()
    current = 37
    callbacks[2]?.()

    await expect(promise).resolves.toEqual([10, 15, 12])
    expect(cancel).toHaveBeenCalledOnce()
  })
})
