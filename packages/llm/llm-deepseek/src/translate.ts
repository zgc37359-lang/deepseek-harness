/**
 * Translate DeepSeek SSE payloads with one stateful harness block per content, reasoning, or tool
 * call index. An empty initial reasoning delta does not open a block. Finish reason and the latest
 * usage are deferred until `[DONE]`, covering both finish-attached and trailing usage-only shapes
 * while ensuring no chunk follows `finish`.
 *
 * Translate DeepSeek wire chunks into the harness `StreamChunk` protocol.
 * @module dsh-llm-deepseek/translate
 */

import { CallId, EMPTY_RESPONSE_CODE, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, FinishReason, StreamChunk, TokenUsage } from '@deepseek-ai/dsh-llm'
import { DONE } from './sse.ts'
import type { WireChunk, WireUsage } from './types.ts'

/** One open block under assembly. */
interface OpenBlock {
  index: number
  kind: 'text' | 'reasoning' | 'tool-call'
  text: string
  /** tool-call only */
  callId?: string
  name?: string
}

/** The open thinking tag the model occasionally leaks into delta.content. */
const OPEN_THINKING_TAG = '<thinking>'

/** The matching close tag. */
const CLOSE_THINKING_TAG = '</thinking>'

/**
 * Map the wire finish_reason vocabulary to the harness FinishReason.
 * @param reason - the wire `finish_reason` string.
 * @returns the mapped reason; unrecognized values (content_filter, …) become `{kind: 'error'}` with the uppercased value as `code`.
 */
export function mapFinishReason(reason: string): FinishReason {
  switch (reason) {
    case 'stop': return { kind: 'stop' }
    case 'tool_calls': return { kind: 'tool-calls' }
    case 'length': return { kind: 'max-tokens' }
    default:
      // content_filter, insufficient_system_resource, future additions.
      return {
        kind: 'error',
        failure: { message: `model stopped: ${reason}`, code: reason.toUpperCase() },
      }
  }
}

/**
 * Map wire usage fields. DeepSeek's `prompt_tokens` INCLUDES cache hits
 * (`prompt_tokens = prompt_cache_hit_tokens + prompt_cache_miss_tokens`,
 * api/create-chat-completion); the harness TokenUsage convention is
 * DISJOINT counts, so cache reads are subtracted out of `inputTokens`.
 * @param usage - wire usage from the finish chunk or the trailing usage-only chunk.
 * @returns disjoint harness counts; cache/reasoning fields present only when the wire reported them.
 */
export function mapUsage(usage: WireUsage): TokenUsage {
  const cacheRead = usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens
  const reasoning = usage.completion_tokens_details?.reasoning_tokens
  return {
    inputTokens: usage.prompt_tokens - (cacheRead ?? 0),
    outputTokens: usage.completion_tokens,
    ...cacheRead !== undefined ? { cacheReadTokens: cacheRead } : {},
    ...reasoning !== undefined ? { reasoningTokens: reasoning } : {},
  }
}

/** Assemble the final ContentBlock for one open block. */
function closeBlock(block: OpenBlock): ContentBlock {
  switch (block.kind) {
    case 'text': return { type: 'text', text: block.text }
    case 'reasoning': return { type: 'reasoning', text: block.text }
    case 'tool-call': return {
      type: 'tool-call',
      id: CallId(block.callId ?? ''),
      name: block.name ?? '',
      arguments: block.text,
    }
  }
}

/**
 * Consume SSE data payloads (ending with `[DONE]`) and yield StreamChunks.
 * Malformed JSON payloads abort the stream with `MALFORMED_RESPONSE`.
 * @param payloads - SSE data payloads from {@link parseSse}, `[DONE]`-terminated.
 * @returns deltas as they arrive; `block-end`s, `usage`, and `finish` are all deferred to the `[DONE]` sentinel.
 *   A `stop` (or absent) finish with no opened blocks is a degenerate provider completion and maps to an
 *   `EMPTY_RESPONSE` error finish instead of a successful empty message.
 */
export async function* translate(payloads: AsyncIterable<string>): AsyncGenerator<StreamChunk> {
  let nextIndex = 0
  let textBlock: OpenBlock | undefined
  let reasoningBlock: OpenBlock | undefined
  const toolBlocks = new Map<number, OpenBlock>()
  const order: OpenBlock[] = []
  let pendingFinish: FinishReason | undefined
  let pendingUsage: TokenUsage | undefined
  // Content-sourced thinking state: the model occasionally echoes its CoT
  // into delta.content wrapped in <thinking> tags. Only a content stream that
  // BEGINS with the open tag is treated as a leak; mid-text literals stay
  // text. contentThinkingPos is the content stream's position inside the
  // reasoning block, used to drop echoes of reasoning_content.
  let contentPending = ''
  let contentThinking = false
  let contentSawText = false
  let contentThinkingPos = 0

  function open(kind: OpenBlock['kind']): OpenBlock {
    const block: OpenBlock = { index: nextIndex++, kind, text: '' }
    order.push(block)
    return block
  }

  /** Length of the longest suffix of text that is a prefix of the close tag. */
  function partialCloseTagLength(text: string): number {
    const max = Math.min(text.length, CLOSE_THINKING_TAG.length)
    for (let k = max; k >= 1; k--) {
      const suffix = text.slice(-k).toLowerCase()
      if (CLOSE_THINKING_TAG.startsWith(suffix)) return k
    }
    return 0
  }

  /**
   * Append a content-sourced thinking fragment to the reasoning block,
   * dropping fragments that merely continue text reasoning_content already
   * recorded (the model streams the same CoT into both channels).
   */
  function* appendContentReasoning(text: string): Generator<StreamChunk> {
    if (text.length === 0) return
    if (reasoningBlock === undefined) {
      reasoningBlock = open('reasoning')
      yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
    }
    if (contentThinkingPos < reasoningBlock.text.length) {
      const expected = reasoningBlock.text.slice(contentThinkingPos)
      if (expected.startsWith(text)) {
        contentThinkingPos += text.length
        return
      }
    }
    reasoningBlock.text += text
    contentThinkingPos = reasoningBlock.text.length
    yield { type: 'reasoning-delta', index: reasoningBlock.index, text }
  }

  /** Append one visible text fragment, opening the text block on demand. */
  function* appendText(text: string): Generator<StreamChunk> {
    if (text.length === 0) return
    if (textBlock === undefined) {
      textBlock = open('text')
      yield { type: 'block-start', index: textBlock.index, blockType: 'text' }
    }
    textBlock.text += text
    yield { type: 'text-delta', index: textBlock.index, text }
  }

  for await (const payload of payloads) {
    if (payload === DONE) {
      // Flush any buffered content: an unclosed thinking segment or trailing
      // text that never resolved into a tag still belongs in the message.
      if (contentThinking) {
        yield* appendContentReasoning(contentPending)
      } else if (contentPending.length > 0) {
        yield* appendText(contentPending)
      }
      contentPending = ''
      for (const block of order) {
        yield { type: 'block-end', index: block.index, block: closeBlock(block) }
      }
      if (pendingUsage) yield { type: 'usage', usage: pendingUsage }
      const reason = pendingFinish ?? { kind: 'stop' as const }
      yield {
        type: 'finish',
        reason: reason.kind === 'stop' && order.length === 0
          ? {
            kind: 'error',
            failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
          }
          : reason,
      }
      return
    }

    let chunk: WireChunk
    try {
      chunk = JSON.parse(payload) as WireChunk
    } catch {
      throw new LlmError(`malformed SSE payload: ${payload.slice(0, 120)}`, 'MALFORMED_RESPONSE')
    }

    for (const choice of chunk.choices ?? []) {
      const delta = choice.delta

      // Reasoning first: thinking mode interleaves it before text. The
      // empty-string first chunk must not open a block.
      const reasoning = delta?.reasoning_content
      if (typeof reasoning === 'string' && reasoning.length > 0) {
        if (!reasoningBlock) {
          reasoningBlock = open('reasoning')
          yield { type: 'block-start', index: reasoningBlock.index, blockType: 'reasoning' }
        }
        reasoningBlock.text += reasoning
        yield { type: 'reasoning-delta', index: reasoningBlock.index, text: reasoning }
      }

      const content = delta?.content
      if (typeof content === 'string' && content.length > 0) {
        contentPending += content
        while (contentPending.length > 0) {
          if (!contentThinking) {
            if (contentSawText) {
              yield* appendText(contentPending)
              contentPending = ''
              continue
            }
            const trimmed = contentPending.replace(/^\s+/, '')
            const lower = trimmed.toLowerCase()
            if (lower.startsWith(OPEN_THINKING_TAG)) {
              contentThinking = true
              contentPending = trimmed.slice(OPEN_THINKING_TAG.length)
              continue
            }
            // A partial open tag at the stream start waits for more data.
            if (OPEN_THINKING_TAG.startsWith(lower) && trimmed.length < OPEN_THINKING_TAG.length) {
              break
            }
            contentSawText = true
            yield* appendText(contentPending)
            contentPending = ''
            continue
          }
          // Inside a content-sourced thinking block: find the close tag.
          const closeAt = contentPending.toLowerCase().indexOf(CLOSE_THINKING_TAG)
          if (closeAt !== -1) {
            yield* appendContentReasoning(contentPending.slice(0, closeAt))
            contentPending = contentPending.slice(closeAt + CLOSE_THINKING_TAG.length)
            contentThinking = false
            contentSawText = true
            if (contentPending.length > 0) {
              yield* appendText(contentPending)
              contentPending = ''
            }
            continue
          }
          // A close tag split across fragments: hold its partial tail back.
          const hold = partialCloseTagLength(contentPending)
          if (hold > 0) {
            yield* appendContentReasoning(contentPending.slice(0, contentPending.length - hold))
            contentPending = contentPending.slice(contentPending.length - hold)
            break
          }
          yield* appendContentReasoning(contentPending)
          contentPending = ''
        }
      }

      for (const call of delta?.tool_calls ?? []) {
        let block = toolBlocks.get(call.index)
        if (!block) {
          block = open('tool-call')
          toolBlocks.set(call.index, block)
          yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
        }
        // Some gateways repeat the tool-call id/name as "" or null on
        // continuation deltas; the non-empty first values must win.
        if (typeof call.id === 'string' && call.id.length > 0) {
          block.callId = call.id
        }
        if (typeof call.function?.name === 'string' && call.function.name.length > 0) {
          block.name = call.function.name
        }
        const fragment = call.function?.arguments ?? ''
        block.text += fragment
        yield {
          type: 'tool-call-delta',
          index: block.index,
          id: CallId(block.callId ?? ''),
          ...block.name !== undefined ? { name: block.name } : {},
          argumentsDelta: fragment,
        }
      }

      if (typeof choice.finish_reason === 'string') {
        pendingFinish = mapFinishReason(choice.finish_reason)
      }
    }

    // Usage may arrive attached to the finish chunk or as a trailing
    // usage-only chunk — keep the latest.
    if (chunk.usage) pendingUsage = mapUsage(chunk.usage)
  }

  // parseSse guarantees the [DONE] sentinel (or throws); reaching here means
  // the payload source violated that contract.
  throw new LlmError('SSE payload stream ended without [DONE]', 'STREAM_CLOSED')
}
