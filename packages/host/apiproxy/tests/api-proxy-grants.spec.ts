/**
 * Durable-grant integration over the proxy approval channel: a remembered
 * allow persists a per-workspace grant before settling, and an existing grant
 * answers without asking the user.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import type { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import type { GrantService, GrantInput } from '@deepseek-ai/dsh-grants'
import type { ApiProxy, MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId as mintRpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

interface FakeGrants {
  granted: GrantInput[]
  preGranted: boolean
  grant(input: GrantInput): Promise<{ id: string; workspaceId: string; toolName: string; createdAt: number }>
  check(workspaceId: string, toolName: string): boolean
}

async function harness(): Promise<{ ctx: Context; api: ApiProxy; fake: FakeGrants }> {
  const ctx = new Context()
  const fake: FakeGrants = {
    granted: [],
    preGranted: false,
    grant: async (input) => {
      fake.granted.push(input)
      return { id: 'g-1', workspaceId: input.workspaceId, toolName: input.toolName, createdAt: 1 }
    },
    check: (workspaceId, toolName) => {
      if (fake.preGranted) return true
      return fake.granted.some(record => record.workspaceId === workspaceId && record.toolName === toolName)
    },
  }
  ctx.provide('grants', fake as unknown as GrantService)
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(ApprovalService)
  const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
  return { ctx, api, fake }
}

function agentOf(ctx: Context): Agent {
  const session = ctx.sessions.create(undefined, { meta: { cwd: '/ws' } })
  session.append('turn/start', { turn: 1 })
  return { session } as unknown as Agent
}

function openMux(api: ApiProxy, abort: AbortController): { frames: MuxFrame[]; envelopes: RpcRequest<MuxFrame>[]; waitFor(type: MuxFrame['type']): Promise<MuxFrame> } {
  const frames: MuxFrame[] = []
  const envelopes: RpcRequest<MuxFrame>[] = []
  const waiters: { type: MuxFrame['type']; resolve: (frame: MuxFrame) => void }[] = []
  void (async () => {
    for await (const envelope of api.events.mux({ rpcId: mintRpcId('t-mux'), payload: {} }, abort.signal)) {
      frames.push(envelope.payload)
      envelopes.push(envelope)
      for (let i = waiters.length - 1; i >= 0; i -= 1) {
        const waiter = waiters[i] as (typeof waiters)[number]
        if (waiter.type === envelope.payload.type) {
          waiters.splice(i, 1)
          waiter.resolve(envelope.payload)
        }
      }
    }
  })()
  return {
    frames,
    envelopes,
    waitFor: (type) => {
      const found = frames.find(frame => frame.type === type)
      if (found !== undefined) return Promise.resolve(found)
      return new Promise((resolve) => { waiters.push({ type, resolve }) })
    },
  }
}

function requestedOf(frame: MuxFrame): Extract<MuxFrame, { type: 'approval/requested' }> {
  if (frame.type !== 'approval/requested') throw new Error(`expected approval/requested, got ${frame.type}`)
  return frame
}

function answer(
  rpcId: RpcId,
  sessionId: unknown,
  approvalId: ApprovalRequestId,
  outcome: 'allowed-once' | 'rejected',
  remember?: boolean,
): Parameters<ApiProxy['respond']>[0] {
  return {
    type: 'client-response',
    rpcId,
    result: { ok: true, value: { sessionId, approvalId, outcome, ...(remember === undefined ? {} : { remember }) } },
  }
}

async function settle(frame: Promise<MuxFrame>): Promise<MuxFrame | undefined> {
  return Promise.race([
    frame,
    new Promise<undefined>(resolve => setTimeout(() => { resolve(undefined) }, 30)),
  ])
}

describe('durable grants over the proxy approval channel', () => {
  it('persists a remembered grant before settling allowed-once', async () => {
    const { ctx, api, fake } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const agent = agentOf(ctx)

    const asked = ctx.approval.request({ agent, toolName: 'tool-bash', reason: 'remember me' })
    const requested = requestedOf(await mux.waitFor('approval/requested'))
    await api.respond(answer(mux.envelopes.find(e => e.payload.type === 'approval/requested')!.rpcId, requested.sessionId, requested.approvalId, 'allowed-once', true))

    await expect(asked).resolves.toBe('allowed-once')
    expect(fake.granted).toEqual([{ workspaceId: '/ws', toolName: 'tool-bash', reason: 'remember me' }])
  })

  it('answers from an existing grant without asking the user', async () => {
    const { ctx, api, fake } = await harness()
    fake.preGranted = true
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const agent = agentOf(ctx)

    const asked = ctx.approval.request({ agent, toolName: 'tool-bash' })
    await expect(asked).resolves.toBe('allowed-once')
    await expect(settle(mux.waitFor('approval/requested'))).resolves.toBeUndefined()
    expect(fake.granted).toEqual([])
  })

  it('does not persist a grant for a rejected remember answer', async () => {
    const { ctx, api, fake } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const agent = agentOf(ctx)

    const asked = ctx.approval.request({ agent, toolName: 'tool-bash' })
    const requested = requestedOf(await mux.waitFor('approval/requested'))
    await api.respond(answer(mux.envelopes.find(e => e.payload.type === 'approval/requested')!.rpcId, requested.sessionId, requested.approvalId, 'rejected', true))

    await expect(asked).resolves.toBe('rejected')
    expect(fake.granted).toEqual([])
  })
})
