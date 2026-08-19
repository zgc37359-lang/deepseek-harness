/**
 * Renderer crash-recovery policy for the desktop shell: a bounded number of
 * automatic reloads, then a visible crash surface instead of a silent dead
 * window.
 * @module @deepseek-ai/dsh-desktop/crash-policy
 */

/** Reload budget before the shell switches to the visible crash overlay. */
export const MAX_RELOAD_AFTER_CRASH = 2

/** What the shell does after a renderer crash, by crash count. */
export type CrashAction = 'reload' | 'overlay'

/**
 * Decide the next recovery action from the renderer crash count.
 * @param crashCount - crashes observed since the window was created.
 * @returns 'reload' while the budget lasts, 'overlay' once it is spent.
 */
export function nextCrashAction(crashCount: number): CrashAction {
  return crashCount <= MAX_RELOAD_AFTER_CRASH ? 'reload' : 'overlay'
}

/**
 * Whether the shell reloads after this crash. The budget allows the two
 * auto-reloads plus ONE more reload that brings a live renderer back to
 * surface the crash overlay (a dead renderer cannot show anything).
 * @param crashCount - crashes observed since the window was created.
 */
export function shouldRecoverReload(crashCount: number): boolean {
  return crashCount <= MAX_RELOAD_AFTER_CRASH + 1
}

/**
 * Whether the shell is in the crash-overlay state (reload budget spent).
 * @param crashCount - crashes observed since the window was created.
 */
export function isCrashOverlayState(crashCount: number): boolean {
  return crashCount > MAX_RELOAD_AFTER_CRASH
}
