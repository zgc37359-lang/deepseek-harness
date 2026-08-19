import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { markUpdateChecked, updateCheckDue } from '../src/update-throttle.ts'

const INTERVAL_MS = 24 * 60 * 60 * 1000

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dsh-update-throttle-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('updateCheckDue', () => {
  it('is due when no marker file exists (first launch)', async () => {
    await expect(updateCheckDue(join(dir, 'absent.txt'), INTERVAL_MS)).resolves.toBe(true)
  })

  it('is not due when the marker is fresh', async () => {
    const file = join(dir, 'fresh.txt')
    writeFileSync(file, 'now')
    await expect(updateCheckDue(file, INTERVAL_MS)).resolves.toBe(false)
  })

  it('is due when the marker is older than the interval', async () => {
    const file = join(dir, 'stale.txt')
    writeFileSync(file, 'stale')
    utimesSync(file, new Date(Date.now() - INTERVAL_MS - 60_000), new Date(Date.now() - INTERVAL_MS - 60_000))
    await expect(updateCheckDue(file, INTERVAL_MS)).resolves.toBe(true)
  })

  it('is due when the marker cannot be read', async () => {
    await expect(updateCheckDue(join(dir, 'missing-dir', 'marker.txt'), INTERVAL_MS)).resolves.toBe(true)
  })
})

describe('markUpdateChecked', () => {
  it('creates a marker that suppresses the next immediate check', async () => {
    const file = join(dir, 'marked.txt')
    await markUpdateChecked(file)
    await expect(updateCheckDue(file, INTERVAL_MS)).resolves.toBe(false)
  })

  it('never rejects when the marker cannot be written', async () => {
    await expect(markUpdateChecked(join(dir, 'missing-dir', 'marker.txt'))).resolves.toBeUndefined()
  })
})
