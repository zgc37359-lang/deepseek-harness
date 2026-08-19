import type { ObservableSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionLogDownloadState } from './controller.ts'
import { NS } from './locales.ts'

/** Browser operations and state injected into the Session Header contribution. */
export interface SessionLogDownloadDialogInjected {
  hooks: { sessionLogDownload: ObservableSnapshot<SessionLogDownloadState> }
  request: (sessionId: SessionId) => Promise<void>
  dismiss: (sessionId: SessionId) => void
}

export type SessionLogDownloadDialogProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<SessionLogDownloadDialogInjected>

/**
 * Modal shared by the Session Header button and this browser's `/export` command.
 * @param props - Session runtime, bound controller state, actions, and localized copy.
 * @returns the modal portal contribution.
 */
export function SessionLogDownloadDialog({
  sessionId, useSessionLogDownload, dismiss, t,
}: SessionLogDownloadDialogProps) {
  const entry = useSessionLogDownload(state => state.bySession[String(sessionId)])

  const status = entry?.status
  const open = entry?.open === true
  const savedPath = status === 'success' ? entry?.path : undefined
  const error = status === 'error' ? entry?.error || t('dialog.commandFailed') : null
  const title = status === 'downloading'
    ? t('dialog.preparingTitle')
    : status === 'success' ? t('dialog.successTitle') : t('dialog.errorTitle')
  const description = status === 'downloading'
    ? t('dialog.preparingDescription')
    : status === 'success'
      ? savedPath === undefined ? t('dialog.successDescription') : `${t('dialog.savedAt')} ${savedPath}`
      : error ?? t('dialog.commandFailed')
  const reveal = async (): Promise<void> => {
    if (savedPath === undefined) return
    const bridge = (globalThis as { desktop?: { download?: { reveal?(path: string): Promise<boolean> } } }).desktop
    await bridge?.download?.reveal?.(savedPath)
  }

  return (
    <Modal
      open={open}
      onClose={() => { dismiss(sessionId) }}
      title={title}
      description={description}
      closeLabel={t('dialog.close')}
      footer={(
        <>
          {savedPath !== undefined && (
            <Button variant="outline" onClick={() => { void reveal() }}>{t('dialog.reveal')}</Button>
          )}
          <Button variant="primary" onClick={() => { dismiss(sessionId) }}>{t('dialog.close')}</Button>
        </>
      )}
    />
  )
}
