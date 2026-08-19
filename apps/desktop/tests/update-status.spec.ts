import { describe, expect, it } from 'vitest'
import { updateStatusText } from '../src/shared/update-status.ts'

describe('updateStatusText', () => {
  it('maps every update status to a user-facing line', () => {
    expect(updateStatusText({ kind: 'idle' })).toBe('更新：未检查')
    expect(updateStatusText({ kind: 'checking' })).toBe('更新：检查中…')
    expect(updateStatusText({ kind: 'available', version: '1.2.3' })).toBe('更新：发现 1.2.3，正在下载…')
    expect(updateStatusText({ kind: 'downloading', percent: 42 })).toBe('更新：下载中 42%')
    expect(updateStatusText({ kind: 'downloaded', version: '1.2.3' })).toBe('更新：1.2.3 已就绪')
    expect(updateStatusText({ kind: 'not-available' })).toBe('更新：已是最新版本')
    expect(updateStatusText({ kind: 'error', message: 'boom' })).toBe('更新失败：boom')
  })
})
