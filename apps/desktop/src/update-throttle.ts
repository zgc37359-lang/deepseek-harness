/**
 * Automatic update-check throttling: a marker file's mtime records the last
 * automatic check so every launch does not hit the update feed (the Electron
 * performance guidance calls boot-time update checks a typical mistake).
 * Manual checks from the UI bypass this gate entirely.
 * @module @deepseek-ai/dsh-desktop/update-throttle
 */

import { stat, writeFile } from 'node:fs/promises'

/**
 * Whether an automatic update check is due: the marker is absent (first
 * launch) or its mtime is at least intervalMs old. Fail-open: an unreadable
 * marker counts as due so a broken marker never suppresses updates.
 * @param file - the marker file path.
 * @param intervalMs - the minimum delay between automatic checks.
 * @returns true when a check should run.
 */
export async function updateCheckDue(file: string, intervalMs: number): Promise<boolean> {
  try {
    const info = await stat(file)
    return Date.now() - info.mtimeMs >= intervalMs
  } catch {
    return true
  }
}

/**
 * Record that an automatic check just ran. Best-effort: an unwritable marker
 * only means the next launch checks again, which is safe.
 * @param file - the marker file path.
 */
export async function markUpdateChecked(file: string): Promise<void> {
  try {
    await writeFile(file, String(Date.now()), 'utf8')
  } catch {
    // Best-effort marker; never worth surfacing.
  }
}
