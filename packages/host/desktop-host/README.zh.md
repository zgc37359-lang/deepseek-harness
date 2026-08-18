# @deepseek-ai/dsh-desktop-host

[English](README.md) | 中文

Electron 应用的进程内桌面宿主。它在无传输网关上提供 `ctx.desktopHost`：unary/respond 复用 `toFetchHandler`，mux/host 下行流直接来自 `apiProxy.events`，boot manifest 是把 bundle URL 改写为 `dsh-bundle://bundle` 协议的 `clientModules` 图。导出的 `DesktopWebServerStub` 满足 client-modules node 半侧的 `webServer` 注入但从不监听，因此桌面 profile 不启动任何 HTTP 服务器。

## Model Experience

无；桌面宿主只在渲染进程与 Web 部署所用的同一批宿主服务之间搬运已组合好的协议消息。

## Known Limitations and Deferred Work

- 桌面组合禁用 web 传输行（`webserver`、`web-runtime`、`web-startup`），并保留 `connection` 行但使用桌面配置（`trustedHosts: []`、不带 `webRuntime` 注入），使浏览器 `connection` 服务存在，而其 node 半侧只在惰性 stub 上注册。
- 宿主 HTTP 专属面还没有 IPC 对应：Cordis runner 的 inspect/inventory 端点与 `/plugins/events` SSE 流在桌面宿主中暂无应答。
- 客户端 bundle 必须在 modules 扫描前构建；与 Web 部署相同的 `pnpm run build` 前置要求适用。
