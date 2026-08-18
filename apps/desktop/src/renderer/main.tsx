/**
 * Desktop renderer entry: the custom title bar over the future Web UI mount.
 * The Web UI boot (AppWebEntry over a composed boot manifest) lands in the
 * next milestone; this milestone proves the shell, tray, and IPC surface.
 */
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import { TitleBar } from './TitleBar.tsx'
import type { UpdateStatus } from '../shared/ipc.ts'
import './styles.css'

function App() {
  const [info, setInfo] = useState('')
  const [runtimeAttached, setRuntimeAttached] = useState(false)
  const [manifest, setManifest] = useState<unknown>(null)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ kind: 'idle' })
  const webHostRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let active = true
    void window.desktop.getAppInfo().then((value) => {
      if (active) {
        setInfo(`${value.appVersion} · Electron ${value.electronVersion} · ${value.platform}/${value.arch}`)
      }
    })
    // The runtime attaches a moment after the renderer mounts; the boot
    // manifest can therefore be null on the first probe. Poll briefly so an
    // early window settles onto the web UI instead of the placeholder.
    const MAX_MANIFEST_ATTEMPTS = 60
    const MANIFEST_RETRY_MS = 500
    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const checkManifest = async (): Promise<void> => {
      const bootManifest = await window.desktop.runtime.getBootManifest()
      if (!active) return
      if (bootManifest !== null) {
        setRuntimeAttached(true)
        setManifest(bootManifest)
        return
      }
      attempts += 1
      if (attempts < MAX_MANIFEST_ATTEMPTS) {
        timer = setTimeout(() => { void checkManifest() }, MANIFEST_RETRY_MS)
      }
    }
    void checkManifest()
    return () => {
      active = false
      if (timer !== undefined) clearTimeout(timer)
    }
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
      <TitleBar title="DeepSeek Harness" />
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

/** Human-readable update status line for the shell placeholder. */
function updateStatusText(status: UpdateStatus): string {
  switch (status.kind) {
    case 'idle':
      return '更新：未检查'
    case 'checking':
      return '更新：检查中…'
    case 'available':
      return `更新：发现 ${status.version}，正在下载…`
    case 'downloading':
      return `更新：下载中 ${status.percent}%`
    case 'downloaded':
      return `更新：${status.version} 已就绪`
    case 'not-available':
      return '更新：已是最新版本'
    case 'error':
      return `更新失败：${status.message}`
  }
}

const root = document.getElementById('root')
if (root === null) throw new Error('desktop renderer: missing #root')
createRoot(root).render(<App />)
