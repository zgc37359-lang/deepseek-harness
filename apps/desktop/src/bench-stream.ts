/**
 * Desktop streaming benchmark: drive one fresh Agent through the in-process
 * Harness runtime against a mock LLM, then summarize the owned session
 * interval into first-token latency and throughput metrics.
 * @module @deepseek-ai/dsh-desktop/bench-stream
 */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
// Empty type import carries the loader Context merge for the settlement await.
import type {} from '@deepseek-ai/cordis-plugin-loader'

/** Metrics for one owned model-flow interval. */
export interface StreamBenchmarkResult {
  /** Whether the final turn completed instead of erroring or being cut short. */
  readonly ok: boolean
  /** The final `turn/end` reason kind, or `no-turn` when none was observed. */
  readonly reason: string
  /** Milliseconds from task submission to the first non-empty text delta, or null when none arrived. */
  readonly firstTokenMs: number | null
  /** Wall-clock duration from task submission to quiescence. */
  readonly totalMs: number
  /** Characters across every text delta in the owned interval. */
  readonly outputChars: number
  /** Number of text-delta chunks observed on the wire. */
  readonly chunkCount: number
  /** Provider-reported output tokens, or null when no usage event arrived. */
  readonly outputTokens: number | null
  /** Throughput: output characters per second. */
  readonly charsPerSecond: number
}

/**
 * Fold one owned session interval into benchmark metrics. The first text
 * delta (not reasoning deltas) defines first-token latency; empty deltas do
 * not count as a first token but still count as wire chunks.
 * @param events - the owned interval events, oldest first.
 * @param startedAt - submission wall-clock timestamp.
 * @param finishedAt - quiescence wall-clock timestamp.
 * @returns the derived metrics.
 */
export function summarizeStreamBenchmark(
  events: readonly SessionEvent[],
  startedAt: number,
  finishedAt: number,
): StreamBenchmarkResult {
  let firstTextTime: number | undefined
  let outputChars = 0
  let chunkCount = 0
  let outputTokens: number | undefined
  let reason: string | undefined
  for (const event of events) {
    if (event.type === 'assistant/chunk') {
      if (event.data.chunk.type === 'text-delta') {
        chunkCount += 1
        outputChars += event.data.chunk.text.length
        if (firstTextTime === undefined && event.data.chunk.text.length > 0) {
          firstTextTime = event.time
        }
      }
    } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      outputTokens = event.data.usage.outputTokens
    } else if (event.type === 'turn/end') {
      reason = event.data.reason.kind
    }
  }
  const totalMs = finishedAt - startedAt
  return {
    ok: reason === 'completed',
    reason: reason ?? 'no-turn',
    firstTokenMs: firstTextTime === undefined ? null : firstTextTime - startedAt,
    totalMs,
    outputChars,
    chunkCount,
    outputTokens: outputTokens ?? null,
    charsPerSecond: totalMs > 0 ? (outputChars / totalMs) * 1000 : 0,
  }
}

/**
 * Run one task through a freshly created Agent and return benchmark metrics.
 * Mirrors the headless one-shot driver: await the Loader, create an Agent
 * with the default model selection, submit the task as an ordinary user
 * message, wait for quiescence, and flush the Session.
 * @param ctx - the booted Harness root context.
 * @param task - the benchmark prompt text.
 * @param now - monotonic wall clock, injectable for deterministic tests.
 * @returns the derived stream metrics.
 */
export async function runStreamBenchmark(
  ctx: Context,
  task: string,
  now: () => number = Date.now,
): Promise<StreamBenchmarkResult> {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  if (agents === undefined || defaultModel === undefined || sessions === undefined) {
    throw new Error('bench-stream: agents, agentDefaultModel, and sessions services are required')
  }

  const selection = defaultModel.currentSelection()
  const { agent } = await agents.create({
    sessionId: SessionId(`bench-${randomUUID()}`),
    meta: { cwd: process.cwd() },
    agentOptions: { provider: selection.provider, model: selection.model },
    setup: (agentCtx) => {
      const selected: ModelSelectionRef = { current: selection, assembled: undefined }
      installModelSelection(agentCtx, selected)
    },
  })
  await agent.whenIdle()
  const firstSeq = agent.session.seq
  const startedAt = now()
  agent.followup(createUserMessage({
    content: [{ type: 'text', text: task }],
    source: { kind: 'user' },
  }))
  await agent.whenIdle()
  const finishedAt = now()
  await sessions.flush(agent.session)
  const owned = agent.session.events.filter(event => event.seq >= firstSeq)
  return summarizeStreamBenchmark(owned, startedAt, finishedAt)
}
