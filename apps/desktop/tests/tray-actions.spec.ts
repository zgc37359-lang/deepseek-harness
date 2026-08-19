import { describe, expect, it, vi } from 'vitest'
import { activateNewSession } from '../src/renderer/tray-actions.ts'

describe('activateNewSession', () => {
  it('prefers the sidebar click and skips the RPC fallback on success', async () => {
    const clickNewSession = vi.fn().mockResolvedValue(true)
    const rpcCreateSession = vi.fn()
    expect(await activateNewSession({ clickNewSession, rpcCreateSession })).toBe(true)
    expect(clickNewSession).toHaveBeenCalledTimes(1)
    expect(rpcCreateSession).not.toHaveBeenCalled()
  })

  it('falls back to the RPC lane when the sidebar click is unavailable', async () => {
    const clickNewSession = vi.fn().mockResolvedValue(false)
    const rpcCreateSession = vi.fn().mockResolvedValue({ sessionId: 'session-x' })
    expect(await activateNewSession({ clickNewSession, rpcCreateSession })).toBe(true)
    expect(rpcCreateSession).toHaveBeenCalledTimes(1)
  })

  it('reports failure when both lanes fail', async () => {
    const clickNewSession = vi.fn().mockResolvedValue(false)
    const rpcCreateSession = vi.fn().mockRejectedValue(new Error('transport'))
    expect(await activateNewSession({ clickNewSession, rpcCreateSession })).toBe(false)
  })

  it('treats a throwing click as unavailable and falls through', async () => {
    const clickNewSession = vi.fn().mockRejectedValue(new Error('no button'))
    const rpcCreateSession = vi.fn().mockResolvedValue({})
    expect(await activateNewSession({ clickNewSession, rpcCreateSession })).toBe(true)
    expect(rpcCreateSession).toHaveBeenCalledTimes(1)
  })
})
