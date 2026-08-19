# Agent Note: content 中的思考标签路由进 reasoning 块

Status: implemented

[English](2026-08-18-thinking-tags-in-content-defense.md) | 中文

## Problem

DeepSeek 思考模式模型会间歇性地把思维链以 `<thinking>` 标签形式写进 `delta.content`（替代或叠加 `reasoning_content`）。harness 忠实记录了该文本通道，导致思考出现在可见的助手消息里；当模型在思考后停止时，思考甚至完全取代了回答。由于泄漏文本以助手 content 形式记录，历史回放会把它再次喂给模型，模型随后模仿该模式（2026-08-18 在三个会话的 16 条消息行中观察到）。

## Decision

`packages/llm/llm-deepseek/src/translate.ts` 将「以 `<thinking>` 开头（大小写不敏感、容忍前导空白）的 content 流」视为泄漏的思考块：直到匹配 `</thinking>` 之前的片段路由进 reasoning 块，闭合标签之后的内容回到 text。标签边界可能跨 SSE 分片；未闭合的开标签使流剩余部分保持为 reasoning。开标签规则刻意只识别「开头」，因此正文中引用 `<thinking>` 的字面量（如代码示例）保持为 text。

与已记录的 `reasoning_content` 完全衔接的片段会被丢弃（模型会把同一段 CoT 同时流进两个通道），以 content 流在 reasoning 块内的位置跟踪；在常见的 reasoning 先行顺序下，块不会重复来自两个通道的同一文本。

`packages/llm/llm-deepseek/src/serialize.ts` 还在回放时剥离助手 text 块开头的 `<thinking>` 段（`stripLeadingThinking`），使修复前录制的历史不会把泄漏再次喂进下一次请求。旧会话日志不回写；旧对话中已记录的泄漏文本仍可能在 UI 中显示。

## Verification

`translate.spec.ts` 覆盖闭合/未闭合/跨分片/前导空白/大小写变体、与 reasoning_content 回声去重、以及正文字面量保持 text；`serialize.spec.ts` 固化 `stripLeadingThinking` 与回放的 wire content。既有 translate/serialize 用例全部保持通过。

## Alternatives considered

**提示词层面抑制。** 让模型不要在 content 中输出 `<thinking>` 不可验证且随模型版本漂移；harness 必须在任何出现位置兜底。

**渲染侧剥离。** 在 UI 过滤文本可以隐藏泄漏，但会话日志与模型侧回放仍然被污染，模仿循环不会被打破。

## Consequences

新轮次的思考只显示在 Think 折叠行中；新旧会话的模型侧历史都干净。经 `reasoning_content` 记录的思考不受影响。去重是单向的（content 回声 reasoning）；镜像顺序（content 思考先行、随后相同的 `reasoning_content` 回声）不去重，这是对观察到的流式顺序的可接受限制。
