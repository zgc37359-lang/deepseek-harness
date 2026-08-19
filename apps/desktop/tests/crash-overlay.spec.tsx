// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CrashOverlay } from '../src/renderer/crash-overlay.tsx'

// React 18 act() requires the act-environment flag to suppress its warning.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
})

describe('CrashOverlay', () => {
  it('renders the crash message and a recovery action', () => {
    act(() => { root.render(<CrashOverlay onReload={() => {}} />) })
    expect(host.textContent).toContain('渲染进程异常')
    expect(host.textContent).toContain('重新加载')
  })

  it('invokes onReload when the button is clicked', () => {
    const onReload = vi.fn()
    act(() => { root.render(<CrashOverlay onReload={onReload} />) })
    const button = host.querySelector('button')
    expect(button).not.toBeNull()
    act(() => { button!.click() })
    expect(onReload).toHaveBeenCalledTimes(1)
  })

  it('falls back to location.reload when no handler is given', () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { reload })
    act(() => { root.render(<CrashOverlay />) })
    act(() => { host.querySelector('button')!.click() })
    expect(reload).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })
})
