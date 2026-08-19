import { afterEach, describe, expect, it, vi } from 'vitest'
import { pollForManifest } from '../src/renderer/manifest-poller.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('pollForManifest', () => {
  it('calls onReady with the first non-null manifest', async () => {
    vi.useFakeTimers()
    const get = vi.fn().mockResolvedValue({ entries: [] })
    const onReady = vi.fn()
    pollForManifest(get, onReady)
    await vi.advanceTimersByTimeAsync(0)
    expect(onReady).toHaveBeenCalledWith({ entries: [] })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('keeps retrying with backoff while the manifest is null', async () => {
    vi.useFakeTimers()
    const get = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ rev: 1 })
    const onReady = vi.fn()
    pollForManifest(get, onReady, { initialMs: 500, maxMs: 2000 })
    await vi.advanceTimersByTimeAsync(0)
    expect(get).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(500)
    expect(get).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    expect(get).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(2000)
    expect(get).toHaveBeenCalledTimes(4)
    expect(onReady).toHaveBeenCalledWith({ rev: 1 })
  })

  it('caps the backoff at maxMs and never gives up', async () => {
    vi.useFakeTimers()
    const get = vi.fn().mockResolvedValue(null)
    const onReady = vi.fn()
    pollForManifest(get, onReady, { initialMs: 500, maxMs: 2000 })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(2000)
    const callsAfterBackoff = get.mock.calls.length
    await vi.advanceTimersByTimeAsync(2000)
    expect(get.mock.calls.length).toBe(callsAfterBackoff + 1)
    expect(onReady).not.toHaveBeenCalled()
  })

  it('stops polling when the signal aborts', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const get = vi.fn().mockResolvedValue(null)
    pollForManifest(get, vi.fn(), { signal: controller.signal })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(500)
    controller.abort()
    const calls = get.mock.calls.length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(get.mock.calls.length).toBe(calls)
  })
})
