import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import {
  attachDesktopRuntime,
  detachDesktopRuntime,
  registerRuntimeSubscription,
  runtimeBootManifest,
  runtimeBundle,
  runtimeUnary,
  type DesktopRuntimeHost,
} from '../src/desktop-runtime.ts'

/** Minimal WebContents double: send captures pushes, once captures disposal. */
function fakeWebContents() {
  const sent: unknown[][] = []
  const onceHandlers = new Map<string, () => void>()
  return {
    webContents: {
      send: (...args: unknown[]) => { sent.push(args) },
      once: (event: string, handler: () => void) => { onceHandlers.set(event, handler) },
    } as unknown as WebContents,
    sent,
    onceHandlers,
  }
}

/** A host double whose frame/end listeners are recorded for firing. */
function fakeHost() {
  let frameListener: ((stream: 'mux' | 'host', envelope: unknown) => void) | undefined
  let endListener: ((stream: 'mux' | 'host') => void) | undefined
  const unary = vi.fn(async () => ({ status: 200, body: '{}' }))
  const getBootManifest = (): { rev: number; entries: unknown[] } => ({ rev: 1, entries: [] })
  const getBundle = vi.fn(async (id: string) => Buffer.from('bundle:' + id))
  const onFrame = vi.fn((listener: (stream: 'mux' | 'host', envelope: unknown) => void) => {
    frameListener = listener
    return () => { frameListener = undefined }
  })
  const onEnd = vi.fn((listener: (stream: 'mux' | 'host') => void) => {
    endListener = listener
    return () => { endListener = undefined }
  })
  const host: DesktopRuntimeHost = { unary, getBootManifest, getBundle, onFrame, onEnd }
  return {
    host,
    unary,
    getBundle,
    onFrame,
    fireFrame: (stream: 'mux' | 'host', envelope: unknown) => { frameListener?.(stream, envelope) },
    fireEnd: (stream: 'mux' | 'host') => { endListener?.(stream) },
  }
}

describe('desktop-runtime', () => {
  afterEach(() => {
    detachDesktopRuntime()
  })

  it('routes unary to the attached host and answers 503 without one', async () => {
    const { host, unary } = fakeHost()
    const unavailable = await runtimeUnary('session.list', '{}')
    expect(unavailable.status).toBe(503)

    attachDesktopRuntime(host)
    const result = await runtimeUnary('session.list', '{}')
    expect(result).toEqual({ status: 200, body: '{}' })
    expect(unary).toHaveBeenCalledWith('session.list', '{}')
  })

  it('serves the boot manifest and bundles from the attached host', async () => {
    const { host } = fakeHost()
    expect(runtimeBootManifest()).toBeNull()

    attachDesktopRuntime(host)
    expect(runtimeBootManifest()).toEqual({ rev: 1, entries: [] })
    await expect(runtimeBundle('core')).resolves.toEqual(Buffer.from('bundle:core'))
  })

  it('rejects bundles while no host is attached', async () => {
    await expect(runtimeBundle('core')).rejects.toThrow('desktop runtime not attached')
  })

  it('fans downlink frames only to matching subscriptions', async () => {
    const { host, fireFrame } = fakeHost()
    attachDesktopRuntime(host)

    const muxSub = fakeWebContents()
    const hostSub = fakeWebContents()
    registerRuntimeSubscription(muxSub.webContents, 'mux')
    registerRuntimeSubscription(hostSub.webContents, 'host')

    fireFrame('mux', { type: 'server-request', rpcId: '1' })
    expect(muxSub.sent).toHaveLength(1)
    expect(hostSub.sent).toHaveLength(0)

    fireFrame('host', { type: 'server-request', rpcId: '2' })
    expect(muxSub.sent).toHaveLength(1)
    expect(hostSub.sent).toHaveLength(1)
    expect(hostSub.sent[0]).toEqual(['runtime:event', 'host', { type: 'server-request', rpcId: '2' }])
  })

  it('stops fanning to a disposed subscription', async () => {
    const { host, fireFrame } = fakeHost()
    attachDesktopRuntime(host)

    const sub = fakeWebContents()
    const dispose = registerRuntimeSubscription(sub.webContents, 'mux')
    dispose()

    fireFrame('mux', { type: 'server-request', rpcId: '1' })
    expect(sub.sent).toHaveLength(0)
  })

  it('notifies end listeners when a downlink stream closes', async () => {
    const { host, fireEnd } = fakeHost()
    attachDesktopRuntime(host)

    const sub = fakeWebContents()
    registerRuntimeSubscription(sub.webContents, 'host')
    fireEnd('host')
    expect(sub.sent).toEqual([['runtime:event-end', 'host']])
  })

  it('detaches cleanly and stops all fan-out', async () => {
    const { host, fireFrame, fireEnd } = fakeHost()
    attachDesktopRuntime(host)

    const sub = fakeWebContents()
    registerRuntimeSubscription(sub.webContents, 'mux')
    detachDesktopRuntime()

    fireFrame('mux', { type: 'server-request', rpcId: '1' })
    fireEnd('mux')
    expect(sub.sent).toHaveLength(0)
    await expect(runtimeUnary('session.list', '{}')).resolves.toMatchObject({ status: 503 })
  })

  it('survives re-attach after detach', async () => {
    const first = fakeHost()
    attachDesktopRuntime(first.host)
    detachDesktopRuntime()

    const second = fakeHost()
    attachDesktopRuntime(second.host)
    const sub = fakeWebContents()
    registerRuntimeSubscription(sub.webContents, 'mux')
    second.fireFrame('mux', { type: 'server-request', rpcId: '3' })
    expect(sub.sent).toHaveLength(1)
    expect(first.onFrame).toHaveBeenCalledTimes(1)
    expect(second.onFrame).toHaveBeenCalledTimes(1)
  })
})
