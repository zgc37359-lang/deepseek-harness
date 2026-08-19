# Agent Note：Windows 沙箱 runner 在 Electron 下以纯 Node 启动

Status: implemented

[English](2026-08-17-desktop-sandbox-runner-electron-run-as-node.md) | 中文

## 问题

打包后的 Windows 桌面应用中，所有沙箱化 shell 命令都静默失效：`pwsh` 退出码为
0、stdout/stderr 全空、文件写入不落地，`exit 42` 探针也返回 0。只有
`danger-full-access`（无沙箱）正常。

## 根因

windows-acl 沙箱 runner 的启动参数是 `[process.execPath, runner.js]`。打包后的
Electron 应用里 `process.execPath` 是应用本体，而 runner 进程启动时没有带
`ELECTRON_RUN_AS_NODE=1`，于是这个“runner”实际是第二个应用实例，被单实例锁
立即退出——退出码 0、一个空行、没有沙箱、没有执行命令。独立 runner 和 dsh CLI
（`process.execPath` 是 `node`）都正常，所以只有打包应用出问题。

## 决策

`ConfinedArgv` 新增可选 `env`，由消费方合并进 spawn 环境。windows-acl 分支在
Electron 主进程下返回 `{ ELECTRON_RUN_AS_NODE: '1' }`；bash/pwsh 沙箱执行器与
bash 终端把它传入各自的 subprocess/pty spawn。runner 本身不变。

## 验证

- 应用外复现：`DeepSeek Harness.exe runner.js …` 退出 0 且只有空行；加上
  `ELECTRON_RUN_AS_NODE=1` 后返回真实输出。
- 桌面 UI 矩阵的工具调用步骤（Workspace Write 沙箱）现在能拿到真实 pwsh
  输出；沙箱探针在 Workspace Write 下返回 `sandbox-write-on`，Full access 下
  返回 `sandbox-full-off`。
- 类型检查通过；sandbox-local、shell 执行器与终端的测试在各自平台通道覆盖
  env 传递。

## 备选方案

**在桌面启动时设置 `ELECTRON_RUN_AS_NODE`。** 这只修桌面载体，还会静默改变
未来所有 `process.execPath` spawn；seam 改动让环境要求紧邻需要它的 runner。

## 影响

打包桌面应用中的沙箱 bash/pwsh 工具和沙箱终端现在真正执行命令。其他 runner
（bwrap、Landlock、Seatbelt）与纯 Node 宿主不受影响，因为它们不返回 `env`。
