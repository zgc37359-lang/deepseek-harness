# Agent Note: A streamed tool call without a name is a malformed response

Status: implemented

English | [中文](2026-08-17-nameless-tool-call-is-malformed.zh.md)

## Problem

A real gateway run streamed a tool call whose `name` never arrived (the
arguments did). `BlockAssembler` assembled it as a tool call with an empty
name, the loop dispatched `unknown tool ""`, and the empty-name block was then
written back into history; the gateway rejected the retry request with
`400 INVALID_REQUEST: missing field name`, failing the whole turn with a
confusing cascade instead of one clear protocol error.

## Decision

`BlockAssembler.finish` now derives `MALFORMED_RESPONSE: tool call missing
name` when a content-bearing tool call (closed by `block-end`, or carrying an
id or arguments) assembled without a name. Provider-owned terminal reasons
(`error`, `aborted`, `max-tokens`) still win. A bare `block-start` with no
deltas is not a tool call and keeps the normal finish. The agent loop takes
the existing request-error path, so no empty-name tool call is dispatched and
no poisoned history is written.

## Verification

- New assembler unit tests pin the malformed derivation, the explicit-error
  precedence, and the named-tool-call no-regression path (red-green).
- The assembler property suite was updated for the new contract; 197 llm
  tests pass.
- Real gateway evidence: the failing session's `tool/call` had `name: ""`;
  after this change the stream ends as a clear `MALFORMED_RESPONSE` instead
  of `unknown tool ""` plus a 400 retry.

## Alternatives considered

**Rejecting in the deepseek adapter.** Provider-specific and leaves pi-ai and
other adapters with the same hole; the assembler is the single shared
assembly point.

**Dropping the nameless tool call silently.** Would hide a provider bug and
make the model believe a tool ran; a loud protocol error is the honest
surface.

## Consequences

Malformed tool-call streams fail fast with one stable code instead of
dispatching an unknown tool and poisoning history. The gateway's malformed
call still fails the turn (no automatic retry for `MALFORMED_RESPONSE`), but
the error is now specific and the session stays replayable.
