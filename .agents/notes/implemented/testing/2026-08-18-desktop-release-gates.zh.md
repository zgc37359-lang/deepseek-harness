# Agent Note：桌面发布门禁与 IPC 校验提取

Status: implemented

[English](2026-08-18-desktop-release-gates.md) | 中文

## 问题

桌面壳随附性能门禁（冷启动、内存、事件循环、帧率、首 token），但没有功能、压力、安装与输入校验覆盖：60 步 UI 矩阵与压力通道只是本地脚本，NSIS 安装/升级/卸载路径零自动化覆盖，且每个 IPC 参数检查都内联在 `main.ts` 里，任何测试都够不到。CI 根本无法运行交互门禁：它们需要无 key runner 所没有的真实模型后端。

## 决策

- **无 key 交互门禁。** 新增 `scripts/mock-llm.mjs`：在临时端口启动仓库内置的可脚本化 mock LLM 服务器，并通过 Playwright 的 `env` 选项把 `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL` 注入打包应用。`ui-matrix.mjs` 与 `stress-test.mjs` 使用它：存在真实 `DEEPSEEK_API_KEY` 时沿用真实 provider，否则 mock 按各通道断言所需的固定文本回复（矩阵为 `seed-ok matrix-ok button-ok`；压力通道为 `burst-ok` 加 120 行 `line-N`）。需要真实工具执行的步骤（`conversation:user-question`、`conversation:todo-panel`、`hero:stop-generation`）在 mock 下显式跳过。
- **安装循环门禁。** 新增 `scripts/install-cycle.mjs`：端到端驱动真实 NSIS 安装器——静默安装到临时目录、冒烟启动、本地源升级（generic provider，经 `DSH_DESKTOP_UPDATE_FEED_URL`，含损坏包错误路径）、静默卸载、残留断言（安装目录、开始菜单、HKCU 卸载键）并保留用户数据。任何 DeepSeek Harness 实例在运行时就拒绝执行：NSIS 安装器与卸载器会终止运行中同名实例，并无论目标目录如何都会改写开始菜单与注册表条目。该门禁在 `windows-desktop.yml` 的独立 hosted runner 上运行。
- **浸泡通道。** 新增 `scripts/soak-test.mjs`：在真实 UI 上对 mock LLM 驱动 N 轮对话，把关主进程 RSS 与句柄增长——单轮门禁看不到的泄漏由此捕获。
- **空闲 CPU 与句柄采样。** `perf-smoke.mjs` 增加句柄峰值；`perf-test.mjs` 在其可见窗口期间采样主进程 CPU 作为空闲基线。`--smoke-test` 在打出标记后立即退出，因此空闲 CPU 无法在那里测量。
- **IPC 校验提取。** 新增 `src/ipc-validation.ts`：集中所有白名单通道所需的纯参数检查（窗口菜单白名单、runtime unary 参数、下载文件名清洗、reveal 路径包含、剪贴板/流检查）。`main.ts` 只调用这些函数。`tests/ipc-validation.spec.ts` 中的 fuzz 矩阵覆盖畸形与边界输入，并抓到一个真实缺陷：reveal 路径检查用裸前缀匹配，放行了 `Downloads2` 这类兄弟目录。现在要求完全相等或路径分隔符边界。
- **本地崩溃收集。** `crashReporter.start({ uploadToServer: false })` 在 app ready 前运行，使每个渲染进程都受监控；转储落在 userData `crashDumps` 下，诊断导出在存在时一并拷贝。
- **CodeQL。** 新增 `codeql.yml`，只扫描桌面面（`apps/desktop`、`packages/host/desktop-host`、`packages/client/connection`）以保持在作业预算内。
- **Windows hosted 镜像。** `windows-2019`/`windows-2022` hosted 镜像已退役；安装循环作业使用 `windows-2025`。真正的 Win10 22H2 基线需要自托管 Win10 runner（延后）。

## 验证

- `tests/ipc-validation.spec.ts`（17 个测试）与 `tests/desktop-runtime.spec.ts`（8 个测试，订阅扇形分发）通过；桌面全套 34 个测试绿灯。
- `pnpm run typecheck` 在桌面应用上通过。
- `mock-llm.mjs` 启动、服务并关闭 mock 服务器（本地验证）；`isDesktopRunning()` 正确识别运行中的实例，三个 Playwright 门禁以明确信息拒绝而非静默单实例超时。
- 交互与安装门禁只是 `windows-desktop.yml` 中的 CI 信号（绝不参与 all-checks-passed 判定），并在全新 hosted runner 上运行，NSIS 副作用因此被限制在 runner 内。

## 备选方案

- **对 exe 做 WinAFL 风格模糊测试。** 输入面是 IPC 而非文件解析器；校验矩阵加既有 JSON schema 检查以远少得多的机制覆盖它。
- **在自托管 perf runner 上运行安装循环。** 否决：卸载器终止运行中实例并改写 product-name 资源，会污染共享 runner。
- **在单测中 mock Electron 测 main.ts。** 否决：需要测试的是移到 `ipc-validation.ts` 的纯检查；胶水层按设计保持薄且不测。

## 后果

- 全部八道桌面门禁现在都在 CI 中对打包 exe 运行；交互门禁无 key 可用。
- 安装循环门禁无法在存在运行实例或既有安装的开发机上运行——这是硬保护，不是便利跳过。
- 新 IPC 通道必须把参数检查加入 `ipc-validation.ts`（及 fuzz 矩阵），使 `main.ts` 不再内联校验。
