import { describe, expect, it } from 'vitest'
import { addRecord, hasRecord, newGrant, removeRecord } from '../src/records.ts'

describe('grant records', () => {
  it('builds a validated record with an optional trimmed reason', () => {
    const record = newGrant(
      { workspaceId: ' w1 ', toolName: 'tool-bash', reason: '  approved  ' },
      'g-1',
      1,
    )
    expect(record).toEqual({
      id: 'g-1',
      workspaceId: 'w1',
      toolName: 'tool-bash',
      createdAt: 1,
      reason: 'approved',
    })
  })

  it('omits a blank reason and rejects blank keys', () => {
    const record = newGrant({ workspaceId: 'w1', toolName: 'tool-bash', reason: '  ' }, 'g-2', 2)
    expect(record.reason).toBeUndefined()
    expect(() => newGrant({ workspaceId: ' ', toolName: 'tool-bash' }, 'g-3', 3)).toThrow(/non-empty/)
  })

  it('appends, removes by id, and checks workspace/tool membership', () => {
    const first = newGrant({ workspaceId: 'w1', toolName: 'tool-bash' }, 'g-1', 1)
    const second = newGrant({ workspaceId: 'w2', toolName: 'tool-fs' }, 'g-2', 2)
    const withBoth = addRecord([first], { workspaceId: 'w2', toolName: 'tool-fs' }, 'g-2', 2)
    expect(withBoth).toEqual([first, second])
    expect(hasRecord(withBoth, 'w1', 'tool-bash')).toBe(true)
    expect(hasRecord(withBoth, 'w1', 'tool-fs')).toBe(false)
    expect(removeRecord(withBoth, 'g-1')).toEqual([second])
  })
})
