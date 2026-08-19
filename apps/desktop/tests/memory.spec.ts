import { describe, expect, it } from 'vitest'
import { processMemorySnapshot } from '../src/memory.ts'

describe('processMemorySnapshot', () => {
  it('converts Electron process metrics from kilobytes to MiB', () => {
    expect(processMemorySnapshot(42, 'Tab', { workingSetSize: 131_704, privateBytes: 69_580 }))
      .toEqual({ pid: 42, type: 'Tab', workingSetMiB: 129, privateMiB: 68 })
  })

  it('omits memory fields when the platform metric is unavailable', () => {
    expect(processMemorySnapshot(42, 'Utility')).toEqual({ pid: 42, type: 'Utility' })
  })
})
