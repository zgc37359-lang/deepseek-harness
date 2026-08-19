import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendLogLine, DEFAULT_LOG_KEEP, DEFAULT_LOG_MAX_BYTES, rotateLogs } from '../src/main-log.ts'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-main-log-'))
  dirs.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('appendLogLine', () => {
  it('appends timestamped lines and creates the parent directory', () => {
    const dir = tempDir()
    const file = join(dir, 'logs', 'main.log')
    appendLogLine(file, 'info', 'hello')
    appendLogLine(file, 'error', 'boom')
    const lines = readFileSync(file, 'utf8').split('\n')
    expect(lines[0]).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\] info hello$/)
    expect(lines[1]).toMatch(/^\[\d{4}-\d{2}-\d{2}T.*\] error boom$/)
  })

  it('rotates once the file exceeds maxBytes, keeping the newest line in main.log', () => {
    const dir = tempDir()
    const file = join(dir, 'main.log')
    appendLogLine(file, 'info', 'first', { maxBytes: 8, keep: 2 })
    appendLogLine(file, 'info', 'second-long-line', { maxBytes: 8, keep: 2 })
    expect(readFileSync(file, 'utf8')).toContain('second-long-line')
    expect(readFileSync(file + '.1', 'utf8')).toContain('first')
  })

  it('does not rotate under the limit', () => {
    const dir = tempDir()
    const file = join(dir, 'main.log')
    for (let i = 0; i < 3; i++) appendLogLine(file, 'info', 'line-' + String(i), { maxBytes: 1024, keep: 3 })
    expect(readdirSync(dir).sort()).toEqual(['main.log'])
  })

  it('honors the keep count and shifts older generations', () => {
    const dir = tempDir()
    const file = join(dir, 'main.log')
    for (let i = 0; i < 5; i++) appendLogLine(file, 'info', 'line-' + String(i), { maxBytes: 1, keep: 2 })
    const names = readdirSync(dir).sort()
    expect(names).toEqual(['main.log', 'main.log.1', 'main.log.2'])
    expect(readFileSync(file, 'utf8')).toContain('line-4')
    expect(readFileSync(file + '.1', 'utf8')).toContain('line-3')
    expect(readFileSync(file + '.2', 'utf8')).toContain('line-2')
  })

  it('exposes sane defaults', () => {
    expect(DEFAULT_LOG_MAX_BYTES).toBeGreaterThan(0)
    expect(DEFAULT_LOG_KEEP).toBeGreaterThan(0)
  })
})

describe('rotateLogs', () => {
  it('is a no-op when the log file does not exist', () => {
    const dir = tempDir()
    expect(() => {
      rotateLogs(join(dir, 'missing.log'), 2)
    }).not.toThrow()
  })
})
