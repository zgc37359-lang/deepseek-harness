# Agent Note: The DeepSeek adapter keeps the first tool-call name across continuation deltas

Status: implemented

English | [中文](2026-08-17-gateway-tool-name-continuation.zh.md)

## Problem

The OpenAI-compatible gateway repeated every tool-call continuation delta with
`function.name: ""`, and the DeepSeek translator overwrote the good name from
the first delta with the empty string. The assembled tool call dispatched as
`unknown tool ""`, and the empty-name call was then replayed in history,
making the gateway reject the retry with `400 INVALID_REQUEST: missing field
name`.

## Decision

`translate.ts` only records a tool-call name when it is non-empty, so the
first real name wins. Two supporting guards: `BlockAssembler` reports a
content-bearing nameless tool call as `MALFORMED_RESPONSE` instead of
dispatching it, and the DeepSeek history serializer skips empty-name tool
calls together with their orphaned results so an already-poisoned session can
continue.

## Verification

- Wire capture of the gateway stream shows first delta `name: "fs_search"`,
  continuation deltas `name: ""`; after the fix the assembled call keeps
  `fs_search`.
- Real UI run: a search prompt executed `grep`/`read` tool calls and the turn
  completed; the previously poisoned session sends without the 400.
- Unit tests: translator name-keeping, assembler malformed derivation,
  serializer skip, and property updates (llm-deepseek 154 tests, llm 197).

## Alternatives considered

**Rejecting empty names at the wire.** The name is available; discarding the
call would lose a legitimate tool invocation. Keeping the first non-empty
name is the correct interpretation of the stream.

## Consequences

Gateway relays that echo empty names on continuation deltas work unchanged,
and malformed streams fail with one stable code instead of cascading into a
400 on the next request.
