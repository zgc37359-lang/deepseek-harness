import { describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { runStreamBenchmark, summarizeStreamBenchmark } from '../src/bench-stream.ts'

/** Build one session event with the given seq/time and data. */
function event<T extends SessionEvent['type']>(
  seq: number,
  time: number,
  type: T,
  data: SessionEvent<T>['data'],
): SessionEvent {
  return { seq, time, type, data } as SessionEvent
}

describe('summarizeStreamBenchmark', () => {
  it('measures first token latency, output size, and usage from the owned interval', () => {
    const events = [
      event(0, 100, 'turn/start', { turn: 1 }),
      event(1, 120, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'reasoning-delta', index: 0, text: 'think' },
      }),
      event(2, 140, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: '' },
      }),
      event(3, 160, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'Hello' },
      }),
      event(4, 200, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: ' world' },
      }),
      event(5, 300, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: 'Hello world' }], source: { provider: 'mock', model: 'mock' } },
        usage: { inputTokens: 10, outputTokens: 4 },
      }),
      event(6, 400, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]

    const result = summarizeStreamBenchmark(events, 110, 400)

    expect(result.firstTokenMs).toBe(50)
    expect(result.outputChars).toBe(11)
    expect(result.chunkCount).toBe(3)
    expect(result.outputTokens).toBe(4)
    expect(result.totalMs).toBe(290)
    expect(result.charsPerSecond).toBeCloseTo(37.93, 1)
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('completed')
  })

  it('reports no first token and failure when the stream never produced text', () => {
    const events = [
      event(0, 100, 'turn/start', { turn: 1 }),
      event(1, 150, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'reasoning-delta', index: 0, text: 'think' },
      }),
      event(2, 300, 'turn/end', {
        turn: 1,
        reason: { kind: 'error', error: { code: 'E_MOCK', message: 'boom' } },
      }),
    ]

    const result = summarizeStreamBenchmark(events, 100, 300)

    expect(result.firstTokenMs).toBeNull()
    expect(result.outputChars).toBe(0)
    expect(result.chunkCount).toBe(0)
    expect(result.outputTokens).toBeNull()
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('error')
  })
})

describe('runStreamBenchmark', () => {
  it('creates an agent, submits the task, and reports the owned interval', async () => {
    const events = [
      event(0, 100, 'turn/start', { turn: 1 }),
      event(1, 130, 'assistant/chunk', {
        turn: 1,
        step: 1,
        chunk: { type: 'text-delta', index: 0, text: 'ok' },
      }),
      event(2, 200, 'assistant/message', {
        turn: 1,
        step: 1,
        message: { content: [{ type: 'text', text: 'ok' }], source: { provider: 'mock', model: 'mock' } },
      }),
      event(3, 250, 'turn/end', { turn: 1, reason: { kind: 'completed' } }),
    ]
    const followupCalls: unknown[] = []
    const fakeAgent = {
      whenIdle: async () => {},
      followup: (message: unknown) => { followupCalls.push(message) },
      session: { seq: 0, events },
    }
    const ctx = {
      get: (key: string): unknown => {
        switch (key) {
          case 'loader':
            return { await: async () => {} }
          case 'agents':
            return {
              create: async (options: { setup?: (agentCtx: unknown) => unknown }) => {
                await options.setup?.({ on: () => () => {} })
                return { agent: fakeAgent }
              },
            }
          case 'agentDefaultModel':
            return { currentSelection: () => ({ provider: 'mock', model: 'mock' }) }
          case 'sessions':
            return { flush: async () => {} }
          default:
            return undefined
        }
      },
    } as unknown as Context

    const result = await runStreamBenchmark(ctx, 'bench task', () => 100)

    expect(followupCalls).toHaveLength(1)
    const message = followupCalls[0] as { content: Array<{ type: string; text: string }> }
    expect(message.content[0]).toEqual({ type: 'text', text: 'bench task' })
    expect(result.firstTokenMs).toBe(30)
    expect(result.ok).toBe(true)
    expect(result.reason).toBe('completed')
  })
})
