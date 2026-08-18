# Agent Note: 桌面 IPC 传输取代 localhost Web 面

Status: implemented

[English](2026-08-17-desktop-ipc-surface.md) | 中文

## Problem

Web 客户端的连接层通过 localhost Web 服务器提供的 HTTP/SSE/WebSocket 访问宿主。Windows 桌面产品不能依赖 localhost HTTP 端口：端口会与其他软件冲突，网络面会扩大攻击面，进程清理也会变成独立的生命周期问题。

## Decision

`apps/desktop` 是 Electron 应用，main 进程在进程内承载完整的 Harness 插件树，且从不启动 webserver。渲染进程复用现有 React Web UI 及其 `AbstractApiClient` 接缝：`packages/client/connection` 中的桌面 carrier 用 Electron IPC 取代 HTTP/SSE/WebSocket——unary 调用与 `respond` 走 preload invoke 桥，`events.mux`/`events.host` 下行流由 IPC 推送帧驱动。信封解析、rpcId 校验与重连语义仍由基类承担。

`packages/host/desktop-host` 提供宿主侧：`DesktopHost` 经 `toFetchHandler` 路由 unary 调用，直接从 `apiProxy.events` 暴露两条下行流，并把 boot manifest 改写为 `dsh-bundle://` 协议。`DesktopWebServerStub` 满足 client-modules 注入契约但从不监听。渲染进程以 sandbox 运行，仅通过白名单 preload 桥访问能力；main 进程是唯一的系统能力入口（窗口、托盘、对话框、更新器、外部链接）。

桌面组合禁用 `webserver`、`web-runtime` 与 `web-startup`，但保留 `connection` 行并改用桌面配置（空 `trustedHosts`、无 `webRuntime` 注入）：其 node 半侧只在惰性 stub 上注册，client 半侧则提供所有浏览器插件依赖的 `connection` 服务。unary/respond 的 `AbstractApiClient` 面与通用 `connection.rpc` 通道都走同一个 preload 桥。客户端 boot 配置位于 `$DSH_HOME/profiles/desktop-cordis.yml`，使 `ctx.baseUrl` 锚定在扁平的 profiles `node_modules`；渲染进程 CSP 允许 `unsafe-eval`，因为 vendored Loader 与 schemastery 需要求值配置表达式。

## Verification

Carrier 契约测试钉住 IPC 信封、自动 carrier 选择与通用 RPC 桥；打包应用通过 Playwright 窗口 E2E：启动 runtime、挂载完整 Web UI 壳，并断言 boot manifest 非空。没有 IPC 对应的纯 HTTP 宿主面（Cordis runner inspect/inventory、`/plugins/events`）仍以已知缺口记录在日志中。

## Alternatives considered

**Localhost HTTP MVP。** 用 Electron 包住 `dsh web` 最快，但仍保留端口、进程与网络攻击面的生命周期问题；正式产品路线否决。

**Tauri/WebView2 + Node sidecar。** runtime 仍需要 Node，sidecar 无法避免，还会多一个进程与 Rust 面；Electron 保持单一进程树并复用现有 React 客户端。

**渲染进程向 main 的 HTTP 端点 fetch。** 这是在 loopback 上再造网络协议，没有收益；IPC 是原生桥，carrier 接缝本已隔离传输层。

## Consequences

桌面应用不持有端口，也没有网络监听。渲染进程只信任白名单 IPC 面，所有原生能力归 main 进程。进程内 boot 用与 Web 面相同的 manifest 组合客户端 bundle，UI 行为保持单一实现。打包应用必须携带完整插件闭包，包括仅 peer 可达的包——参见[扁平化生产闭包说明](../process/2026-08-17-desktop-flat-production-closure.md)。浏览器下行语义仍由 [WebSocket 下行载体说明](2026-08-04-websocket-downlink-carrier.md)负责。
