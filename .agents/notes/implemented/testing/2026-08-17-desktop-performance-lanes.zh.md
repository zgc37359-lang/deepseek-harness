# Agent Note：桌面流式与主线程性能通道

Status: implemented

[English](2026-08-17-desktop-performance-lanes.md) | 中文

## Problem

`scripts/perf-smoke.mjs` 只把关冷启动与主进程峰值内存；流式与主线程响应性没有桌面通道：无法证明打包版应用能通过进程内 runtime 真实流式输出模型回复，也没有事件循环漂移与渲染帧率的测量。

## Decision

`apps/desktop` 新增两个探针模式与两个门禁：

- `--bench-stream "<task>"` 不建窗口直接启动桌面 runtime，通过 `ctx.agents` 创建全新 Agent（与 `dsh-headless` 相同的驱动形态），把任务作为普通用户消息提交，等待完全停稳后 flush Session，并输出首 token 延迟（首个非空 text delta）、输出字符/分片数、提供方 output tokens、总时长与每秒字符数。`scripts/bench-stream.mjs` 启动无 key 的 `dsh-llm-mock-server`（端口 0，`--repeat-last` 让会话标题等后续调用也能成功），把 `DEEPSEEK_BASE_URL`/`DEEPSEEK_API_KEY` 指向它，启动打包版 exe 并按预算把关。
- `--perf-test` 用自重新调度的 `setTimeout` 滴答（标称 16 ms）测量主进程事件循环漂移，并在同一窗口内统计渲染进程 `requestAnimationFrame` 回调数。`scripts/perf-test.mjs` 启动打包版 exe，把关 p95 漂移与平均帧率。

指标折叠函数是带确定性单元测试的纯函数，runner 时钟可注入。预算来自 Windows 实测基线并留有裕量，不是编造数字：p95 漂移 50 ms（基线约 31.5 ms）、平均帧率下限 30（基线约 120）、首 token 2000 ms（基线 110 ms）、总耗时 5000 ms（基线 118 ms）、吞吐 100 chars/s（基线约 568）。

## Verification

- 单元测试 `apps/desktop/tests/bench-stream.spec.ts` 与 `apps/desktop/tests/perf-test.spec.ts` 通过红绿循环覆盖折叠函数与可注入漂移采样器。
- 本机打包版实测：perf-test p95 31.5 ms / 120 FPS，退出码 0；bench-stream 首 token 110 ms、总耗时 118 ms、67 字符 / 9 分片、568 chars/s、reason `completed`。
- `windows-desktop.yml` 以以上预算运行两个脚本。

## Alternatives considered

**用 Playwright 驱动可见窗口聊天自动化。** 覆盖完整 UI 路径，但易抖、慢且依赖聊天 DOM；进程内 Agent 通道以确定性方式测量同一条 runtime/LLM 线上路径，可见窗口 E2E 已经覆盖 UI 挂载。

**用 `dsh --profile headless` 当基准。** 那测的是 CLI 组合，不是桌面 runtime、IPC 与打包闭包；对桌面通道否决。

## Consequences

流式与主线程预算现在有本地门禁并被 CI 跟踪。`--bench-stream` 需要打包版应用与仓库内置 mock 服务器；mock 不需要网络或凭据。剩余边界：预算是单机基线；CI 作业会暴露 runner 差异，等 windows-desktop 工作流积累历史后可再收紧。
