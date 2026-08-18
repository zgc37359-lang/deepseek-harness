import { performance } from 'node:perf_hooks'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { MAX_PAGE_EVENTS, paginate } from '../src/history-pagination.ts'

function message(seq: number, type: 'user/message' | 'assistant/message', data: unknown = {}): SessionEvent {
  return { seq, type, surfaceOp: 'append', data } as SessionEvent
}

function chunk(seq: number): SessionEvent {
  return { seq, type: 'assistant/chunk', data: { text: 'x' } } as SessionEvent
}

function messageGroup(firstSeq: number): SessionEvent[] {
  const events = [message(firstSeq, 'user/message')]
  for (let index = 1; index <= 5; index++) events.push(chunk(firstSeq + index))
  events.push(message(firstSeq + 6, 'assistant/message'))
  return events
}

describe('paginate scale gate', () => {
  it('bounds every page of a ~300k-event session and paginates in well under half a second', () => {
    const events: SessionEvent[] = []
    for (let group = 0; group < 20; group++) events.push(...messageGroup(group * 7))
    const base = events.length
    events.push(message(base, 'user/message'))
    for (let seq = base + 1; seq <= base + 40000; seq++) events.push(chunk(seq))
    events.push({
      seq: base + 40001,
      type: 'assistant/message',
      surfaceOp: 'append',
      sourceEventSeqs: [base + 1],
      data: {},
    } as SessionEvent)
    expect(events.length).toBeGreaterThan(40000)

    const started = performance.now()
    const tail = paginate(events, undefined, 50)
    const elapsed = performance.now() - started
    expect(tail.events.length).toBeLessThanOrEqual(MAX_PAGE_EVENTS)
    expect(tail.hasMore).toBe(true)
    expect(elapsed).toBeLessThan(500)

    // The older page lands inside the same oversized run and stays bounded.
    const older = paginate(events, tail.events[0]?.seq ?? 0, 50)
    expect(older.events.length).toBeLessThanOrEqual(MAX_PAGE_EVENTS)
  })
})
