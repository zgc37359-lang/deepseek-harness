import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { packagedWorkerPath, packagedWorkerSpawn } from '../src/win32-dialog-host.ts'

describe('packagedWorkerSpawn', () => {
  it('runs the unpacked CJS worker through the Electron binary as Node', () => {
    const spec = packagedWorkerSpawn(
      'C:/App/DeepSeek Harness.exe',
      'C:/App/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-host-directory-picker-native/lib/worker.cjs',
      'Select Workspace Directory',
      { PATH: 'C:/bin' },
    )

    expect(spec.command).toBe('C:/App/DeepSeek Harness.exe')
    expect(spec.args).toEqual([
      'C:/App/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-host-directory-picker-native/lib/worker.cjs',
    ])
    expect(spec.env).toEqual({
      PATH: 'C:/bin',
      DSH_DIALOG_TITLE: 'Select Workspace Directory',
      ELECTRON_RUN_AS_NODE: '1',
    })
  })
})

describe('packagedWorkerPath', () => {
  it('maps an in-asar module URL to the unpacked worker', () => {
    expect(packagedWorkerPath(
      'file:///C:/App/resources/app.asar/node_modules/@deepseek-ai/dsh-host-directory-picker-native/lib/index.js',
      'C:/App/resources',
    )).toBe(join(
      'C:/App/resources',
      'app.asar.unpacked',
      'node_modules',
      '@deepseek-ai',
      'dsh-host-directory-picker-native',
      'lib',
      'worker.cjs',
    ))
  })

  it('keeps a real on-disk module URL next to its worker', () => {
    expect(packagedWorkerPath(
      'file:///D:/repo/packages/host/directory-picker-native/lib/index.js',
      'C:/App/resources',
    )).toBe(fileURLToPath(new URL(
      './worker.cjs',
      'file:///D:/repo/packages/host/directory-picker-native/lib/index.js',
    )))
  })
})
