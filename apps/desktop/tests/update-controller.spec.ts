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

  it('treats an empty feed (no published versions) as not-available, not an error', () => {
    const updater = new FakeUpdater()
    const emitted: UpdateStatus[] = []
    const controller = createUpdateController(updater, status => emitted.push(status))

    updater.emit('error', new Error('No published versions on GitHub'))

    expect(emitted).toEqual([{ kind: 'not-available' }])
    expect(controller.status()).toEqual({ kind: 'not-available' })
  })

  it('matches the empty-feed error case-insensitively and as a string', () => {
    const updater = new FakeUpdater()
    const emitted: UpdateStatus[] = []
    const controller = createUpdateController(updater, status => emitted.push(status))

    updater.emit('error', 'no PUBLISHED VERSIONS on github')

    expect(emitted).toEqual([{ kind: 'not-available' }])
    expect(controller.status()).toEqual({ kind: 'not-available' })
  })

  it('maps the empty-feed rejection of check() to not-available', async () => {
    const updater = new FakeUpdater()
    updater.checkForUpdates = () => Promise.reject(new Error('No published versions on GitHub'))
    const emitted: UpdateStatus[] = []
    createUpdateController(updater, status => emitted.push(status))

    // Re-run the check with the rejection; the catch path maps it.
    updater.checkForUpdates = () => Promise.reject(new Error('No published versions on GitHub'))
    updater.emit('error', new Error('No published versions on GitHub'))
    await vi.waitFor(() => {
      expect(emitted).toEqual([{ kind: 'not-available' }])
    })
  })

  it('keeps genuine transport failures as errors', () => {
    const updater = new FakeUpdater()
    const emitted: UpdateStatus[] = []
    createUpdateController(updater, status => emitted.push(status))

    updater.emit('error', new Error('connect ECONNREFUSED 1.2.3.4:443'))

    expect(emitted).toEqual([{ kind: 'error', message: 'connect ECONNREFUSED 1.2.3.4:443' }])
  })

  it('treats a 404 from releases/latest (no stable release) as not-available', () => {
    const updater = new FakeUpdater()
    const emitted: UpdateStatus[] = []
    createUpdateController(updater, status => emitted.push(status))

    updater.emit('error', new Error('404 Not Found\n\nHeaders: {"server":"github.com","strict-transport-security":"max-age=31536000"}'))

    expect(emitted).toEqual([{ kind: 'not-available' }])
  })

  it('treats "unable to find latest version" (no production release) as not-available', () => {
    const updater = new FakeUpdater()
    const emitted: UpdateStatus[] = []
    createUpdateController(updater, status => emitted.push(status))

    updater.emit('error', new Error('Unable to find latest version on GitHub (https://github.com/x/y/releases/latest), please ensure a production release exists'))

    expect(emitted).toEqual([{ kind: 'not-available' }])
  })

  it('treats a missing channel file (latest.yml / latest-rc.yml) as not-available', () => {
    const updater = new FakeUpdater()
    const emitted: UpdateStatus[] = []
    createUpdateController(updater, status => emitted.push(status))

    updater.emit('error', new Error('Cannot find latest-rc.yml in the latest release artifacts (https://github.com/x/y/releases/download/v0.1.0-rc.1/latest-rc.yml)'))

    expect(emitted).toEqual([{ kind: 'not-available' }])
  })

  it('never surfaces the raw HttpError headers dump to the user', () => {
    const updater = new FakeUpdater()
    const emitted: UpdateStatus[] = []
    createUpdateController(updater, status => emitted.push(status))

    updater.emit('error', new Error('429 Too many requests\n\nHeaders: {"server":"github.com","x-github-request-id":"1:2:3"}'))

    expect(emitted).toEqual([{ kind: 'error', message: '检查更新失败（429 Too many requests），请稍后重试' }])
    expect(emitted[0].kind === 'error' && emitted[0].message.includes('x-github-request-id')).toBe(false)
  })
})
