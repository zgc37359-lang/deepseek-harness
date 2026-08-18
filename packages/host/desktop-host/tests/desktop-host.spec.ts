import { describe, expect, it } from 'vitest'
import type { ApiProxy } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import { DesktopHost } from '../src/index.ts'

/** A fake Context carrying only the services DesktopHost reads. */
function fakeContext(api: ApiProxy, modules: unknown, connection: unknown): unknown {
  return {
    get: (key: string): unknown => {
      switch (key) {
        case 'apiProxy': return api
        case 'clientModules': return modules
        case 'connection': return connection
        default: return undefined
      }
    },
    effect: (): (() => void) => () => {},
    reflect: { provide: (): void => {} },
  }
}

/** Empty async iterable with the expected abort wiring. */
async function* emptyStream(_payload: unknown, _signal: AbortSignal): AsyncIterable<never> {
  /* no frames */
}

function fakeApiProxy(): ApiProxy {
  return {
    events: {
      mux: (_payload: unknown, signal: AbortSignal) => emptyStream(_payload, signal),
      host: (_payload: unknown, signal: AbortSignal) => emptyStream(_payload, signal),
    },
    sessions: {
      list: async () => ({ rpcId: RpcId('rpc-fallback'), result: { ok: true, value: { sessions: [] } } }),
    },
  } as unknown as ApiProxy
}

const fakeModules = {
  graph: () => ({ rev: 'r1', entries: [] }),
  clientPath: () => undefined,
}

describe('DesktopHost.unary', () => {
  it('routes Remote endpoints through the shared connection fetch handler', async () => {
    const connection = {
      createSharedFetchHandler: (_channel: '/api', fallback: { fetch: (request: Request) => Promise<Response> }) => ({
        fetch: async (request: Request): Promise<Response> => {
          if (request.url.includes('/commands/list')) {
            return Response.json({
              type: 'server-response',
              rpcId: 'rpc-remote',
              result: { ok: true, value: { commands: [] } },
            })
          }
          return fallback.fetch(request)
        },
      }),
    } as unknown as HostConnectionHandle
    const host = new DesktopHost(fakeContext(fakeApiProxy(), fakeModules, connection) as never)
    const envelope = JSON.stringify({
      type: 'client-request',
      rpcId: 'rpc-remote',
      method: 'commands/list',
      payload: { args: {} },
    })

    const response = await host.unary('commands/list', envelope)

    expect(response.status).toBe(200)
    const body = JSON.parse(response.body) as { result: { ok: boolean; value: { commands: unknown[] } } }
    expect(body.result.ok).toBe(true)
    expect(body.result.value.commands).toEqual([])
  })

  it('falls back to the unary handler for ordinary API methods', async () => {
    const connection = {
      createSharedFetchHandler: (_channel: '/api', fallback: { fetch: (request: Request) => Promise<Response> }) => ({
        fetch: (request: Request): Promise<Response> => fallback.fetch(request),
      }),
    } as unknown as HostConnectionHandle
    const host = new DesktopHost(fakeContext(fakeApiProxy(), fakeModules, connection) as never)
    const envelope = JSON.stringify({
      type: 'client-request',
      rpcId: 'rpc-fallback',
      method: 'session.list',
      payload: {},
    })

    const response = await host.unary('session.list', envelope)

    expect(response.status).toBe(200)
    const body = JSON.parse(response.body) as { result: { ok: boolean; value: { sessions: unknown[] } } }
    expect(body.result.ok).toBe(true)
  })
})
