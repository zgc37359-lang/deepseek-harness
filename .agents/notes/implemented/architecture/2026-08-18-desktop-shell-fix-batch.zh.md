# Agent Note: 桌面壳修复批次——托盘、更新、日志、崩溃、协议

Status: implemented

[English](2026-08-18-desktop-shell-fix-batch.md) | 中文

## Problem

对打包版桌面应用的一次体验性测试发现十项缺陷：托盘「新建会话」事件没有渲染进程消费者；fork 安装包自动更新必然失败（publish 配置指向上游仓库）且 Web UI 挂载后更新入口消失；Windows 保留设备名的下载报成功却生成不可用文件；`main.log` 无限增长；渲染进程崩溃两次后窗口静默死亡；畸形 `dsh-bundle` URL 可能在协议处理器内抛异常；占位页 manifest 轮询 30 秒后放弃；包 src 树中残留未跟踪的编译产物；以及每次启动重复记录一条 `fs.Stats` 弃用警告。

## Decision

- **托盘新建会话**：渲染进程订阅 `tray:new-session` 并执行 `activateNewSession`（`src/renderer/tray-actions.ts`）——优先点击侧栏新建会话按钮（完整的创建+打开流程），失败回退 `session.create` RPC。
- **更新**：`build.publish` 改指向 `zgc37359-lang/deepseek-harness`；`updateStatusText` 移入 `src/shared/update-status.ts`；标题栏新增常驻更新入口（状态文案、检查更新、下载完成时重启安装）。
- **下载**：`sanitizeDownloadFilename` 为 Windows 保留基名加前缀（CON/PRN/AUX/NUL/COM1-9/LPT1-9，大小写不敏感、含带扩展名形式），并归一化结尾点/空格（`src/ipc-validation.ts`）。
- **日志轮转**：`src/main-log.ts` 按大小轮转（`DSH_DESKTOP_LOG_MAX_BYTES` 默认 10 MiB；`DSH_DESKTOP_LOG_KEEP` 默认 3）。
- **崩溃恢复**：`src/crash-policy.ts` 预算两次自动重载，之后主进程推送新通道 `shell:renderer-crashed`；`src/renderer/crash-overlay.tsx` 提供「重新加载」恢复面。
- **协议健壮性**：`src/bundle-request.ts` 防御式解码并返回 404 而非抛异常。
- **manifest 轮询**：`src/renderer/manifest-poller.ts` 以 500 ms → 2 s 退避持续轮询直到运行时挂载，组件卸载时中止。
- **仓库卫生**：删除 `packages/client/connection/src` 中残留的 tsc 产物并加入 .gitignore。
- **启动警告**：`fs.Stats constructor is deprecated.` 源自 Electron 运行时内嵌 Node（纯 Node 无法复现、所有依赖源码中不存在）；主进程警告处理器现按不同消息各记录一次。
- **E2E**：`scripts/e2e-window.mjs` 新增隔离模式（`DSH_E2E_ISOLATED=1`：临时 userData + DSH_HOME + 跳过 API-Key 引导步骤的 dummy key、无运行实例守卫），并断言标题栏更新入口、托盘新建会话流程、渲染崩溃恢复。

## Alternatives considered

**所有恢复面都用原生对话框。** 对话框不依赖渲染进程，但崩溃覆盖层用原生模态会绕开应用自身样式，也无法提供应用内恢复流程；崩溃状态查询让渲染进程保持为唯一 UI 面。

**无界自动重载。** 无限重载会掩盖失败并可能导致崩溃循环；有界预算加覆盖层给用户一个明确的恢复路径。

## Verification

每项修复均 TDD 先行：`ipc-validation`、`crash-policy`、`bundle-request`、`main-log`、`update-status`、`manifest-poller`、`tray-actions` 单测，以及 `CrashOverlay` 与 `TitleBar` 更新入口的 jsdom 组件测试（根 vitest include 扩展为 `apps/*/tests/**/*.spec.tsx`）。扩展后的 `e2e-window` 门禁在隔离模式下对打包 exe 通过。

## Consequences

壳现在对每次崩溃和每种更新状态都可见；日志有界；下载不再产生保留名幽灵文件；本地 e2e 门禁可在实例运行中旁路测试而不触碰其数据。fork feed 现已发布 `v0.1.0-rc.7` 桌面版（semver 标签 + 安装包资产），启动检查对当前版本解析为「已是最新版本」，对新版本提供下载；代码签名仍待配置（SmartScreen）。同一发布周期内桌面基线已前移到上游 rc.7。思考防御（另见独立 note）之前的旧会话，历史中可能仍显示泄漏的 `<thinking>` 文本。
