# @deepseek-ai/dsh-grants

[English](README.md) | 中文

桌面审批流的持久化按工作区工具授权。`ctx.grants` 把记录持久化到 `desktop-grants` settings 命名空间，并暴露 `list` / `grant` / `revoke` / `check`。纯记录代数位于 `./records`，让审批面与设置面共享同一行为。

## Model Experience

无；授权是宿主侧策略事实。消费授权的审批适配器（以及 Settings 撤销面）是下一增量。

## Known Limitations and Deferred Work

- 写入是 last-write-wins，没有 expected-revision 防护；并发的外部 settings 编辑可能被覆盖。
- `grants/changed` 只是进程内日志事件；授权的创建/使用/撤销的持久化会话级审计事件暂缓。
