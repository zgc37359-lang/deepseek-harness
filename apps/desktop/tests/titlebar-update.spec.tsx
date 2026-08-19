// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TitleBar } from '../src/renderer/TitleBar.tsx'
import type { UpdateStatus } from '../src/shared/ipc.ts'

// React 18 act() requires the act-environment flag to suppress its warning.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root
let host: HTMLElement

const desktop = {
  window: {
    minimize: vi.fn().mockResolvedValue(undefined),
    toggleMaximize: vi.fn().mockResolvedValue(true),
    close: vi.fn().mockResolvedValue(undefined),
    isMaximized: vi.fn().mockResolvedValue(false),
    onMaximizedChanged: vi.fn(() => () => {}),
    menuAction: vi.fn().mockResolvedValue(undefined),
    beginMove: vi.fn().mockResolvedValue(undefined),
    beginSize: vi.fn().mockResolvedValue(undefined),
    endDrag: vi.fn().mockResolvedValue(undefined),
  },
  updates: {
    check: vi.fn().mockResolvedValue(undefined),
    install: vi.fn().mockResolvedValue(undefined),
  },
}

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  ;(globalThis as { desktop: unknown }).desktop = desktop
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => { root.unmount() })
  host.remove()
  delete (globalThis as { desktop?: unknown }).desktop
})

function render(status: UpdateStatus): void {
  act(() => { root.render(<TitleBar title="Harness Desktop" updateStatus={status} />) })
}

describe('TitleBar update entry', () => {
  it('shows the status text for a non-downloaded update', () => {
    render({ kind: 'idle' })
    expect(host.textContent).toContain('更新：未检查')
    expect(host.textContent).not.toContain('重启安装')
  })

  it('triggers a manual check on click when idle', () => {
    render({ kind: 'idle' })
    const button = host.querySelector<HTMLButtonElement>('.titlebar__update-button')!
    act(() => { button.click() })
    expect(desktop.updates.check).toHaveBeenCalledTimes(1)
  })

  it('offers restart-install once downloaded', () => {
    render({ kind: 'downloaded', version: '1.2.3' })
    const button = host.querySelector<HTMLButtonElement>('.titlebar__update-button')!
    act(() => { button.click() })
    expect(desktop.updates.install).toHaveBeenCalledTimes(1)
  })

  it('disables the button while checking', () => {
    render({ kind: 'checking' })
    const button = host.querySelector<HTMLButtonElement>('.titlebar__update-button')!
    expect(button.disabled).toBe(true)
  })

  it('hides the entry when no update status is provided', () => {
    act(() => { root.render(<TitleBar title="Harness Desktop" />) })
    expect(host.querySelector('.titlebar__update-button')).toBeNull()
  })
})
