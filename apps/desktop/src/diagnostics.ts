/**
 * Local-only diagnostics export: copies the main-process log and a versions
 * snapshot into a timestamped folder chosen by the user. No network upload.
 * @module @deepseek-ai/dsh-desktop/diagnostics
 */

import { copyFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppInfo } from './shared/ipc.ts'

/**
 * Write one diagnostics bundle under `root`.
 * @param root - the user-chosen destination directory.
 * @param logFile - the main-process log path.
 * @param info - version and environment snapshot.
 * @returns the created bundle directory.
 */
export async function collectDiagnostics(root: string, logFile: string, info: AppInfo): Promise<string> {
  const dir = join(root, `dsh-diagnostics-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  await copyFile(logFile, join(dir, 'main.log'))
  await writeFile(join(dir, 'versions.json'), `${JSON.stringify(info, null, 2)}\n`)
  return dir
}
