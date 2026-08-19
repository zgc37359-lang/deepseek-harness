# Agent Note：桌面桥接入共享 connection RPC 链

Status: implemented

[English](2026-08-17-desktop-bridge-rides-shared-rpc-chain.md) | 中文

## Problem

桌面宿主把所有客户端 unary 调用直接打进 apiProxy 的 unary 表，因此所有 Remote 端点（commands/list、goals/*、插件清单、cordis-runner、消息反馈）都返回 404：web 组合里这些端点由共享 `/api` connection RPC 链上的 Typert 网关拦截器先认领，之后才是 unary 回退；桌面桥绕过了这条链。所有由 Remote 支撑的 UI 控件都静默失效（斜杠/命令菜单、插件清单、插件配置详情）。

## Decision

`DesktopHost` 注入 `connection` 服务，并组合与 web 传输相同的共享 fetch handler：`connection.createSharedFetchHandler('/api', { fetch: toFetchHandler(apiProxy) })`。Typert 网关认领的 Remote 端点经它派发；其余回退 unary 表。请求使用 loopback 权威（`http://127.0.0.1/api/...`），因为桥是 IPC 本地，信任栅栏把 loopback 视为可信。

## Verification

- 两个新单元测试（红绿循环）：Remote 端点由 connection 链服务；普通方法仍回退 unary handler。
- 打包版：经 IPC 桥调用 `commands/list` 返回六条宿主命令；斜杠菜单渲染它们；设置里的插件清单面板不再报之前的 `dynamicCordisRunner` 错误；点插件行能打开配置表单。

## Alternatives considered

**在 desktop-host 里复制网关派发。** 会与 web 组合漂移；共享链才是唯一路由来源。

**起一个真实 loopback HTTP 服务。** 重新引入桌面 IPC 面要避免的端口/生命周期问题。

## Consequences

桌面面现在与 web 行为一致，所有 Remote 支撑的控件可用。剩余 HTTP-only 缺口收窄为 `/plugins/events`（可选的 client-modules 噪音）与 `host.listDirectory`（native 选择器只提供 `native` 能力）。
