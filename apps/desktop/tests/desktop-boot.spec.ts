import { describe, expect, it, vi } from 'vitest'
import { resolveRuntimeSpecifier } from '../src/desktop-boot.ts'

describe('resolveRuntimeSpecifier', () => {
  it('prefers the app closure and never consults profiles for in-box packages', () => {
    const app = vi.fn(() => 'app/entry.js')
    const profiles = vi.fn(() => { throw new Error('profiles must not be consulted') })

    expect(resolveRuntimeSpecifier('@deepseek-ai/dsh-base', { app, profiles })).toBe('app/entry.js')
    expect(app).toHaveBeenCalledWith('@deepseek-ai/dsh-base')
    expect(profiles).not.toHaveBeenCalled()
  })

  it('falls back to the profiles fallback when the app closure cannot resolve', () => {
    const app = vi.fn(() => { throw new Error('not in app closure') })
    const profiles = vi.fn(() => 'profiles/entry.js')

    expect(resolveRuntimeSpecifier('out-of-tree-plugin', { app, profiles })).toBe('profiles/entry.js')
    expect(app).toHaveBeenCalledWith('out-of-tree-plugin')
    expect(profiles).toHaveBeenCalledWith('out-of-tree-plugin')
  })

  it('propagates the profiles error when both anchors fail', () => {
    const app = vi.fn(() => { throw new Error('app miss') })
    const profiles = vi.fn(() => { throw new Error('profiles miss') })

    expect(() => resolveRuntimeSpecifier('missing', { app, profiles })).toThrow('profiles miss')
  })
})
