import { useEffect, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { updateStatusText } from '../shared/update-status.ts'
import type { UpdateStatus, WindowMenuAction } from '../shared/ipc.ts'

interface TitleBarProps {
  title: string
  /** Always-visible update status; undefined hides the entry (tests, legacy). */
  updateStatus?: UpdateStatus
}

export function TitleBar({ title, updateStatus }: TitleBarProps) {
  const [maximized, setMaximized] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  useEffect(() => {
    let active = true
    void window.desktop.window.isMaximized().then((value) => {
      if (active) setMaximized(value)
    })
    const unsubscribe = window.desktop.window.onMaximizedChanged(setMaximized)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey && event.code === 'Space') {
        event.preventDefault()
        setMenu({ x: Math.max(0, window.innerWidth - 200), y: 40 })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      active = false
      unsubscribe()
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const closeMenu = (): void => { setMenu(null) }

  const runAction = (action: WindowMenuAction): void => {
    void window.desktop.window.menuAction(action)
    closeMenu()
  }

  const startDrag = (kind: 'move' | 'size'): void => {
    void (kind === 'move'
      ? window.desktop.window.beginMove()
      : window.desktop.window.beginSize())
    closeMenu()
    const end = (): void => {
      void window.desktop.window.endDrag()
    }
    window.addEventListener('pointerup', end, { once: true })
    window.addEventListener('pointercancel', end, { once: true })
  }

  return (
    <header
      className="titlebar"
      onDoubleClick={() => {
        void window.desktop.window.toggleMaximize()
      }}
      onContextMenu={(event) => {
        event.preventDefault()
        setMenu({ x: event.clientX, y: event.clientY })
      }}
    >
      <div className="titlebar__title">{title}</div>
      {updateStatus !== undefined && (
        <div className="titlebar__updates">
          <button
            className="titlebar__update-button"
            type="button"
            aria-label="检查更新"
            disabled={updateStatus.kind === 'checking' || updateStatus.kind === 'downloading'}
            onClick={() => {
              void (updateStatus.kind === 'downloaded'
                ? window.desktop.updates.install()
                : window.desktop.updates.check())
            }}
          >
            {updateStatusText(updateStatus)}
          </button>
        </div>
      )}
      <div className="titlebar__controls">
        <button
          className="titlebar__button"
          type="button"
          aria-label="最小化"
          onClick={() => {
            void window.desktop.window.minimize()
          }}
        >
          <MinimizeIcon />
        </button>
        <button
          className="titlebar__button"
          type="button"
          aria-label={maximized ? '还原' : '最大化'}
          onClick={() => {
            void window.desktop.window.toggleMaximize()
          }}
        >
          {maximized ? <RestoreIcon /> : <MaximizeIcon />}
        </button>
        <button
          className="titlebar__button titlebar__button--close"
          type="button"
          aria-label="关闭"
          onClick={() => {
            void window.desktop.window.close()
          }}
        >
          <CloseIcon />
        </button>
      </div>
      {menu !== null && (
        <WindowMenu
          x={menu.x}
          y={menu.y}
          maximized={maximized}
          onClose={closeMenu}
          onAction={runAction}
          onDrag={startDrag}
        />
      )}
    </header>
  )
}

interface WindowMenuProps {
  x: number
  y: number
  maximized: boolean
  onClose: () => void
  onAction: (action: WindowMenuAction) => void
  onDrag: (kind: 'move' | 'size') => void
}

function WindowMenu({ x, y, maximized, onClose, onAction, onDrag }: WindowMenuProps) {
  useEffect(() => {
    const close = (): void => { onClose() }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const stop = (event: ReactPointerEvent): void => { event.stopPropagation() }

  return (
    <div
      className="titlebar__menu"
      role="menu"
      style={{ left: x, top: y }}
      onPointerDown={stop}
      onContextMenu={(event) => { event.preventDefault() }}
    >
      <button
        className="titlebar__menu-item"
        type="button"
        role="menuitem"
        disabled={!maximized}
        onClick={() => { onAction('restore') }}
      >
        还原
      </button>
      <button className="titlebar__menu-item" type="button" role="menuitem" onClick={() => { onDrag('move') }}>
        移动
      </button>
      <button className="titlebar__menu-item" type="button" role="menuitem" onClick={() => { onDrag('size') }}>
        大小
      </button>
      <button className="titlebar__menu-item" type="button" role="menuitem" onClick={() => { onAction('minimize') }}>
        最小化
      </button>
      <button className="titlebar__menu-item" type="button" role="menuitem" onClick={() => { onAction('maximize') }}>
        {maximized ? '还原' : '最大化'}
      </button>
      <button className="titlebar__menu-item" type="button" role="menuitem" onClick={() => { onAction('close') }}>
        关闭
      </button>
    </div>
  )
}

function MinimizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <line x1="0" y1="5" x2="10" y2="5" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function MaximizeIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function RestoreIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="0.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1" />
      <path d="M2.5 2.5V1h6v6h-1.5" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" strokeWidth="1" />
      <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" strokeWidth="1" />
    </svg>
  )
}
