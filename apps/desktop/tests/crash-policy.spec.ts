import { describe, expect, it } from 'vitest'
import {
  isCrashOverlayState,
  MAX_RELOAD_AFTER_CRASH,
  nextCrashAction,
  shouldRecoverReload,
} from '../src/crash-policy.ts'

describe('nextCrashAction', () => {
  it('reloads for the first crashes within the reload budget', () => {
    expect(nextCrashAction(0)).toBe('reload')
    expect(nextCrashAction(1)).toBe('reload')
    expect(nextCrashAction(MAX_RELOAD_AFTER_CRASH)).toBe('reload')
  })

  it('switches to the visible overlay once the reload budget is exhausted', () => {
    expect(nextCrashAction(MAX_RELOAD_AFTER_CRASH + 1)).toBe('overlay')
    expect(nextCrashAction(20)).toBe('overlay')
  })

  it('is bounded for absurd counts', () => {
    expect(nextCrashAction(Number.MAX_SAFE_INTEGER)).toBe('overlay')
  })
})

describe('shouldRecoverReload', () => {
  it('reloads for the auto-reload budget plus one overlay-surfacing reload', () => {
    expect(shouldRecoverReload(0)).toBe(true)
    expect(shouldRecoverReload(MAX_RELOAD_AFTER_CRASH)).toBe(true)
    expect(shouldRecoverReload(MAX_RELOAD_AFTER_CRASH + 1)).toBe(true)
  })

  it('stays dead beyond the budget (no reload loop)', () => {
    expect(shouldRecoverReload(MAX_RELOAD_AFTER_CRASH + 2)).toBe(false)
  })
})

describe('isCrashOverlayState', () => {
  it('is false while the budget lasts and true once spent', () => {
    expect(isCrashOverlayState(0)).toBe(false)
    expect(isCrashOverlayState(MAX_RELOAD_AFTER_CRASH)).toBe(false)
    expect(isCrashOverlayState(MAX_RELOAD_AFTER_CRASH + 1)).toBe(true)
  })
})
