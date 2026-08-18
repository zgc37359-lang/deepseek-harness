import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { HARD_PAGE_EVENTS, MAX_PAGE_BYTES, MAX_PAGE_EVENTS, paginate } from '../src/history-pagination.ts'

function message(seq: number, type: 'user/message' | 'assistant/message', data: unknown = {}): SessionEvent {
  return { seq, type, surfaceOp: 'append', data } as SessionEvent
}

function chunk(seq: number): SessionEvent {
  return { seq, type: 'assistant/chunk', data: { text: 'x' } } as SessionEvent
}

/** One user message + five chunks + one assistant message per message group. */
function messageGroup(firstSeq: number): SessionEvent[] {
  const events = [message(firstSeq, 'user/message')]
  for (let index = 1; index <= 5; index++) events.push(chunk(firstSeq + index))
  events.push(message(firstSeq + 6, 'assistant/message'))
  return events
}

describe('paginate', () => {
  it('keeps the newest maxMessages message groups when they fit the caps', () => {
    const events: SessionEvent[] = []
    for (let group = 0; group < 60; group++) events.push(...messageGroup(group * 7))
    const page = paginate(events, undefined, 50)
    expect(page.events).toHaveLength(175)
    expect(page.hasMore).toBe(true)
    expect(page.events[0]?.seq).toBe(245)
  })

  it('returns the whole tail with hasMore false when nothing precedes it', () => {
    const events: SessionEvent[] = []
    for (let group = 0; group < 25; group++) events.push(...messageGroup(group * 7))
    const page = paginate(events, undefined, 50)
    expect(page.events).toHaveLength(175)
    expect(page.hasMore).toBe(false)
  })

  it('rolls the cut back to the message boundary when the group fits the hard caps', () => {
    const events = [message(0, 'user/message')]
    for (let seq = 1; seq <= 12000; seq++) events.push(chunk(seq))
    events.push({ seq: 12001, type: 'assistant/message', surfaceOp: 'append', sourceEventSeqs: [1], data: {} } as SessionEvent)
    const page = paginate(events, undefined, 50)
    expect(page.events.length).toBe(12001)
    expect(page.events.length).toBeLessThanOrEqual(HARD_PAGE_EVENTS)
    expect(page.hasMore).toBe(true)
    // The page starts at the assistant message's first chunk (seq 1), never
    // mid-chunk, and the oldest user message is not part of it.
    expect(page.events[0]?.type).not.toBe('user/message')
    expect(page.events[0]?.seq).toBe(1)
  })

  it('cuts mid-message only when the group exceeds the hard caps', () => {
    const events = [message(0, 'user/message')]
    for (let seq = 1; seq <= 40000; seq++) events.push(chunk(seq))
    events.push({ seq: 40001, type: 'assistant/message', surfaceOp: 'append', sourceEventSeqs: [1], data: {} } as SessionEvent)
    const page = paginate(events, undefined, 50)
    expect(page.events.length).toBeLessThanOrEqual(MAX_PAGE_EVENTS)
    expect(page.hasMore).toBe(true)
    // The cut lands inside the chunk run; the oldest user message is absent.
    expect(page.events[0]?.type).not.toBe('user/message')
    expect(page.events[0]?.seq).toBeGreaterThan(1)
  })

  it('cuts by serialized bytes when one event exceeds the byte budget', () => {
    const events = [
      message(0, 'user/message'),
      message(1, 'assistant/message', { text: 'A'.repeat(MAX_PAGE_BYTES + 1) }),
    ]
    const page = paginate(events, undefined, 50)
    expect(page.events).toHaveLength(1)
    expect(page.hasMore).toBe(true)
  })

  it('honors beforeSeq for older pages', () => {
    const events: SessionEvent[] = []
    for (let group = 0; group < 60; group++) events.push(...messageGroup(group * 7))
    const first = paginate(events, undefined, 50)
    const cut = first.events[0]?.seq ?? 0
    const older = paginate(events, cut, 50)
    expect(older.events).toHaveLength(175)
    expect(older.events[0]?.seq).toBe(70)
    expect(older.events.at(-1)?.seq).toBe(cut - 1)
    expect(older.hasMore).toBe(true)
  })
})
