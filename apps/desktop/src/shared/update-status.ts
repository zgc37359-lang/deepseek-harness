/**
 * User-facing update status text, shared by the shell placeholder and the
 * always-visible title-bar entry so both surfaces read identically.
 * @module @deepseek-ai/dsh-desktop/update-status
 */

import type { UpdateStatus } from './ipc.ts'

/** Human-readable update status line for one status state. */
export function updateStatusText(status: UpdateStatus): string {
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
