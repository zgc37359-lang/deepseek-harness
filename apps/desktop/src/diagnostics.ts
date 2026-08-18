/**
 * Local-only diagnostics export: copies the main-process log, local
 * Crashpad dumps (when present), and a versions snapshot into a
 * timestamped folder chosen by the user. No network upload.
 * @module @deepseek-ai/dsh-desktop/diagnostics
 */

import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppInfo } from './shared/ipc.ts'

/**
 * Write one diagnostics bundle under `root`.
 * @param root - the user-chosen destination directory.
 * @param logFile - the main-process log path.
 * @param info - version and environment snapshot.
 * @param crashDumpsDir - the Crashpad dump directory; copied when non-empty.
 * @returns the created bundle directory.
 */
export async function collectDiagnostics(
  root: string,
  logFile: string,
  info: AppInfo,
  crashDumpsDir?: string,
): Promise<string> {
  const dir = join(root, `dsh-diagnostics-${Date.now()}`)
  await mkdir(dir, { recursive: true })
  await copyFile(logFile, join(dir, 'main.log'))
  if (crashDumpsDir !== undefined) {
    try {
      const dumps = await readdir(crashDumpsDir)
      if (dumps.length > 0) {
        const dumpDir = join(dir, 'crash-dumps')
        await mkdir(dumpDir, { recursive: true })
        for (const name of dumps) {
          await copyFile(join(crashDumpsDir, name), join(dumpDir, name))
        }
      }
    } catch {
      // A missing or unreadable dump directory is not a diagnostics failure.
    }
  }
  await writeFile(join(dir, 'versions.json'), `${JSON.stringify(info, null, 2)}\n`)
  return dir
}
