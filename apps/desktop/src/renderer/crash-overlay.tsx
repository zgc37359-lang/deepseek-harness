/**
 * Full-window crash surface shown after repeated renderer crashes. The main
 * process stops auto-reloading once its budget is spent and pushes
 * shell:renderer-crashed; this overlay is the visible recovery affordance.
 */

/** Props for the crash overlay. */
export interface CrashOverlayProps {
  /** Recovery action; defaults to a full page reload. */
  onReload?: () => void
}

/** Render the crash surface with a single recovery action. */
export function CrashOverlay({ onReload = () => { location.reload() } }: CrashOverlayProps) {
  return (
    <div className="crash-overlay" data-shell-crash-overlay role="alert">
      <h2 className="crash-overlay__title">渲染进程异常</h2>
      <p className="crash-overlay__body">界面多次崩溃，已停止自动恢复。</p>
      <button className="crash-overlay__button" type="button" onClick={onReload}>
        重新加载
      </button>
    </div>
  )
}
