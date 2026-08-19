/**
 * Desktop IPC carrier: the same protocol invariants as the fetch/WebSocket
 * carriers, with unary/respond routed through the Electron preload bridge and
 * both downlink event streams pushed over IPC events. The host side of the
 * bridge lives in apps/desktop; this package defines only the browser-safe
 * transport face.
 * @module @deepseek-ai/dsh-client-connection/client/desktop-api-client
 */

import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from './api.ts'
import { AbstractApiClient } from './api.ts'
import type { ClientConnectionRpc } from '../rpc.ts'
import { hostFrameSchema, muxFrameSchema } from '@deepseek-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@deepseek-ai/dsh-host-apiproxy/api/rpc.schema'
import { RpcId, serverResponseSchema } from '@deepseek-ai/dsh-host-apiproxy/api'
import { randomUuid } from './random-uuid.ts'

/** Browser-safe bridge the Electron preload exposes (structural, no app import). */
export interface DesktopRuntimeBridge {
  /** Route one raw client envelope (JSON body) to the desktop host. */
  unary(method: string, body: string): Promise<{ status: number; body: string }>
  /** Subscribe to one downlink stream; the disposer ends the subscription. */
  subscribe(
    stream: 'mux' | 'host',
    onFrame: (envelope: unknown) => void,
    onEnd: () => void,
  ): () => void
}

/**
 * Desktop generic-RPC caller: the same envelope contract as the browser
 * caller, routed through the preload bridge instead of fetch. The host
 * prefixes every method with `/api/`, so a channel of `/api` maps directly
 * to the endpoint.
 * @param bridge - the Electron preload runtime bridge.
 * @returns the generic connection RPC caller.
 */
export function createDesktopConnectionRpc(bridge: DesktopRuntimeBridge): ClientConnectionRpc {
  return {
    async call(channel, endpoint, payload) {
      // The host unary face prefixes every method with /api/, and the browser
      // caller reaches generic channels at /api/<endpoint>; other channel
      // names keep their path under the same prefix.
      const method = channel === '/api' ? endpoint : `${channel.replace(/^\/+/, '')}/${endpoint}`
      const rpcId = RpcId(randomUuid())
      const message = {
        type: 'client-request',
        rpcId,
        method: endpoint,
        payload,
      }
      const { status, body } = await bridge.unary(method, JSON.stringify(message))
      if (status !== 200) {
        throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${status}`)
      }
      const full = serverResponseSchema.parse(JSON.parse(body))
      if (full.rpcId !== rpcId) {
        throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${full.rpcId}`)
      }
      return full.result
    },
  }
}

type StreamItem<F> = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' }
type Parser<F> = { parse(value: unknown): F }

/** Reject when the caller aborts, swallowing the bridge's late settlement. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void promise.catch(() => undefined)
    return Promise.reject(abortError(signal))
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(abortError(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError')
}

/**
 * Desktop platform subclass: unary/respond go through the preload bridge;
 * mux/host are IPC-pushed downlinks modeled after the WebSocket carrier.
 */
export class DesktopApiClient extends AbstractApiClient {
  constructor(private readonly bridge: DesktopRuntimeBridge, timeoutMs?: number) {
    super(timeoutMs)
  }

  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    const signal = init?.signal ?? undefined
    if (signal !== undefined && signal.aborted) return Promise.reject(abortError(signal))
    if (init?.method !== 'POST') {
      return Promise.reject(new Error(`desktop carrier: unexpected ${init?.method ?? 'GET'} ${input.pathname}`))
    }
    if (typeof init.body !== 'string') {
      return Promise.reject(new Error('desktop carrier: POST body must be a JSON string'))
    }
    const method = input.pathname.startsWith('/api/respond')
      ? 'respond'
      : input.pathname.startsWith('/api/')
        ? input.pathname.slice('/api/'.length)
        : input.pathname
    const request = this.bridge.unary(method, init.body)
    const settled = signal === undefined ? request : raceAbort(request, signal)
    return settled.then(({ status, body }) =>
      new Response(body, { status, headers: { 'content-type': 'application/json' } }))
  }

  protected override openMux(
    _payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    return this.readIpcStream('mux', signal, muxFrameSchema, onOpen)
  }

  protected override openHost(
    _payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    return this.readIpcStream('host', signal, hostFrameSchema, onOpen)
  }

  private async *readIpcStream<F extends MuxFrame | HostFrame>(
    stream: 'mux' | 'host',
    signal: AbortSignal,
    frameSchema: Parser<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const inbox: StreamItem<F>[] = []
    let wake: (() => void) | undefined
    const enqueue = (item: StreamItem<F>): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const onFrame = (raw: unknown): void => {
      let full: ServerRequest
      let frame: F
      try {
        full = serverRequestSchema.parse(raw)
        frame = frameSchema.parse(full.payload)
      } catch (error) {
        console.error(`[client-connection] dropping malformed IPC frame on ${stream}:`, error)
        return
      }
      this.onEnvelope(full)
      enqueue({ kind: 'frame', envelope: { rpcId: full.rpcId, payload: frame } })
    }
    const onEnd = (): void => { enqueue({ kind: 'end' }) }
    const onAbort = (): void => { enqueue({ kind: 'end' }) }
    const unsubscribe = this.bridge.subscribe(stream, onFrame, onEnd)
    signal.addEventListener('abort', onAbort, { once: true })
    onOpen?.()
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift()
          if (item === undefined) continue
          if (item.kind === 'end') return
          yield item.envelope
        }
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    } finally {
      signal.removeEventListener('abort', onAbort)
      unsubscribe()
    }
  }
}
