# @deepseek-ai/dsh-desktop

[English](README.md) | 中文

DeepSeek Harness Web UI 之上的 Windows 桌面应用壳。该应用拥有 Electron 壳：无边框窗口配完全自定义标题栏、托盘生命周期、单实例与白名单 IPC 桥。main 进程在进程内承载完整 Harness 插件树；渲染进程在自定义标题栏下方挂载现有 Web UI，并通过桌面 IPC 传输（unary 调用加下行事件流）与 runtime 通信，不启动 localhost HTTP 服务器。

## Commands

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build
pnpm --filter @deepseek-ai/dsh-desktop run smoke
pnpm --filter @deepseek-ai/dsh-desktop run start
pnpm --filter @deepseek-ai/dsh-desktop run dist
pnpm --filter @deepseek-ai/dsh-desktop run dist:flat
pnpm --filter @deepseek-ai/dsh-desktop run perf:test
pnpm --filter @deepseek-ai/dsh-desktop run bench:stream
```

`smoke` 启动隐藏窗口，等待 preload ping，打印 `DESKTOP_SMOKE_OK` 后退出；无需显示交互。

`dist` 运行常规 electron-builder 流程（适用于具备完整原生工具链的机器）。`dist:flat` 是本仓库可复现的打包路径：[scripts/flatten-deps.mjs](scripts/flatten-deps.mjs) 构建 hoisted 生产 `node_modules`（解引用所有 workspace 符号链接，包括 `@deepseek-ai/cordis-plugin-group` 这类仅 peer 可达的包），再由 [electron-builder.flat.yml](electron-builder.flat.yml) 打成 `dist-app2/` 下的 NSIS 安装器与 `latest.yml` 更新清单。直接用 Node 运行；避免 `pnpm exec electron-builder`，因为 pnpm 11 会在 exec 前运行依赖状态检查，本工作区无 TTY 时直接中止。

`perf:test` 对打包版运行 [scripts/perf-test.mjs](scripts/perf-test.mjs)，把关事件循环漂移（p95）与渲染帧率。`bench:stream` 运行 [scripts/bench-stream.mjs](scripts/bench-stream.mjs)：启动可脚本化 mock LLM 服务器，驱动打包版桌面 runtime 跑一次真实 Agent 会话，把关首 token 延迟与吞吐。

## Known Limitations

- Win11 悬停 snap-layout 浮层在自定义最大化按钮上不可用；边缘拖拽吸附与 Win+方向键仍可用。
- 自定义窗口菜单的移动/缩放使用 main 进程光标循环，尚无自动化测试覆盖。
- 打包构建跳过原生重建（`npmRebuild: false`）。`node-pty` 在打包版中直接加载其 N-API 预编译二进制（由打包版 `--pty-probe` 验证）；当前发布的闭包无需按 Electron ABI 重建。
- 安装器与可执行文件未签名（未配置代码签名证书），并使用默认 Electron 图标。
- `electron-updater` 已接线（经 IPC 检查/下载/安装），但只有 GitHub Releases 上存在签名版本后更新源才有意义。`scripts/perf-smoke.mjs` 把关冷启动与主进程峰值内存，`scripts/perf-test.mjs` 把关事件循环漂移（p95）与渲染帧率，`scripts/bench-stream.mjs` 借助 mock LLM 服务器把关首 token 延迟与吞吐。预算来自 Windows 实测基线并留有裕量。
- 渲染进程 CSP 允许 `unsafe-eval`，因为 vendored Cordis Loader 与 schemastery 需要求值配置表达式；渲染进程仍保持 sandbox，main 进程仍是系统能力边界。
- Cordis runner 的 inspect/inventory 端点与 `/plugins/events` 仅存在于宿主 HTTP 面，桌面尚无 IPC 对应；在可见窗口 E2E 中它们会记录错误，直到桌面宿主面补齐。
