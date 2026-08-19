# Agent Note：桌面剪贴板写入改走主进程桥

Status: implemented

[English](2026-08-17-desktop-clipboard-rides-main-process.md) | 中文

## Problem

打包版桌面应用里的复制按钮提示成功但什么都没写：Electron 沙箱渲染进程里 `navigator.clipboard.writeText` 会正常 resolve 却不触碰系统剪贴板，共享的 `writeClipboard` 助手因此谎报成功，用户剪贴板原样不变。

## Decision

preload 通过白名单 IPC 通道（`clipboard:write-text`）暴露由主进程 Electron `clipboard` 模块支撑的 `clipboard.writeText` 桥。`writeClipboard` 在桌面 preload 存在时优先走该桥，其他宿主（Web、jsdom）保持原有异步 Clipboard API 与 `execCommand` 回退。

## Verification

- 单元测试固定桥优先、拒绝处理与 Web 回退。
- 真实 UI 点击 diff 复制按钮后，系统剪贴板出现 diff 正文（用 `Get-Clipboard` 验证）。

## Alternatives considered

**给渲染进程授剪贴板权限。** 该渲染 API 在此沙箱配置下是静默空操作；主进程本来就是桌面拥有的系统能力边界。

## Consequences

所有走 `writeClipboard` 的复制控件在打包版中都会写入真实内容；Web 与 jsdom 宿主保持原有路径。
