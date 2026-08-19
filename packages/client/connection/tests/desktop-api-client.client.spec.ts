/**
 * Desktop carrier contract: unary envelopes ride the bridge verbatim, event
 * streams replay bridge pushes through the same ServerRequest parse path as
 * the WebSocket carrier, and caller cancellation ends the subscription.
 */
import { describe, expect, it } from 'vitest'
import type { HostFrame, SessionId } from '../src/client/api.ts'
import { RpcId } from '../src/client/api.ts'
import {
  createDesktopConnectionRpc,
  DesktopApiClient,
  type DesktopRuntimeBridge,
} from '../src/client/desktop-api-client.ts'

const sid = (id: string): SessionId => id as SessionId

interface FakeSubscription {
  stream: 'mux' | 'host'
  onFrame(envelope: unknown): void
  onEnd(): void
  active: boolean
}

class FakeBridge implements DesktopRuntimeBridge {
  readonly calls: { method: string; body: unknown }[] = []
  readonly subscriptions: FakeSubscription[] = []
  unaryHandler: (method: string, body: unknown) => Promise<{ status: number; body: string }> =
    async () => ({ status: 503, body: '{}' })

  unary(method: string, body: string): Promise<{ status: number; body: string }> {
    const parsed = JSON.parse(body) as unknown
    this.calls.push({ method, body: parsed })
    return this.unaryHandler(method, parsed)
  }

  subscribe(
    stream: 'mux' | 'host',
    onFrame: (envelope: unknown) => void,
    onEnd: () => void,
  ): () => void {
    const subscription: FakeSubscription = { stream, onFrame, onEnd, active: true }
    this.subscriptions.push(subscription)
    return () => {
      subscription.active = false
    }
  }

  feed(stream: 'mux' | 'host', envelope: unknown): void {
    for (const subscription of this.subscriptions) {
      if (subscription.stream === stream && subscription.active) subscription.onFrame(envelope)
    }
  }
}

function serverResponse(rpcId: string, result: unknown): string {
  return JSON.stringify({ type: 'server-response', rpcId, result })
}

async function collectFrames(
  stream: AsyncIterable<{ rpcId: unknown; payload: unknown }>,
  abort: AbortController,
): Promise<{ rpcId: unknown; payload: unknown }[]> {
  const frames: { rpcId: unknown; payload: unknown }[] = []
  for await (const envelope of stream) {
    frames.push(envelope)
    if (frames.length >= 1) abort.abort()
  }
  return frames
}

describe('DesktopApiClient', () => {
  it('routes session.list through the bridge and parses the echoed server response', async () => {
    const bridge = new FakeBridge()
    bridge.unaryHandler = async (_method, body) => {
      const request = body as { rpcId: string }
      return { status: 200, body: serverResponse(request.rpcId, { ok: true, value: { items: [] } }) }
    }
    const api = new DesktopApiClient(bridge)
    const response = await api.sessions.list({})
    expect(bridge.calls[0]?.method).toBe('session.list')
    expect(response.result).toEqual({ ok: true, value: { items: [] } })
    expect(response.rpcId).toBe((bridge.calls[0]?.body as { rpcId: string }).rpcId)
  })

  it('preserves an error result envelope without parsing its value', async () => {
    const bridge = new FakeBridge()
    bridge.unaryHandler = async (_method, body) => {
      const request = body as { rpcId: string }
      return {
        status: 200,
        body: serverResponse(request.rpcId, {
          ok: false,
          error: { code: 'bad-request', message: 'boom', details: { issues: [] } },
        }),
      }
    }
    const api = new DesktopApiClient(bridge)
    const response = await api.sessions.list({})
    expect(response.result.ok).toBe(false)
    if (!response.result.ok) expect(response.result.error.code).toBe('bad-request')
  })

  it('replays host-stream frames from bridge pushes and unsubscribes on abort', async () => {
    const bridge = new FakeBridge()
    const api = new DesktopApiClient(bridge)
    const abort = new AbortController()
    let opened = 0
    const frames = collectFrames(api.events.host({}, abort.signal, () => { opened += 1 }), abort)
    await Promise.resolve()
    const envelope = {
      type: 'server-request',
      rpcId: RpcId('r-1'),
      method: 'events.host',
      payload: { type: 'host/session-status', sessionId: sid('s-1'), running: true } satisfies HostFrame,
    }
    bridge.feed('host', envelope)
    const collected = await frames
    expect(opened).toBe(1)
    expect(collected).toEqual([{ rpcId: envelope.rpcId, payload: envelope.payload }])
    expect(bridge.subscriptions[0]?.active).toBe(false)
  })

  it('ends the stream when the bridge signals stream end', async () => {
    const bridge = new FakeBridge()
    const api = new DesktopApiClient(bridge)
    const abort = new AbortController()
    const frames = collectFrames(api.events.host({}, abort.signal), abort)
    await Promise.resolve()
    bridge.subscriptions[0]?.onEnd()
    expect(await frames).toEqual([])
  })
})

describe('createDesktopConnectionRpc', () => {
  it('routes generic /api channel calls through the bridge with endpoint envelopes', async () => {
    const bridge = new FakeBridge()
    bridge.unaryHandler = async (_method, body) => {
      const request = body as { rpcId: string }
      return { status: 200, body: serverResponse(request.rpcId, { ok: true }) }
    }
    const rpc = createDesktopConnectionRpc(bridge)
    const result = await rpc.call('/api', 'dynamicCordisRunner/inventory', { args: [] })
    expect(bridge.calls[0]?.method).toBe('dynamicCordisRunner/inventory')
    expect((bridge.calls[0]?.body as { type: string }).type).toBe('client-request')
    expect(result).toEqual({ ok: true })
  })

  it('reports a non-200 bridge status as a transport failure', async () => {
    const bridge = new FakeBridge()
    bridge.unaryHandler = async () => ({ status: 404, body: '{}' })
    const rpc = createDesktopConnectionRpc(bridge)
    await expect(rpc.call('/api', 'dynamicCordisRunner/inventory', { args: [] }))
      .rejects.toThrow('transport failure for /api/dynamicCordisRunner/inventory: HTTP 404')
  })

  it('rejects a mismatched rpcId envelope', async () => {
    const bridge = new FakeBridge()
    bridge.unaryHandler = async () => ({ status: 200, body: serverResponse('other', { ok: true }) })
    const rpc = createDesktopConnectionRpc(bridge)
    await expect(rpc.call('/api', 'dynamicCordisRunner/inventory', { args: [] }))
      .rejects.toThrow(/rpcId mismatch/)
  })
})
