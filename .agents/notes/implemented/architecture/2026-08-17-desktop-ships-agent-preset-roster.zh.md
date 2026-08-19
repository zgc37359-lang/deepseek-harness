# Agent Note：桌面组合自带 agent 预设目录

Status: implemented

[English](2026-08-17-desktop-ships-agent-preset-roster.md) | 中文

## Problem

选择文件夹后点击工作区无法打开会话：输入区仍停留在“选择工作区”姿态。宿主以 `agent-preset-not-found: preset "standard" not found (available: none)` 拒绝 `session.create`——web-app 组合声明了 `agent-presets` 名单行（默认 `standard`）但没有根目录，只有 `dsh` CLI 的 profile boot 会注入随安装自带的预设根；桌面 boot（`apps/desktop`）从未注入。

## Decision

`apps/desktop` 自带只读预设根（`config/agent-presets/`，从 CLI 自带根复制 `standard`/`code`/`cordis`/`minimal`），桌面 overlay 把 `agent-presets` 行补成 `default: standard` 加该根（`system` 信任）。打包路径把预设带进应用目录（`flatten-deps.mjs` 复制 `config/agent-presets`，electron-builder `files` 包含它们）。闭包里缺失的预设专用插件（`dsh-persona`、`dsh-tool-ask-user`、`dsh-terminal`、`dsh-tool-bash-persistent`、`dsh-tool-cordis`、`dsh-agent-tool-presentation`、`dsh-terminal-bash`）现为真实依赖。loader 的 profiles 回退解析器在 heal 出来的 junction 缺新包时，也会回退到应用自身 node_modules。

## Verification

- 经打包版 IPC 桥调用 `session.create` 返回 `{ok:true, value:{sessionId, agentPreset:"standard"}}`。
- 驱动渲染 UI：工作区选择器列出所选工作区，点击后打开会话，输入框变为可用（显示 hero 提示占位符，不再是“选择工作区”占位符）。
- 打包 smoke 仍以 `DESKTOP_SMOKE_OK` 退出 0。

## Alternatives considered

**通过开发目录复用 CLI 预设文件。** 在当前检出可用，但打包版没有该目录；桌面包必须自带副本。

**修 `healProfilesModuleFallback` 刷新陈旧 junction。** 动共享 boot 代码去处理打包锚点边缘，且仍不解决闭包缺预设包的问题；依赖与解析器修复才命中实际缺口。

## Consequences

桌面包拥有自己的预设目录，默认 agent 组合与 web 面一致。今后新增仅供预设使用的插件，需要加进 `apps/desktop` 依赖（闭包是事实来源）；解析器回退可防止 profiles junction 掩盖缺失链接。
