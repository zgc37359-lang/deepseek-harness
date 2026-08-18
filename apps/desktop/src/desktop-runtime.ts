/**
 * Attachment seam for the in-process Harness host (next milestone). The main
 * process keeps this seam stable so the renderer bridge does not change when
 * the runtime is mounted or unmounted.
 * @module @deepseek-ai/dsh-desktop/desktop-runtime
 */

import type { WebContents } from 'electron'
import { IPC } from './shared/ipc.ts'

/** The in-process host the renderer bridge routes to. */
export interface DesktopRuntimeHost {
  /** Route one raw client envelope (JSON body) and return the wire response. */
  unary(method: string, body: string): Promise<{ status: number; body: string }>
  /** The composed client boot graph, or null while no UI host is attached. */
  getBootManifest(): unknown
  /** The client bundle bytes for one graph row id. */
  getBundle(id: string): Promise<Buffer>
  /** Subscribe to both downlink streams; each disposer ends that subscription. */
  onFrame(listener: (stream: 'mux' | 'host', envelope: unknown) => void): () => void
  onEnd(listener: (stream: 'mux' | 'host') => void): () => void
}

interface RuntimeSubscription {
  webContents: WebContents
  stream: 'mux' | 'host'
  active: boolean
}

let host: DesktopRuntimeHost | null = null
let offFrame: (() => void) | undefined
let offEnd: (() => void) | undefined
const subscriptions = new Set<RuntimeSubscription>()

/** Attach the in-process Harness host and fan its downlinks out over IPC. */
export function attachDesktopRuntime(next: DesktopRuntimeHost): void {
  detachDesktopRuntime()
  host = next
  offFrame = next.onFrame((stream, envelope) => {
    for (const subscription of subscriptions) {
      if (subscription.active && subscription.stream === stream) {
        subscription.webContents.send(IPC.runtimeEvent, stream, envelope)
      }
    }
  })
  offEnd = next.onEnd((stream) => {
    for (const subscription of subscriptions) {
      if (subscription.active && subscription.stream === stream) {
        subscription.webContents.send(IPC.runtimeEventEnd, stream)
      }
    }
  })
}

/** Detach the current host; pending subscriptions keep waiting for the next one. */
export function detachDesktopRuntime(): void {
  offFrame?.()
  offEnd?.()
  offFrame = undefined
  offEnd = undefined
  host = null
}

/** Register one renderer's downlink subscription; the disposer removes it. */
export function registerRuntimeSubscription(
  webContents: WebContents,
  stream: 'mux' | 'host',
): () => void {
  const subscription: RuntimeSubscription = { webContents, stream, active: true }
  subscriptions.add(subscription)
  return () => {
    subscription.active = false
    subscriptions.delete(subscription)
  }
}

/** Route a unary envelope to the attached host, or answer service-unavailable. */
export async function runtimeUnary(method: string, body: string): Promise<{ status: number; body: string }> {
  if (host === null) {
    return {
      status: 503,
      body: JSON.stringify({
        type: 'server-response',
        rpcId: '',
        result: {
          ok: false,
          error: { code: 'service-unavailable', message: 'desktop runtime not attached', details: {} },
        },
      }),
    }
  }
  return host.unary(method, body)
}

/** The composed client boot graph, or null while no UI host is attached. */
export function runtimeBootManifest(): unknown {
  return host?.getBootManifest() ?? null
}

/** Fetch one client bundle through the attached host. */
export async function runtimeBundle(id: string): Promise<Buffer> {
  if (host === null) throw new Error('desktop runtime not attached')
  return host.getBundle(id)
}
