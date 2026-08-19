import { describe, expect, it } from 'vitest'
import { BlockAssembler, EMPTY_RESPONSE_CODE, LlmError } from '@deepseek-ai/dsh-llm'
import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { DONE } from '../src/sse.ts'
import { mapFinishReason, mapUsage, translate } from '../src/translate.ts'

async function* feed(...payloads: (string | object)[]): AsyncGenerator<string> {
  for (const payload of payloads) {
    yield typeof payload === 'string' ? payload : JSON.stringify(payload)
  }
}

async function collect(stream: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const out: StreamChunk[] = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

/** The live first-chunk signature: role + null content + EMPTY reasoning. */
const firstChunk = { choices: [{ delta: { role: 'assistant', content: null, reasoning_content: '' } }] }

describe('translate: text', () => {
  it('streams a text block and defers finish to DONE', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: 'Hel' } }] },
      { choices: [{ delta: { content: 'lo' } }] },
      { choices: [{ delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 2 } },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'Hel' },
      { type: 'text-delta', index: 0, text: 'lo' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'Hello' } },
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('assembles into the message BlockAssembler expects', async () => {
    const assembler = new BlockAssembler()
    for await (const chunk of translate(feed(
      firstChunk,
      { choices: [{ delta: { content: 'hi' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    ))) {
      assembler.push(chunk)
    }
    const result = { message: assembler.message(), finish: assembler.finish }
    expect(result.message.content).toEqual([{ type: 'text', text: 'hi' }])
    expect(result.finish).toEqual({ kind: 'stop' })
  })
})

describe('translate: reasoning', () => {
  it('does NOT open a reasoning block for the empty first-chunk signature', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: 'plain' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    expect(chunks.some(chunk => chunk.type === 'block-start' && chunk.blockType === 'reasoning')).toBe(false)
  })

  it('streams reasoning then text as separate blocks', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: null, reasoning_content: 'think' } }] },
      { choices: [{ delta: { content: null, reasoning_content: 'ing' } }] },
      { choices: [{ delta: { content: 'answer', reasoning_content: null } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'think' },
      { type: 'reasoning-delta', index: 0, text: 'ing' },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'answer' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'thinking' } },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'answer' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('treats an entirely absent reasoning_content field as non-thinking', async () => {
    const chunks = await collect(translate(feed(
      { choices: [{ delta: { role: 'assistant', content: 'x' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    expect(chunks.filter(chunk => chunk.type === 'block-start')).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
    ])
  })
})

describe('translate: tool calls', () => {
  it('reassembles a tool call from fragmented argument deltas (live capture shape)', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_00_x', type: 'function', function: { name: 'get_weather', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"city"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ': "Paris"}' } }] } }] },
      { choices: [{ delta: { content: '' }, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 28, completion_tokens: 6 } },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: 'call_00_x', name: 'get_weather', argumentsDelta: '' },
      { type: 'tool-call-delta', index: 0, id: 'call_00_x', name: 'get_weather', argumentsDelta: '{"city"' },
      { type: 'tool-call-delta', index: 0, id: 'call_00_x', name: 'get_weather', argumentsDelta: ': "Paris"}' },
      {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: 'call_00_x', name: 'get_weather', arguments: '{"city": "Paris"}' },
      },
      { type: 'usage', usage: { inputTokens: 28, outputTokens: 6 } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
  })

  it('disambiguates parallel tool calls by wire index', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      {
        choices: [{
          delta: {
            tool_calls: [
              { index: 0, id: 'a', type: 'function', function: { name: 'one', arguments: '{}' } },
              { index: 1, id: 'b', type: 'function', function: { name: 'two', arguments: '' } },
            ],
          },
        }],
      },
      { choices: [{ delta: { tool_calls: [{ index: 1, function: { arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    const ends = chunks.filter(chunk => chunk.type === 'block-end')
    expect(ends).toEqual([
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'a', name: 'one', arguments: '{}' } },
      { type: 'block-end', index: 1, block: { type: 'tool-call', id: 'b', name: 'two', arguments: '{}' } },
    ])
  })

  it('keeps the first tool-call name when continuation deltas carry an empty name', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_00_x', type: 'function', function: { name: 'fs_search', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: '', arguments: '{"pattern":' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: '', arguments: '"x"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))

    const deltas = chunks.filter(chunk => chunk.type === 'tool-call-delta')
    for (const delta of deltas) {
      if (delta.type === 'tool-call-delta') {
        expect(delta.name).toBe('fs_search')
      }
    }
    expect(chunks.at(-2)).toEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: 'call_00_x', name: 'fs_search', arguments: '{"pattern":"x"}' },
    })
  })

  it('keeps the first tool-call id when continuation deltas carry an empty id', async () => {
    // The oxc transform mis-parses single-quoted strings that start with a
    // brace in object-literal value position, so JSON fragments ride variables.
    const emptyId = ''
    const jsonStart = '{"pattern":'
    const jsonEnd = '"x"}'
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_00_x', type: 'function', function: { name: 'fs_search', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: emptyId, function: { arguments: jsonStart } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: emptyId, function: { arguments: jsonEnd } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))

    const deltas = chunks.filter(chunk => chunk.type === 'tool-call-delta')
    for (const delta of deltas) {
      if (delta.type === 'tool-call-delta') {
        expect(delta.id).toBe('call_00_x')
      }
    }
    expect(chunks.at(-2)).toEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: 'call_00_x', name: 'fs_search', arguments: '{"pattern":"x"}' },
    })
  })

  it('keeps the first tool-call id when a continuation delta carries a null id', async () => {
    const jsonStart = '{"path":'
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_00_y', type: 'function', function: { name: 'read_file', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: null, function: { arguments: jsonStart } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    const end = chunks.at(-2)
    expect(end).toEqual({
      type: 'block-end',
      index: 0,
      block: { type: 'tool-call', id: 'call_00_y', name: 'read_file', arguments: '{"path":' },
    })
  })

  it('interleaves text and tool-call blocks with distinct indices', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: 'Checking.' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', type: 'function', function: { name: 'f', arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    const starts = chunks.filter(chunk => chunk.type === 'block-start')
    expect(starts).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
    ])
  })
})

describe('translate: finish and usage handling', () => {
  it('takes usage from a trailing usage-only chunk (docs shape)', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: 'x' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: null },
      { choices: [], usage: { prompt_tokens: 9, completion_tokens: 1 } },
      DONE,
    )))
    expect(chunks.at(-2)).toEqual({ type: 'usage', usage: { inputTokens: 9, outputTokens: 1 } })
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('last usage wins when both attached and trailing arrive', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } },
      { choices: [], usage: { prompt_tokens: 2, completion_tokens: 2 } },
      DONE,
    )))
    const usage = chunks.find(chunk => chunk.type === 'usage')
    expect(usage).toEqual({ type: 'usage', usage: { inputTokens: 2, outputTokens: 2 } })
  })

  it('defaults to finish stop when no finish_reason ever arrives', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: 'x' } }] },
      DONE,
    )))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('omits the usage chunk when none arrived', async () => {
    const chunks = await collect(translate(feed(firstChunk, DONE)))
    expect(chunks.some(chunk => chunk.type === 'usage')).toBe(false)
  })

  it('handles chunks with no choices at all', async () => {
    const chunks = await collect(translate(feed({}, DONE)))
    expect(chunks).toEqual([{
      type: 'finish',
      reason: {
        kind: 'error',
        failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
      },
    }])
  })

  it('reports a truncation hint when usage shows output tokens but choices were empty', async () => {
    const chunks = await collect(translate(feed(
      { choices: [], usage: { prompt_tokens: 877, completion_tokens: 34 } },
      DONE,
    )))
    const finish = chunks.at(-1)
    expect(finish).toEqual({
      type: 'finish',
      reason: {
        kind: 'error',
        failure: {
          message: 'model response was truncated after 34 output tokens with no content (thinking may have been cut off)',
          code: EMPTY_RESPONSE_CODE,
        },
      },
    })
  })

  it('classifies an explicit stop with no opened blocks as EMPTY_RESPONSE, after usage', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 7, completion_tokens: 0 } },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'usage', usage: { inputTokens: 7, outputTokens: 0 } },
      {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message: 'model returned a completed response with no content', code: EMPTY_RESPONSE_CODE },
        },
      },
    ])
  })

  it('keeps a reasoning-only stream a successful stop (any opened block counts)', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: null, reasoning_content: 'mull' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'stop' } })
  })

  it('leaves non-stop finishes unclassified even with no opened blocks', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: {}, finish_reason: 'length' }] },
      DONE,
    )))
    expect(chunks.at(-1)).toEqual({ type: 'finish', reason: { kind: 'max-tokens' } })
  })
})

describe('translate: errors', () => {
  it('throws MALFORMED_RESPONSE for invalid JSON payloads', async () => {
    await expect(collect(translate(feed('{bad json')))).rejects.toThrow(LlmError)
    await expect(collect(translate(feed('{bad json')))).rejects.toThrow(/malformed SSE payload/)
  })

  it('throws STREAM_CLOSED when the payload source ends without DONE', async () => {
    await expect(collect(translate(feed(firstChunk)))).rejects.toThrow(/without \[DONE\]/)
  })
})

describe('mapFinishReason', () => {
  it.each([
    ['stop', { kind: 'stop' }],
    ['tool_calls', { kind: 'tool-calls' }],
    ['length', { kind: 'max-tokens' }],
  ])('maps %s', (wire, expected) => {
    expect(mapFinishReason(wire)).toEqual(expected)
  })

  it.each(['content_filter', 'insufficient_system_resource', 'mystery_reason'])(
    'maps %s to an error kind with the wire code',
    (wire) => {
      expect(mapFinishReason(wire)).toEqual({
        kind: 'error',
        failure: { message: `model stopped: ${wire}`, code: wire.toUpperCase() },
      })
    },
  )
})

describe('mapUsage', () => {
  it('maps the full live-capture shape', () => {
    expect(mapUsage({
      prompt_tokens: 283,
      completion_tokens: 69,
      prompt_cache_hit_tokens: 256,
      prompt_cache_miss_tokens: 27,
      prompt_tokens_details: { cached_tokens: 256 },
      completion_tokens_details: { reasoning_tokens: 24 },
    })).toEqual({
      // 283 wire prompt_tokens minus the 256 cached → 27 uncached input
      // (TokenUsage counts are disjoint).
      inputTokens: 27,
      outputTokens: 69,
      cacheReadTokens: 256,
      reasoningTokens: 24,
    })
  })

  it('falls back to prompt_cache_hit_tokens when details are absent', () => {
    expect(mapUsage({ prompt_tokens: 10, completion_tokens: 2, prompt_cache_hit_tokens: 8 }))
      .toEqual({ inputTokens: 2, outputTokens: 2, cacheReadTokens: 8 })
  })

  it('omits optional fields when the wire omits them', () => {
    expect(mapUsage({ prompt_tokens: 10, completion_tokens: 2 }))
      .toEqual({ inputTokens: 10, outputTokens: 2 })
  })
})

describe('translate: defensive tool-call branches', () => {
  it('handles deltas that never carry id or name (empty-string fallbacks)', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      // Hypothetical lenient wire: argument fragments with no id/name at all.
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: '', argumentsDelta: '{}' },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: '', name: '', arguments: '{}' } },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
  })

  it('handles tool_call deltas with a function object but no arguments field', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', type: 'function', function: { name: 'f' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    expect(chunks[1]).toEqual({ type: 'tool-call-delta', index: 0, id: 'c', name: 'f', argumentsDelta: '' })
  })

  it('handles tool_call deltas with no function object at all', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c' }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
      DONE,
    )))
    expect(chunks[1]).toEqual({ type: 'tool-call-delta', index: 0, id: 'c', argumentsDelta: '' })
  })
})
describe('translate: thinking-tag defense in content', () => {
  it('routes a leading <thinking> segment to the reasoning block and keeps the answer as text', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: '<thinking>I see the iss' } }] },
      { choices: [{ delta: { content: 'ue.</thinking>Answer' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'I see the iss' },
      { type: 'reasoning-delta', index: 0, text: 'ue.' },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'Answer' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'I see the issue.' } },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'Answer' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('keeps an unclosed leading <thinking> segment entirely in the reasoning block', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: '<thinking>only thinking' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'only thinking' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'only thinking' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('handles tags split across content fragments', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: '<thi' } }] },
      { choices: [{ delta: { content: 'nking>think</thi' } }] },
      { choices: [{ delta: { content: 'nking>done' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'think' },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'done' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think' } },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'done' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('dedupes a content echo when reasoning_content already carried the same text', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: null, reasoning_content: 'same' } }] },
      { choices: [{ delta: { content: '<thinking>same</thinking>answer' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'same' },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'answer' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'same' } },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'answer' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('leaves a mid-text <thinking> literal as ordinary text', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: 'look at <thinking> this' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'look at <thinking> this' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'look at <thinking> this' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('matches the tags case-insensitively', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: '<THINKING>x</THINKING>y' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'x' },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'y' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'x' } },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'y' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })

  it('emits late text after an unclosed leading thinking segment (no answer starvation)', async () => {
    const longLeak = 'p'.repeat(9000)
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: '<thinking>' + longLeak } }] },
      { choices: [{ delta: { content: 'Here is the answer.' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    const text = chunks.filter(chunk => chunk.type === 'text-delta').map(chunk => chunk.text).join('')
    expect(text).toBe('Here is the answer.')
    const reasoning = chunks.filter(chunk => chunk.type === 'reasoning-delta').map(chunk => chunk.text).join('')
    expect(reasoning).toBe(longLeak)
  })

  it('ignores leading whitespace before the open tag', async () => {
    const chunks = await collect(translate(feed(
      firstChunk,
      { choices: [{ delta: { content: '\n<thinking>t</thinking>a' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      DONE,
    )))
    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 't' },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'a' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 't' } },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'a' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
  })
})
