/**
 * Durable per-workspace tool grants: `ctx.grants` persists records in the
 * `desktop.grants` settings namespace and exposes list/grant/revoke/check.
 * Records are durable and revocable; the approval adapter and the Settings
 * revocation surface consume this service.
 * @module @deepseek-ai/dsh-grants
 */

import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-settings'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  addRecord,
  hasRecord,
  removeRecord,
  type GrantInput,
  type GrantRecord,
} from './records.ts'

export type { GrantInput, GrantRecord } from './records.ts'

/** Settings namespace owned by the grants service. */
export const GRANTS_SETTINGS_NAMESPACE = settingsNamespace('desktop-grants')

interface GrantsSettings {
  grants: GrantRecord[]
}

const grantsSchema: z<GrantsSettings> = z.object({
  grants: z.array(z.object({
    id: z.string().required(),
    workspaceId: z.string().required(),
    toolName: z.string().required(),
    createdAt: z.natural().required(),
    reason: z.string(),
  })).required(),
})

const EMPTY_SETTINGS: GrantsSettings = { grants: [] }

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Durable per-workspace tool grants. */
    grants: GrantService
  }

  interface Events {
    /** A grant list snapshot changed (grant/revoke); log-only, not durable. */
    'grants/changed'(records: readonly GrantRecord[]): void
  }
}

/** Owns the durable grant table. */
export class GrantService extends Service {
  private source: () => GrantsSettings = () => EMPTY_SETTINGS

  constructor(ctx: Context) {
    super(ctx, 'grants')
    installSettingsSection(ctx, GRANTS_SETTINGS_NAMESPACE, grantsSchema, EMPTY_SETTINGS, {
      setSource: (next) => {
        this.source = next
      },
      onChange: () => {},
    })
  }

  /** Current grant records in settings order. */
  list(): readonly GrantRecord[] {
    return this.source().grants
  }

  /** Persist one new grant and announce the snapshot. */
  async grant(input: GrantInput): Promise<GrantRecord> {
    const current = this.source().grants
    const next = addRecord(current, input, randomUUID(), Date.now())
    await this.write(next)
    return next[next.length - 1] as GrantRecord
  }

  /** Remove one grant by id; unknown ids are a no-op write. */
  async revoke(id: string): Promise<void> {
    await this.write(removeRecord(this.source().grants, id))
  }

  /** Whether a live grant covers the workspace/tool pair. */
  check(workspaceId: string, toolName: string): boolean {
    return hasRecord(this.source().grants, workspaceId, toolName)
  }

  private async write(records: readonly GrantRecord[]): Promise<void> {
    const settings = this.ctx.get('settings')
    if (settings === undefined) {
      throw new Error('grants: a settings provider is required to persist grants')
    }
    await settings.update(GRANTS_SETTINGS_NAMESPACE, { grants: [...records] })
    this.ctx.emit('grants/changed', records)
  }
}

export default GrantService
