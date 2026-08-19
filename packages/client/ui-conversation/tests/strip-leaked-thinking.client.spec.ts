import { describe, expect, it } from 'vitest'
import { stripLeakedThinking } from '../src/client/chat/strip-leaked-thinking.ts'

describe('stripLeakedThinking', () => {
  it('removes a leading closed thinking segment', () => {
    expect(stripLeakedThinking('<thinking>leak</thinking>answer')).toBe('answer')
  })

  it('tolerates leading whitespace before the tag', () => {
    expect(stripLeakedThinking('  <thinking>x</thinking>\nanswer')).toBe('\nanswer')
  })

  it('is case-insensitive', () => {
    expect(stripLeakedThinking('<THINKING>x</THINKING>y')).toBe('y')
  })

  it('keeps mid-text literals untouched', () => {
    expect(stripLeakedThinking('look <thinking> mid')).toBe('look <thinking> mid')
  })

  it('keeps plain text untouched', () => {
    expect(stripLeakedThinking('plain answer')).toBe('plain answer')
  })

  it('keeps an unclosed leading segment intact (never drops the answer tail)', () => {
    expect(stripLeakedThinking('<thinking>unclosed, answer follows')).toBe('<thinking>unclosed, answer follows')
  })

  it('keeps a leading segment whose close tag never arrives but text follows', () => {
    expect(stripLeakedThinking('<thinking>thinking only')).toBe('<thinking>thinking only')
  })
})
