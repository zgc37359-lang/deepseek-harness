# Agent Note：DeepSeek 适配器保留首个工具调用名，忽略续写分片里的空名

Status: implemented

[English](2026-08-17-gateway-tool-name-continuation.md) | 中文

## Problem

OpenAI 兼容网关在每个工具调用续写分片里都重复 `function.name: ""`，DeepSeek 翻译器用空串覆盖了首个分片里的正确名字。组装出的工具调用以 `unknown tool ""` 派发，空名调用随后被写回历史，网关以 `400 INVALID_REQUEST: missing field name` 拒绝重试。

## Decision

`translate.ts` 只在 name 非空时记录，首个真实名字胜出。另加两道防线：`BlockAssembler` 把有内容的无名工具调用报告为 `MALFORMED_RESPONSE` 而不是派发；DeepSeek 历史序列化器跳过空名工具调用及其孤儿结果，让已经被污染的会话可以继续。

## Verification

- 网关流抓包显示首分片 `name: "fs_search"`、续写分片 `name: ""`；修复后组装结果保留 `fs_search`。
- 真实 UI 运行：搜索提示执行了 `grep`/`read` 工具调用且轮次完成；此前被污染的会话发消息不再 400。
- 单元测试：翻译器保名、assembler 畸形推导、序列化器跳过、属性测试更新（llm-deepseek 154 项、llm 197 项）。

## Alternatives considered

**在线路上拒绝空名。** 名字其实存在；丢弃调用会损失一次合法工具调用。保留首个非空名字才是对流的正确解读。

## Consequences

在续写分片里回显空名的网关中继无需改动即可工作；畸形流以单一稳定错误码失败，不再级联成下一次请求的 400。
