import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { writeBase64Stream } from '../src/download.ts'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-download-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('writeBase64Stream', () => {
  it('writes a multi-megabyte payload byte-for-byte and reports the decoded size', async () => {
    const dir = tempDir()
    const path = join(dir, 'payload.bin')
    const payload = randomBytes(2 * 1024 * 1024 + 123)
    const written = await writeBase64Stream(path, payload.toString('base64'))
    expect(written).toBe(payload.length)
    expect(readFileSync(path)).toEqual(payload)
  })

  it('rejects when the destination is a directory and leaves it intact', async () => {
    const dir = tempDir()
    await expect(writeBase64Stream(dir, randomBytes(128).toString('base64'))).rejects.toThrow()
    expect(existsSync(dir)).toBe(true)
  })
})
