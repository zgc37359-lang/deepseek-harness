/**
 * Boot-manifest poller for the desktop shell. The runtime attaches a moment
 * after the renderer mounts, so the shell polls until the manifest appears,
 * backing off between attempts, and never gives up on its own (the caller
 * aborts via signal on unmount).
 * @module @deepseek-ai/dsh-desktop/manifest-poller
 */

/** Polling policy for {@link pollForManifest}. */
export interface ManifestPollerOptions {
  /** Delay before the first retry. */
  initialMs?: number
  /** Backoff ceiling between retries. */
  maxMs?: number
  /** Abort the polling loop; the pending timer is cleared. */
  signal?: AbortSignal
}

/**
 * Poll for a non-null boot manifest, invoking onReady once found.
 * @param get - returns the current manifest (null while the runtime is detached).
 * @param onReady - called with the first non-null manifest.
 * @param options - polling policy.
 */
export function pollForManifest(
  get: () => Promise<unknown>,
  onReady: (manifest: unknown) => void,
  options?: ManifestPollerOptions,
): void {
  const initialMs = options?.initialMs ?? 500
  const maxMs = options?.maxMs ?? 2000
  const signal = options?.signal
  let delay = initialMs
  let timer: ReturnType<typeof setTimeout> | undefined
  const tick = async (): Promise<void> => {
    if (signal?.aborted) return
    let manifest: unknown
    try {
      manifest = await get()
    } catch {
      manifest = null
    }
    if (signal?.aborted) return
    if (manifest !== null && manifest !== undefined) {
      onReady(manifest)
      return
    }
    timer = setTimeout(() => { void tick() }, delay)
    delay = Math.min(maxMs, delay * 2)
  }
  void tick()
  if (signal !== undefined) {
    signal.addEventListener('abort', () => {
      if (timer !== undefined) clearTimeout(timer)
    }, { once: true })
  }
}
