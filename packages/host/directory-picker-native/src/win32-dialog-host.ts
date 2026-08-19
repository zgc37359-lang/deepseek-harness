/**
 * Real-process half of the Win32 dialog driver: spawn the dialog child
 * process (source or built plane) and close a dialog thread's windows. The
 * module itself loads everywhere (the import chain from native-picker.ts is
 * static); what stays win32-only is koffi, imported dynamically inside the
 * bindings' functions. The driver's logic is tested against fakes of this
 * surface instead.
 */

import { spawn, type StdioOptions } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Win32DialogWorkerData } from './win32-dialog-worker.ts'

/** Electron-only process facts the shared host observes without importing Electron. */
interface ElectronProcessLike extends NodeJS.Process {
  resourcesPath?: string
}

const electronProcess = process as unknown as ElectronProcessLike

/** One packaged-Electron worker spawn: command, argv, and environment. */
export interface PackagedWorkerSpawn {
  readonly command: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
}

/**
 * The packaged-Electron worker spawn: the app executable in
 * `ELECTRON_RUN_AS_NODE` mode running the asar-unpacked CJS worker. Plain
 * Node cannot read `app.asar`, and launching the exe with a script path
 * re-runs the packaged app instead of the worker, so the worker must live in
 * a real filesystem location and the Electron binary must act as Node.
 * @param execPath - the packaged app executable.
 * @param workerPath - the worker script's real filesystem path.
 * @param title - dialog title carried to the worker.
 * @param baseEnv - the parent environment the child inherits.
 * @returns the spawn triple.
 */
export function packagedWorkerSpawn(
  execPath: string,
  workerPath: string,
  title: string,
  baseEnv: NodeJS.ProcessEnv,
): PackagedWorkerSpawn {
  return {
    command: execPath,
    args: [workerPath],
    env: {
      ...baseEnv,
      DSH_DIALOG_TITLE: title,
      ELECTRON_RUN_AS_NODE: '1',
    },
  }
}

/**
 * The packaged worker script path for a loaded module URL. An in-asar module
 * cannot hand its sibling to plain Node, so it maps to the unpacked copy;
 * an on-disk module (profiles fallback resolving into a dev tree) keeps its
 * real sibling.
 * @param moduleUrl - the loaded `win32-dialog-host` module URL.
 * @param resourcesPath - `process.resourcesPath` of the packaged app.
 * @returns the worker script path.
 */
export function packagedWorkerPath(moduleUrl: string, resourcesPath: string): string {
  return moduleUrl.includes('app.asar')
    ? join(
      resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      '@deepseek-ai',
      'dsh-host-directory-picker-native',
      'lib',
      'worker.cjs',
    )
    : fileURLToPath(new URL('./worker.cjs', moduleUrl))
}

/**
 * Spawn the dialog child process. Built consumers launch the bundled CJS
 * entry next to this module under plain node; unbuilt (source) consumers
 * bootstrap tsx first, mirroring the dsh CLI's source launch. The dialog is
 * the child's first window, so Windows activates it without a foreground
 * call.
 * @param data - the child payload (dialog title).
 * @returns the spawned child process.
 */
export function spawnDialogWorker(data: Win32DialogWorkerData): ReturnType<typeof spawn> {
  const env = { ...process.env, DSH_DIALOG_TITLE: data.title }
  const stdio: StdioOptions = ['ignore', 'inherit', 'inherit', 'ipc']
  // A packaged Electron main process (execPath is the app executable next to
  // resources/app.asar) cannot launch the worker as a plain script: the exe
  // would re-run the packaged app. Run the worker through the exe in
  // ELECTRON_RUN_AS_NODE mode instead, from a real filesystem path (unpacked
  // asar copy, or the dev-tree sibling when the profiles fallback resolves
  // into a checkout).
  if (process.versions.electron !== undefined
    && electronProcess.resourcesPath !== undefined
    && existsSync(join(dirname(process.execPath), 'resources', 'app.asar'))) {
    const workerPath = packagedWorkerPath(import.meta.url, electronProcess.resourcesPath)
    const spec = packagedWorkerSpawn(process.execPath, workerPath, data.title, env)
    return spawn(spec.command, [...spec.args], { env: spec.env, stdio, windowsHide: true })
  }
  /* v8 ignore next 3 -- the built-output arm: tests always run unbuilt (src/) */
  if (!import.meta.url.endsWith('.ts')) {
    return spawn(process.execPath, [fileURLToPath(new URL('./worker.cjs', import.meta.url))], { env, stdio, windowsHide: true })
  }
  return spawn(process.execPath, ['--import', import.meta.resolve('tsx/esm'), fileURLToPath(new URL('./win32-dialog-worker.ts', import.meta.url))], { env, stdio, windowsHide: true })
}

export { closeThreadWindows } from './win32-dialog-bindings.ts'
