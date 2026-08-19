# Agent Note：流式工具调用缺 name 视为畸形响应

Status: implemented

[English](2026-08-17-nameless-tool-call-is-malformed.md) | 中文

## Problem

一次真实网关运行流式返回了一个工具调用，其 `name` 从未到达（arguments 到了）。`BlockAssembler` 把它组装成空名字的工具调用，循环派发了 `unknown tool ""`，随后空名块被写回历史；网关以 `400 INVALID_REQUEST: missing field name` 拒绝重试请求，整轮以混乱的级联失败收场，而不是一个清晰的协议错误。

## Decision

`BlockAssembler.finish` 现在会在“有内容的工具调用”（由 `block-end` 闭合，或带有 id/arguments）组装出来却没有名字时，推导出 `MALFORMED_RESPONSE: tool call missing name`。提供方自有的终态原因（`error`、`aborted`、`max-tokens`）仍然优先。只有 `block-start` 而无任何 delta 的空块不算工具调用，保持正常 finish。agent 循环走既有 request-error 路径，因此不会派发空名工具调用，也不会把被污染的历史写回。

## Verification

- 新增 assembler 单元测试固定畸形推导、显式错误优先、以及命名工具调用无回归路径（红绿循环）。
- assembler 属性测试按新契约更新；llm 197 项测试全过。
- 真实网关证据：失败会话的 `tool/call` 为 `name: ""`；改动后该流以清晰的 `MALFORMED_RESPONSE` 结束，而不是 `unknown tool ""` 加 400 重试。

## Alternatives considered

**在 deepseek 适配器里拒绝。** 只修一个提供方，pi-ai 等其他适配器仍有同样漏洞；assembler 是唯一共享组装点。

**静默丢弃空名工具调用。** 会掩盖提供方 bug，并让模型以为工具真的执行了；大声报协议错误才是诚实的表面。

## Consequences

畸形的工具调用流以单一稳定错误码快速失败，不再派发未知工具或污染历史。网关的畸形调用仍会使该轮失败（`MALFORMED_RESPONSE` 不自动重试），但错误现在具体明确，会话仍可重放。
