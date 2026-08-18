import { describe, expect, it, vi } from 'vitest'
import type { UpdateStatus } from '../src/shared/ipc.ts'
import { createUpdateController, type AutoUpdaterLike } from '../src/update.ts'

class FakeUpdater implements AutoUpdaterLike {
  readonly listeners = new Map<string, (...args: unknown[]) => void>()
  checkCalls = 0
  quitCalls = 0

  on(event: string, listener: (...args: unknown[]) => void): unknown {
    this.listeners.set(event, listener)
    return this
  }

  checkForUpdates(): Promise<void> {
    this.checkCalls += 1
    return Promise.resolve()
  }

  quitAndInstall(): void {
    this.quitCalls += 1
  }

  emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.(...args)
  }
}

describe('createUpdateController', () => {
  it('delegates check and quitAndInstall to the updater', () => {
    const updater = new FakeUpdater()
    const controller = createUpdateController(updater, vi.fn())
    controller.check()
    controller.quitAndInstall()
    expect(updater.checkCalls).toBe(1)
    expect(updater.quitCalls).toBe(1)
  })

  it('translates updater events into status transitions', () => {
    const updater = new FakeUpdater()
    const emitted: UpdateStatus[] = []
    const controller = createUpdateController(updater, status => emitted.push(status))

    updater.emit('checking-for-update')
    updater.emit('update-available', { version: '0.2.0' })
    updater.emit('download-progress', { percent: 42.4 })
    updater.emit('update-downloaded', { version: '0.2.0' })

    expect(emitted).toEqual([
      { kind: 'checking' },
      { kind: 'available', version: '0.2.0' },
      { kind: 'downloading', percent: 42 },
      { kind: 'downloaded', version: '0.2.0' },
    ])
    expect(controller.status()).toEqual({ kind: 'downloaded', version: '0.2.0' })
  })

  it('reports errors and not-available states', () => {
    const updater = new FakeUpdater()
    const emitted: UpdateStatus[] = []
    const controller = createUpdateController(updater, status => emitted.push(status))

    updater.emit('update-not-available')
    updater.emit('error', new Error('feed unavailable'))
    updater.emit('error', 'string error')

    expect(emitted).toEqual([
      { kind: 'not-available' },
      { kind: 'error', message: 'feed unavailable' },
      { kind: 'error', message: 'string error' },
    ])
    expect(controller.status()).toEqual({ kind: 'error', message: 'string error' })
  })
})
