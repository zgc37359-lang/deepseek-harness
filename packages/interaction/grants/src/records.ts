/**
 * Pure grant-record algebra: creation validation, append, removal, and
 * membership. Kept dependency-free so the approval and settings surfaces can
 * share one behavior without mounting the full service.
 * @module @deepseek-ai/dsh-grants/records
 */

/** One durable per-workspace tool grant. */
export interface GrantRecord {
  /** Stable record id (revocation key). */
  id: string
  /** The workspace id the grant applies to. */
  workspaceId: string
  /** The wire tool name the grant covers. */
  toolName: string
  /** Epoch milliseconds of grant creation. */
  createdAt: number
  /** Optional user-visible note for the grant. */
  reason?: string
}

/** Input for creating a grant. */
export interface GrantInput {
  workspaceId: string
  toolName: string
  reason?: string
}

/** Build one validated record. */
export function newGrant(input: GrantInput, id: string, createdAt: number): GrantRecord {
  const workspaceId = input.workspaceId.trim()
  const toolName = input.toolName.trim()
  if (workspaceId === '' || toolName === '') {
    throw new Error('grants: workspaceId and toolName must be non-empty')
  }
  return {
    id,
    workspaceId,
    toolName,
    createdAt,
    ...(input.reason !== undefined && input.reason.trim() !== '' ? { reason: input.reason.trim() } : {}),
  }
}

/** Append one new grant to a snapshot. */
export function addRecord(records: readonly GrantRecord[], input: GrantInput, id: string, createdAt: number): GrantRecord[] {
  return [...records, newGrant(input, id, createdAt)]
}

/** Remove one record by id; unknown ids return the same snapshot content. */
export function removeRecord(records: readonly GrantRecord[], id: string): GrantRecord[] {
  return records.filter(record => record.id !== id)
}

/** Whether a live grant covers the workspace/tool pair. */
export function hasRecord(records: readonly GrantRecord[], workspaceId: string, toolName: string): boolean {
  return records.some(record => record.workspaceId === workspaceId && record.toolName === toolName)
}
