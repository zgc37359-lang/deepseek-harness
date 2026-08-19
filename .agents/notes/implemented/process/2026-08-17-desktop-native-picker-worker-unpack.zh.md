# Agent Note：打包版 Electron 以 Node 模式运行原生文件夹对话框 worker

Status: implemented

[English](2026-08-17-desktop-native-picker-worker-unpack.md) | 中文

## Problem

打包版桌面应用中 `host.pickDirectory` 报错“win32 folder dialog worker exited before reporting a result”。`win32-dialog-host.ts` 用 `process.execPath` 拉起 worker 脚本，但打包版 Electron 的 `process.execPath` 是应用可执行文件：这样会二次启动应用（在单实例锁处退出），而不是运行 worker。普通 Node 子进程也无法读取 `app.asar` 内的 worker。

修好启动后，选择目录仍会以 `napi_get_last_error_info` 致命错误崩溃：`readUtf16` 用固定 32 KiB 窗口去读 COM 显示名分配之外的内存，koffi 3.1 不允许越过分配读内存。

## Decision

`dsh-host-directory-picker-native` 通过应用可执行文件旁的 `resources/app.asar` 检测打包 Electron 环境（单看 execPath 不可靠，因为 profiles 回退可能把插件树解析进开发目录），并改用另一种方式拉起 worker：应用可执行文件以 `ELECTRON_RUN_AS_NODE=1` 启动，从而作为普通 Node 运行。worker 路径在模块从 `app.asar` 内加载时取 asar-unpacked 副本（electron-builder 的 `asarUnpack`，覆盖 picker 包、`koffi` 与 `@koromix` 平台二进制）；模块经开发目录解析时取真实的磁盘同名文件。启动三元组与路径决策都是带测试的纯函数。

字符串读取改用 `koffi.decode.string16(ptr)`——koffi BigInt 指针受支持的 NUL 结尾 UTF-16 读取器；固定窗口的 `koffi.view` 路径已删除。

## Verification

- 新增单元测试固定打包版启动三元组（unpacked worker 路径加 `ELECTRON_RUN_AS_NODE`）。
- 打包版探针：以 run-as-node 模式启动 exe 并传入 unpacked worker，收到 `{kind:'showing',threadId}`——koffi/COM 加载成功、对话框线程已启动。
- 打包版应用的文件夹选择器随后能打开原生对话框（用户验证）。
- 自动化真实选择：通过 UI Automation 驱动对话框并选择 `D:\deepseek-harness`，worker 返回 `{kind:'done',path:"D:\\deepseek-harness"}`，退出码 0，无崩溃。

## Alternatives considered

**用 Electron `dialog.showOpenDialog` 做桌面选择器后端。** 原生且更简单，但需要新增桌面后端行并替换服务；共享 koffi worker 已经实现该 seam，只是打包与启动方式坏了。保留共享实现。

**内置真实 Node 二进制。** 过于笨重且没必要，因为 Electron 本身可以当作 Node 运行。

## Consequences

桌面包增加了 unpacked 的 picker 与 koffi 文件；共享 worker 在 web/CLI 面上仍由普通 Node 运行。今后任何由打包应用内 spawn 的 worker 加载的原生模块，都必须遵循同样的 unpack 加 `ELECTRON_RUN_AS_NODE` 模式。
