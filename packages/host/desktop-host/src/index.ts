/**
 * In-process desktop host: provides `ctx.desktopHost` over the transport-free
 * gateway, so the Electron main process can serve the client protocol without
 * an HTTP server. Unary/respond reuse `toFetchHandler`; both downlink streams
 * come straight from `apiProxy.events`; the boot manifest is the
 * `clientModules` graph with bundle URLs rewritten to the `dsh-bundle`
 * protocol. The exported stub web server satisfies the modules node half's
 * `webServer` inject without ever listening.
 * @module @deepseek-ai/dsh-desktop-host
 */

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Context, Service } from '@deepseek-ai/cordis'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import type {
  HostFrame,
  MuxFrame,
  RpcRequest,
  ServerRequest,
} from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import type { ClientModuleRegistry, WebBootGraph } from '@deepseek-ai/dsh-client-modules'
import { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { rewriteManifestUrls } from './manifest.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** In-process desktop host face consumed by the Electron main process. */
    desktopHost: DesktopHostService
  }
}

/** The service face the Electron launcher adapts to its runtime bridge. */
export interface DesktopHostService {
  /** Route one raw client envelope (JSON body) and return the wire response. */
  unary(method: string, body: string): Promise<{ status: number; body: string }>
  /** The composed client boot graph with `dsh-bundle://bundle` URLs. */
  manifest(): WebBootGraph
  /** The client bundle bytes for one graph row id. */
  bundle(id: string): Promise<Buffer>
  /** Subscribe to both downlink streams; each disposer ends that subscription. */
  onFrame(listener: (stream: 'mux' | 'host', envelope: unknown) => void): () => void
  onEnd(listener: (stream: 'mux' | 'host') => void): () => void
}

/** WebServer subtype that never listens; route registrations stay inert in memory. */
export class DesktopWebServerStub extends WebServer {
  constructor(ctx: Context) {
    super(ctx, { host: '127.0.0.1', port: 0 })
  }

  override async [Service.init](): Promise<void> {
    // The desktop host serves no HTTP; the stub only satisfies the
    // client-modules node half's webServer inject.
  }
}

/** In-process host implementation over the transport-free gateway. */
export class DesktopHost extends Service implements DesktopHostService {
  static inject = ['apiProxy', 'clientModules', 'connection']

  private readonly modules: ClientModuleRegistry
  private readonly sharedFetch: { fetch: (request: Request) => Promise<Response> }
  private readonly abort = new AbortController()
  private readonly frameListeners = new Set<(stream: 'mux' | 'host', envelope: unknown) => void>()
  private readonly endListeners = new Set<(stream: 'mux' | 'host') => void>()

  constructor(ctx: Context) {
    super(ctx, 'desktopHost')
    const api = ctx.get('apiProxy')
    const modules = ctx.get('clientModules')
    const connection = ctx.get('connection') as unknown as HostConnectionService | undefined
    if (api === undefined || modules === undefined || connection === undefined) {
      throw new Error('desktop-host: apiProxy, clientModules, and connection services are required')
    }
    this.modules = modules
    // The web transport serves Remote endpoints (commands, goals, plugin
    // inventory, cordis runner, message feedback) through the shared /api
    // RPC chain, whose Typert gateway interceptor claims those endpoints
    // before the unary fallback. The desktop bridge must ride the same chain
    // or every Remote click 404s.
    this.sharedFetch = connection.createSharedFetchHandler('/api', {
      fetch: request => toFetchHandler(api).fetch(request),
    })
    ctx.effect(() => () => { this.abort.abort() }, 'desktop-host: event pumps')
    void this.pump('mux', api.events.mux({ rpcId: RpcId(randomUUID()), payload: {} }, this.abort.signal))
    void this.pump('host', api.events.host({ rpcId: RpcId(randomUUID()), payload: {} }, this.abort.signal))
  }

  async unary(method: string, body: string): Promise<{ status: number; body: string }> {
    // Loopback authority: the desktop bridge is IPC-local, and the shared
    // RPC chain's trust fence treats loopback requests as trusted.
    const request = new Request(`http://127.0.0.1/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    const response = await this.sharedFetch.fetch(request)
    return { status: response.status, body: await response.text() }
  }

  manifest(): WebBootGraph {
    return rewriteManifestUrls(this.modules.graph(), 'dsh-bundle://bundle')
  }

  async bundle(id: string): Promise<Buffer> {
    const path = this.modules.clientPath(id)
    if (path === undefined) {
      throw new Error(`desktop-host: unknown client bundle ${JSON.stringify(id)}`)
    }
    return readFile(path)
  }

  onFrame(listener: (stream: 'mux' | 'host', envelope: unknown) => void): () => void {
    this.frameListeners.add(listener)
    return () => {
      this.frameListeners.delete(listener)
    }
  }

  onEnd(listener: (stream: 'mux' | 'host') => void): () => void {
    this.endListeners.add(listener)
    return () => {
      this.endListeners.delete(listener)
    }
  }

  private async pump<F extends MuxFrame | HostFrame>(
    stream: 'mux' | 'host',
    frames: AsyncIterable<RpcRequest<F>>,
  ): Promise<void> {
    try {
      for await (const request of frames) {
        const envelope: ServerRequest = {
          type: 'server-request',
          rpcId: request.rpcId,
          method: request.payload.type,
          payload: request.payload,
        }
        for (const listener of [...this.frameListeners]) {
          try {
            listener(stream, envelope)
          } catch {
            // A broken consumer must not kill the pump.
          }
        }
      }
    } finally {
      for (const listener of [...this.endListeners]) {
        try {
          listener(stream)
        } catch {
          // Same containment as the frame path.
        }
      }
    }
  }
}

export default DesktopHost
