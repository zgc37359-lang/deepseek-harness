/**
 * Tray "new session" activation. The sidebar button performs the full
 * create-and-open flow the user expects, so it is tried first; the RPC lane
 * is the fallback when the Web UI is not yet mounted.
 * @module @deepseek-ai/dsh-desktop/tray-actions
 */

/** The two lanes a tray new-session activation can use. */
export interface TraySessionDeps {
  /**
   * Run the sidebar new-session flow; resolves true only when a session was
   * actually created (a click without a selected workspace creates nothing).
   */
  clickNewSession(): Promise<boolean>
  /** Create a session through the runtime RPC lane. */
  rpcCreateSession(): Promise<unknown>
}

/**
 * Activate a new session from the tray, preferring the sidebar flow.
 * @param deps - the activation lanes.
 * @returns whether a session was created through either lane.
 */
export async function activateNewSession(deps: TraySessionDeps): Promise<boolean> {
  try {
    if (await deps.clickNewSession()) return true
  } catch {
    // A throwing click is the same as an unavailable one: fall through.
  }
  try {
    await deps.rpcCreateSession()
    return true
  } catch {
    return false
  }
}
