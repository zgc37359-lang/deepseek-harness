/**
 * Strip a leading <thinking>…</thinking> segment the model leaked into the
 * text channel before the display layer renders it. History recorded by
 * older builds (before the translate fix routed content-sourced thinking
 * into the reasoning block) can carry the CoT inside text blocks; the UI
 * should not show it as ordinary answer text. Only a segment that starts the
 * text (after whitespace) is removed; mid-text literals stay untouched, and
 * an unclosed segment stays intact so an answer tail is never dropped.
 * Mirrors the serialize-side {@link stripLeadingThinking} semantics.
 */

/**
 * Whether a leading leaked-thinking segment is present and closed.
 * @param text - the assistant text block content.
 * @returns the text without the leading leaked thinking segment.
 */
export function stripLeakedThinking(text: string): string {
  const open = text.match(/^\s*<thinking>/i)
  if (open === null) return text
  const afterOpen = text.slice(open[0].length)
  const close = afterOpen.search(/<\/thinking>/i)
  return close === -1 ? text : afterOpen.slice(close + '</thinking>'.length)
}
