/**
 * Desktop renderer entry: the custom title bar over the future Web UI mount.
 * The Web UI boot (AppWebEntry over a composed boot manifest) lands in the
 * next milestone; this milestone proves the shell, tray, and IPC surface.
 */
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import { TitleBar } from './TitleBar.tsx'
import { CrashOverlay } from './crash-overlay.tsx'
import { pollForManifest } from './manifest-poller.ts'
import { activateNewSession } from './tray-actions.ts'
import { updateStatusText } from '../shared/update-status.ts'
import type { UpdateStatus } from '../shared/ipc.ts'
import './styles.css'

/** Count sessions through the desktop bridge (tray verification helper). */
async function sessionCount(): Promise<number> {
  try {
    const body = JSON.stringify({
      type: 'client-request',
      rpcId: 'tray-count',
      method: 'session.list',
      payload: {},
    })
    const raw = await window.desktop.runtime.unary('session.list', body)
    const parsed = JSON.parse(raw.body) as {
      result?: { value?: { items?: unknown[] } }
    }
    return parsed.result?.value?.items?.length ?? 0
  } catch {
    return 0
  }
}

function App() {
  const [info, setInfo] = useState('')
  const [runtimeAttached, setRuntimeAttached] = useState(false)
  const [manifest, setManifest] = useState<unknown>(null)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ kind: 'idle' })
  const [crashed, setCrashed] = useState(false)
  const webHostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let active = true
    void window.desktop.getAppInfo().then((value) => {
      if (active) {
        setInfo(`${value.appVersion} · Electron ${value.electronVersion} · ${value.platform}/${value.arch}`)
      }
    })
    // The runtime attaches a moment after the renderer mounts; the boot
    // manifest can therefore be null on the first probe. Poll with backoff
    // until it lands (unmount aborts); the shell never gives up on its own.
    const controller = new AbortController()
    pollForManifest(
      () => window.desktop.runtime.getBootManifest(),
      (bootManifest) => {
        if (!active) return
        setRuntimeAttached(true)
        setManifest(bootManifest)
      },
      { signal: controller.signal },
    )
    return () => {
      active = false
      controller.abort()
    }
  }, [])

  // Tray "new session": prefer the sidebar flow, fall back to the RPC lane.
  useEffect(() => {
    if (!runtimeAttached) return
    return window.desktop.tray.onNewSession(() => {
      void activateNewSession({
        clickNewSession: async () => {
          const button = document.querySelector<HTMLButtonElement>('button[aria-label*="新建会话"]')
          if (button === null) return false
          const countBefore = await sessionCount()
          button.click()
          // A sidebar click without a selected workspace creates nothing; give
          // the UI a moment and verify before deciding to fall back to RPC.
          await new Promise(resolve => setTimeout(resolve, 1200))
          return (await sessionCount()) > countBefore
        },
        rpcCreateSession: async () => {
          const body = JSON.stringify({
            type: 'client-request',
            rpcId: 'tray-new-session',
            method: 'session.create',
            payload: {},
          })
          const raw = await window.desktop.runtime.unary('session.create', body)
          if (raw.status !== 200) throw new Error('session.create failed')
        },
      })
    })
  }, [runtimeAttached])

  // After repeated renderer crashes the main process stops reloading; the
  // recovery reload that follows boots a live renderer, which queries the
  // crash state and surfaces the overlay instead of a dead window.
  useEffect(() => {
    let active = true
    void window.desktop.shell.crashState().then((state) => {
      if (active) setCrashed(state.crashed)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    const host = webHostRef.current
    if (manifest === null || host === null) return
    ;(globalThis as { __DSH_BOOT__?: unknown }).__DSH_BOOT__ = manifest
    void new AppWebEntry(host).run()
  }, [manifest])

  useEffect(() => window.desktop.updates.onStatus(setUpdateStatus), [])

  const exportDiagnostics = async (): Promise<void> => {
    const result = await window.desktop.diagnostics.export()
    if (!result.cancelled) setExportedPath(result.path)
  }

  return (
    <div className="desktop-shell">
      <TitleBar title="Harness Desktop" updateStatus={updateStatus} />
      {crashed && (
        <CrashOverlay
          onReload={() => {
            void window.desktop.shell.resetCrash().then(() => { location.reload() })
          }}
        />
      )}
      {runtimeAttached && manifest !== null
        ? <div className="web-ui-host" ref={webHostRef} />
        : (
          <main className="desktop-body">
            <div className="desktop-placeholder">
              <h1>Desktop shell</h1>
              <p>{runtimeAttached ? 'Runtime 已挂载，正在接入 Web UI…' : 'Runtime 未挂载（IPC 桥已就绪）。'}</p>
              <p className="desktop-placeholder__info">{info}</p>
              <button className="desktop-placeholder__button" type="button" onClick={() => void exportDiagnostics()}>
                导出诊断包
              </button>
              {exportedPath !== null && <p className="desktop-placeholder__info">已导出：{exportedPath}</p>}
              <div className="desktop-placeholder__updates">
                <span className="desktop-placeholder__info">{updateStatusText(updateStatus)}</span>
                {updateStatus.kind !== 'downloaded' && (
                  <button
                    className="desktop-placeholder__button"
                    type="button"
                    disabled={updateStatus.kind === 'checking' || updateStatus.kind === 'downloading'}
                    onClick={() => void window.desktop.updates.check()}
                  >
                    检查更新
                  </button>
                )}
                {updateStatus.kind === 'downloaded' && (
                  <button
                    className="desktop-placeholder__button"
                    type="button"
                    onClick={() => void window.desktop.updates.install()}
                  >
                    重启安装
                  </button>
                )}
              </div>
            </div>
          </main>
        )}
    </div>
  )
}

const root = document.getElementById('root')
if (root === null) throw new Error('desktop renderer: missing #root')
createRoot(root).render(<App />)
