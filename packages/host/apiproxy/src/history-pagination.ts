/**
 * Message-boundary pagination for session history windows.
 *
 * The message quota counts append-origin messages backwards from the window
 * tail; replacement copies never entered the conversation a reader sees, so
 * they consume no quota. Chunks group via `sourceEventSeqs` so a page never
 * cuts a message mid-way under the message quota alone.
 *
 * A single model turn can span thousands of chunk events (a long reasoning
 * trace or a large generated document), so a pure message quota would send
 * hundreds of thousands of events in one page. The soft event/byte caps
 * bound ordinary pages, and the cut ROLLS BACK to the containing message's
 * group start so a page never splits one message across two loads: a split
 * message merges invisibly in the client, which reads as a dead "load older"
 * button. Only a single message larger than the HARD caps is cut mid-message
 * (the newest events that fit); the client renders a window-gap divider
 * above it and pulls the preceding events through `loadOlder`.
 * @module @deepseek-ai/dsh-host-apiproxy/history-pagination
 */

import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

/** Event types that own one message slot in the history window quota. */
export const MESSAGE_TYPES = new Set(['user/message', 'assistant/message'])

/** Soft cap on events in one history page, regardless of message quota. */
export const MAX_PAGE_EVENTS = 8192

/** Soft approximate serialized-size cap (bytes) for one history page. */
export const MAX_PAGE_BYTES = 8 * 1024 * 1024

/**
 * Hard event ceiling: a message group larger than this cannot ride one page,
 * so the page falls back to a mid-message cut at the soft cap.
 */
export const HARD_PAGE_EVENTS = 32768

/** Hard serialized-size ceiling (bytes) for one page, mid-message fallback included. */
export const HARD_PAGE_BYTES = 32 * 1024 * 1024

/**
 * Slice one history page backwards from the window tail.
 * @param events - the full event log in seq order.
 * @param beforeSeq - exclusive older-page cut; absent reads the tail.
 * @param maxMessages - message quota (never cut mid-message within it).
 * @returns the page (contiguous seq range ending at the log tail) and
 *   whether older history remains outside the window.
 */
export function paginate(
  events: readonly SessionEvent[],
  beforeSeq: number | undefined,
  maxMessages: number,
): { events: SessionEvent[]; hasMore: boolean } {
  const window = beforeSeq === undefined ? [...events] : events.filter(event => event.seq < beforeSeq)
  const windowBase = window[0]?.seq ?? 0
  let messageCount = 0
  let eventCount = 0
  let pageBytes = 0
  let cut = 0
  let groupStart: number | undefined
  for (let i = window.length - 1; i >= 0; i--) {
    const event = window[i] as SessionEvent
    eventCount += 1
    pageBytes += Buffer.byteLength(JSON.stringify(event))
    const isMessage = MESSAGE_TYPES.has(event.type) && isAppendSurfaceEvent(event)
    if (isMessage) {
      messageCount += 1
      const sources = (event as { sourceEventSeqs?: number[] }).sourceEventSeqs
      groupStart = sources !== undefined && sources.length > 0 ? Math.min(event.seq, ...sources) : event.seq
    }
    const capHit = eventCount >= MAX_PAGE_EVENTS || pageBytes >= MAX_PAGE_BYTES
    if (isMessage && messageCount >= maxMessages && !capHit) {
      cut = groupStart ?? event.seq
      break
    }
    if (capHit) {
      // Prefer a message-aligned cut: include the whole containing group when
      // it still fits the HARD caps. Extra bytes are priced exactly over the
      // group's not-yet-counted events, so a huge single event cannot hide
      // behind the event ceiling.
      if (groupStart !== undefined) {
        const groupIndex = groupStart - windowBase
        const candidateEvents = window.length - groupIndex
        let extraBytes = 0
        for (let index = groupIndex; index < i; index++) {
          const candidate = window[index] as SessionEvent | undefined
          if (candidate !== undefined) extraBytes += Buffer.byteLength(JSON.stringify(candidate))
        }
        if (candidateEvents <= HARD_PAGE_EVENTS && pageBytes + extraBytes <= HARD_PAGE_BYTES) {
          cut = groupStart
          break
        }
      }
      // Mid-message cut (only for a group larger than the hard caps): the
      // client renders a window-gap divider above the partial message;
      // loadOlder pulls the preceding events.
      cut = event.seq
      break
    }
  }
  const page = window.filter(event => event.seq >= cut)
  return { events: page, hasMore: cut > 0 }
}
