# Agent Note: Content-sourced thinking tags are routed to the reasoning block

Status: implemented

English | [中文](2026-08-18-thinking-tags-in-content-defense.zh.md)

## Problem

DeepSeek thinking-mode models intermittently stream their chain of thought into `delta.content` wrapped in `<thinking>` tags instead of (or in addition to) `reasoning_content`. The harness faithfully recorded that text channel, so the thinking appeared in the visible assistant message and, when the model stopped after the thinking, replaced the answer entirely. Because the leaked text was recorded as assistant content, history replay fed it back to the model, which then imitated the pattern (observed in 16 message rows across three sessions on 2026-08-18).

## Decision

`packages/llm/llm-deepseek/src/translate.ts` treats a content stream that BEGINS with `<thinking>` (case-insensitive, leading whitespace tolerated) as a leaked thinking block: the segment up to the matching `</thinking>` routes into the reasoning block, and everything after the close tag back into text. Tag boundaries may split across SSE fragments; an unclosed open tag keeps the rest of the stream in the reasoning block. The open-tag rule is deliberately leading-only, so mid-text literals such as code examples quoting `<thinking>` stay text.

Fragments that merely continue text `reasoning_content` already recorded are dropped (the model streams the same CoT into both channels), tracked by the content stream's position inside the reasoning block; the block never duplicates the same text from both channels in the common reasoning-first order.

`packages/llm/llm-deepseek/src/serialize.ts` additionally strips a leading `<thinking>` segment from assistant text blocks at replay time (`stripLeadingThinking`), so history recorded before the translate fix never feeds the leak back into the next request. Old session logs are not rewritten; the UI may still show already-recorded leaked text in old conversations.

## Verification

`translate.spec.ts` covers closed / unclosed / split-tag / whitespace-prefixed / case-variant streams, the reasoning_content echo dedup, and mid-text literals staying text; `serialize.spec.ts` pins `stripLeadingThinking` and the replay wire content. All existing translate/serialize cases still pass.

## Alternatives considered

**Prompt-level suppression.** Telling the model not to emit `<thinking>` in content is unverifiable and model-version dependent; the harness must handle it wherever it happens.

**Rendering-side strip.** Filtering the text at the UI would hide the leak but leave the session log and the model-facing replay polluted, keeping the imitation loop alive.

## Consequences

New turns render thinking exclusively in the Think disclosure row; model-facing history is clean for new and old sessions alike. Reasoning recorded through `reasoning_content` is unaffected. The dedup is one-directional (content echoes reasoning); the mirrored order (content-sourced thinking first, then an identical `reasoning_content` echo) is not deduplicated, an accepted limitation of the observed streaming order.
