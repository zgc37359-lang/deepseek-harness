# dsh-desktop 生产发布测试体系落地计划

> 将通用 Windows exe 发布测试方法论（测试金字塔 / 分层自动化 / 质量门禁 / 兼容性矩阵）
> 映射到 `apps/desktop`（Electron 43 + TypeScript + vitest + Playwright）的具体现状。
> 每个条目标注：✅ 已有 / 🔶 部分有 / ❌ 缺失，并给出具体落地点（文件、脚本、workflow job）。

---

## 0. 现状盘点（已有测试资产）

| 层级 | 资产 | 位置 | CI 状态 |
|---|---|---|---|
| 单元测试 | update-controller 状态机、bench-stream 折叠函数、perf-test 漂移采样器；desktop-host 的 DesktopHost/manifest 重写（`desktop-host.spec.ts`、`manifest.host.spec.ts`） | `apps/desktop/tests/*.spec.ts` + `packages/host/desktop-host/tests/`（vitest，根配置收集 `apps/*/tests/**`） | ✅ 根 `pnpm run test` 运行（含 CI `check:ci:coverage` 的 vitest run）；⚠️ 覆盖率统计仅限 `packages/*/*/src`，apps/desktop/src 不计 |
| 集成/进程内 | `--smoke-test`（隐藏窗口+preload ping+runtime boot）、`--pty-probe`（node-pty 加载）、`--bench-stream`（mock LLM 全链路） | `src/main.ts` 隐藏命令 + `scripts/*.mjs` | ✅ windows-desktop.yml |
| GUI 功能 | `ui-matrix.mjs`（60 步交互矩阵，脚本实测 63 个 `step()` 调用，含 reset 辅助步骤） | `scripts/ui-matrix.mjs` | ❌ 仅本地（Agent Note 记录为本地门禁） |
| 压力 | `stress-test.mjs`（burst/大输出/快速会话/drift/内存 delta，预算：p95≤200ms、delta≤700MiB、零 console 错误） | `scripts/stress-test.mjs` | ❌ 仅本地 |
| 性能 | perf-smoke（冷启动/峰值内存）、perf-test（event-loop p95/FPS）、bench-stream（首 token/吞吐） | `scripts/*.mjs` + `src/perf-test.ts` | ✅ windows-desktop.yml，带预算 |
| E2E 可见窗口 | `e2e-window.mjs`（启动→标题栏→Web UI 挂载→加载断言→**2026-08 新增**：标题栏更新入口、托盘新建会话、渲染崩溃恢复（两次自动重载→覆盖层）→截图；支持 `DSH_E2E_ISOLATED=1` 隔离模式） | `scripts/e2e-window.mjs` | ✅ windows-desktop.yml |
| 静态/质量 | typecheck/lint/duplication/hygiene（knip+publint） | 根 scripts | ✅ ci.yml（`check:ci:static`） |
| 依赖漏洞 | Dependabot（npm 根 + python） | `.github/dependabot.yml` | ✅ |
| 签名 | 无 | — | ❌ |
| 安装/升级/卸载 | 无 | — | ❌ |
| 崩溃转储 | 无 crashReporter / WER | — | ❌ |
| 夜间流水线 | 无（workflow 只有 PR + workflow_dispatch） | `.github/workflows/windows-desktop.yml` | ❌ |
| CodeQL | 无 | — | ❌ |

---

## 1. 对照差距分析（按测试类型）

### 1.1 单元测试

**✅ 已有**：vitest 单测覆盖 update 状态机、bench/perf 纯函数。仓库规则 per-file 100% 覆盖率
门禁适用于 `packages/*/*/src`，**不覆盖 `apps/desktop/src`**。

**❌ 缺口**：
- `main.ts`（541 行）零单测：窗口状态持久化、IPC 参数校验、崩溃策略、shutdown 逻辑全是裸代码。
- `desktop-boot.ts`（overlay 组合）、`desktop-runtime.ts`（订阅扇形分发）、`preload.ts`（bridge）、
  `TitleBar.tsx`（菜单/拖拽状态机）零单测。
- 无覆盖率门禁约束 apps/desktop。

**落地**：
1. 按研究报告 E3 拆分 main.ts（window.ts / tray.ts / ipc.ts / protocol.ts），拆分出的纯逻辑
   （窗口状态序列化+显示器碰撞校验、IPC 入参校验、shutdown 决策）直接可测。
2. `desktop-runtime.ts` 的订阅分发（attach/detach/扇形）是纯逻辑，补 vitest 单测最划算。
3. 把 `apps/desktop/src/**/*.ts` 纳入覆盖率门禁（或先按文件加阈值豁免，逐步达标）。
   - 注意：main.ts 依赖 Electron，需把"可测内核"与"Electron 胶水"分开——可测内核不放
     `import 'electron'`，胶水层薄。
4. `--selftest` 等价物已有（`--smoke-test`/`--pty-probe`/`--bench-stream`/`--perf-test`），
   符合"exe 提供可脚本化测试命令"原则，保持并文档化。

### 1.2 集成测试

**✅ 已有**：`--pty-probe`（原生模块加载）、`--smoke-test`（进程内完整 boot）、
`--bench-stream`（真实 Agent 会话走 mock LLM）、desktop-host 走共享 RPC 链。

**❌ 缺口**（方法论强调的 Windows 特有场景）：
- **路径场景**：中文/空格/长路径/只读目录下的工作区打开、会话创建、下载保存
  （`downloadSave` 的路径清洗逻辑、`downloadReveal` 的前缀校验值得专项测）。
- **非管理员运行**：CI runner 是管理员；普通用户权限下 userData 写权限、安装目录只读
  场景未测。
- **区域设置**：非 Unicode 区域（如系统 locale 日语/德语）下日志、路径、UI 文案。
- **环境变量**：`DSH_DESKTOP_DEV_URL`、`ComSpec` 缺失等异常环境。

**落地**：
1. `e2e-window.mjs` 或新 `scripts/e2e-paths.mjs`：创建含中文+空格的临时目录作为工作区，
   驱动会话创建，断言成功；Downloads 目录同理。
2. 集成测试脚本支持注入 `--user-data-dir` 指向临时目录，保证隔离与可重复。

### 1.3 冒烟测试

**✅ 已有**：`--smoke-test` 每次构建可跑（隐藏窗口、preload ping、runtime boot、`DESKTOP_SMOKE_OK`），
perf-smoke 把关冷启动与内存。

**❌ 缺口**：
- 方法论要求"关闭后进程正常退出无残留"——当前 smoke 用 `app.exit(0)` 直接退，
  **不验证** shutdown 路径（`disposeDesktopRuntime` → 子进程清理）。
- e2e-window 已有加载断言（titlebar/web-ui-host/manifest 非空/title 文本）但**无交互断言、
  无退出验证**——启动后断言加载、截图即结束，不验证"操作→退出"闭环。

**落地**：
1. 新增 `--smoke-test` 变体或脚本断言：正常 `app.quit()` 后进程树无残留
   （PowerShell 枚举子进程，验证 shell/pty/subprocess 全部退出）。
2. e2e-window 增加"关闭窗口→进程退出"断言（现在 e2e 结束靠 `app.close()` 强杀）。

### 1.4 功能测试

**✅ 已有**：`ui-matrix.mjs` 60 步覆盖窗口控制/侧栏/会话/设置/对话/反馈/轨迹（有 Agent Note）。

**❌ 缺口**：**ui-matrix 和 stress-test 未进 CI**。这是最大的功能测试缺口——
Agent Note 明说"run locally and can be added to the Windows desktop workflow"，但至今没加。

**落地**：
1. **立即**把 `node scripts/ui-matrix.mjs` 和 `node scripts/stress-test.mjs` 加进
   `windows-desktop.yml`（预算已核实：stress p95≤200ms、内存 delta≤700MiB、零 console 错误）。
2. e2e-window 在**已有加载断言**基础上补"关键交互断言"（标题栏按钮、新建会话、主题切换）
   与"关闭→退出"断言——从"加载冒烟"升级为"加载 + 交互 + 退出"闭环。
3. GUI 选择器用 `aria-label`（已有）≈ AutomationId 原则，避免图像识别——保持。

### 1.5 性能测试

**✅ 已有**：冷启动（≤15s，实测 2.1s）、峰值内存（≤1GiB，实测 288MiB）、
event-loop p95（≤50ms，实测 31.6ms）、FPS（≥30，实测 120）、首 token（≤2s）、吞吐（≥100 chars/s）。

**❌ 缺口**（方法论重点项）：
- **空闲 CPU**（建议 ≤2%）：未测。
- **句柄/GDI/USER 对象泄漏**：未测（Electron 主进程长时间运行句柄增长是常见问题）。
- **长时间 soak**（24h 私有内存增长 ≤10MB）：未测。
- **热启动**：未测（只有冷启动）。
- 无 nightly 基准（当前预算只在 PR 时跑一次，无趋势对比）。

**落地**：
1. perf-smoke 扩展：采样句柄数（`Get-Process` 的 `HandleCount`）+ 空闲 CPU。
2. 新增 `scripts/soak-test.mjs`：跑 N 轮会话（mock LLM）+ 空闲窗口期，采样
   内存/句柄增长，断言增量阈值（首版可 30–60 分钟，nightly 跑）。
3. windows-desktop.yml 加 `schedule: cron`（如每日 UTC 3:00）跑完整性能套件，
   结果上传 artifact 或写 issue 告警；PR 保持快速子集。

### 1.6 压力测试

**✅ 已有**：`stress-test.mjs`（4 连发 burst、120 行大输出、5 次快速会话操作、
事件循环 drift、内存 delta）——已对齐"高负载+资源受限"要求。

**❌ 缺口**：
- **模糊测试**：IPC 边界无畸形输入测试（`runtimeUnary` 的非 JSON body、超大 payload、
  `runtimeSubscribe` 非法 stream 值、downloadSave 恶意 filename）。`main.ts` 有基础校验
  （typeof 检查），但无系统性 fuzz。
- 长时间 soak（同 1.5）。

**落地**：
1. 单元层 fuzz：对 `runtimeUnary`/`downloadSave`/`windowMenuAction` 的入参做
   畸形/边界输入矩阵测试（vitest，快、无 GUI）。
2. WinAFL 类对 Electron 收益低（输入面是 IPC 不是文件解析），不推荐；**IPC 畸形输入
   矩阵 + schema 校验**（已有 `serverRequestSchema`）是正确形态。

### 1.7 兼容性测试

**❌ 缺口最大的一项**：

| 维度 | 现状 | 要求 |
|---|---|---|
| 操作系统 | 仅自托管 `dsh-windows-2025-16core` 一个 runner | Win10 22H2 + Win11 23H2/24H2 + Server（方法论矩阵） |
| 架构 | 仅 x64 | Electron 43 官方支持 ia32/x64/arm64（Win10+）——至少加 arm64 冒烟 |
| 权限 | 仅管理员 | 普通用户（CI 可用 `runas` 受限 token 或独立用户账户） |
| 区域 | 默认 en-US | 中文/日语/德语 + 非 Unicode 区域 |
| DPI | 默认 100% | 100%/150%/200% + 多显示器 |
| 运行时 | Electron 自带 | node-pty N-API prebuilds 已验（pty-probe） |
| 安装路径 | 未测 | 含空格/中文路径、每用户安装（`perMachine: false` 已配） |

**落地**：
1. **GitHub hosted runner 矩阵**：windows-desktop.yml 增加 `windows-2022`（≈Win11/Server
   基线）与 `windows-2019`（≈Win10 基线）job，跑最小集：build → smoke → pty-probe →
   e2e-window（自托管 2025 跑全量）。成本可控（3 个 runner × 精简步骤）。
   ⚠️ GitHub Actions 已宣布 windows-2019/2022 runner 退役时间表，落地前先核实
   hosted 镜像可用性；不可用则用自托管 Win10 镜像替代。
2. **DPI**：Playwright Electron 启动时传 `--force-device-scale-factor=1.5` / `2.0`
   （Chromium 开关，Electron 支持），跑 e2e-window 断言标题栏/布局无破（自绘标题栏是高危区）。
   注意：该开关对 Windows 系统级缩放（125%/150%）的近似，真实 150% 系统缩放需
   runner 注册表 `LogPixels` 或缩放设置，nightly 层做。
3. **区域**：`Set-WinUserLanguageList` 需重启会话生效（CI 里成本高）；进程级 locale
   注入用 PowerShell 启动前设置 `[System.Globalization.CultureInfo]::DefaultThreadCurrentCulture`，
   或在 runner 上加系统区域设置步骤。首版只覆盖 zh-CN/en-US（产品文案即中文），
   ja-JP/非 Unicode 区域放 nightly 兼容性 job。
4. **安装路径**：NSIS 静默安装 `/S /D=中文空格路径` 后启动验证（见 1.8）。
   注意 NSIS `/D=` 必须是命令行最后一个参数，且不加引号。

### 1.8 安装/升级/卸载（Release 级，完全缺失）

**❌ 无任何安装链路测试**。方法论要求的：干净安装、升级安装、覆盖安装、静默安装、
卸载、非管理员、路径含空格/中文、卸载后无残留。

**⚠️ 验证环境约束（2026-08 事故教训）**：NSIS 安装器/卸载器按进程名和 productName
匹配——无论装到哪个目录，卸载/安装时都会**终止运行中的 DeepSeek Harness.exe 实例**
并改写开始菜单与注册表卸载键。因此 install-cycle **只能在 CI 的独立 runner 上验证**
（hosted runner 每次全新、跑完销毁），**禁止在装有正式版或实例常驻的机器上运行**
（本地开发机已被脚本硬保护拒绝；无实例的 CI 独占 runner 是唯一安全环境）。

**落地**（`scripts/install-cycle.mjs` 已实现 + CI 独立 job）：
1. 静默安装：`dsh-desktop-*.exe /S /D=C:\...`（NSIS；`/D=` 必须为最后参数、不加引号），
   断言 exit code = 0 + 安装目录文件存在 + 开始菜单/卸载入口注册。
2. 启动验证：安装后 `DeepSeek Harness.exe --smoke-test`。
3. 升级（happy path）：安装旧版 → 放置新版 latest.yml + exe 到本地 update feed → 触发
   `updates:check`（electron-updater `setFeedURL` 支持自定义 URL，测试用本地 HTTP）→
   断言 downloaded → `quitAndInstall` → 新版版本号。
   CI 单版本时 `--upgrade` 传当前安装器自身（复制为 feed 0.2.0 + 生成 latest.yml），
   electron-updater 只校验 latest.yml 的 version/sha512，可完整验证下载状态机与
   损坏包 error case；有真实新版本后换真版本升级验证。
4. 升级（error cases，方法论要求测错误路径）：
   - feed 不可达/网络失败 → 状态为 error，应用**仍可正常使用**（不崩、不丢会话）；
   - 下载中途截断/损坏包 → 断言失败恢复，不进入损坏状态；
   - 回滚：新版启动失败时旧版仍可运行（或至少验证失败不影响旧版数据）。
5. 卸载：`Uninstall.exe /S`，断言安装目录/开始菜单/注册表卸载项无残留；
   **用户数据（`%APPDATA%` 下 userData）按策略保留**——显式断言保留或清除，
   不能是未定义行为。
6. 每用户安装（`perMachine: false`）：非管理员账户（CI 建临时用户）安装验证。

### 1.9 安全与签名

**❌ 缺口**：
- Authenticode 签名（EV/OV）——研究报告 C3，SmartScreen + 托盘 GUID + 更新校验前提。
- CodeQL 静态安全扫描（仓库有 Dependabot 但无 CodeQL workflow）。
- crashReporter/WER 崩溃转储未接入（方法论"可观测性"要求）。

**✅ 已有**：sandbox/contextIsolation/nodeIntegration:false、白名单 IPC、CSP、
`downloadReveal` 路径前缀校验、clipboard 回读验证、依赖 Dependabot。

**落地**：
1. 加 `codeql.yml`（`javascript` 语言，paths: `apps/desktop` + `packages/host/desktop-host`）。
2. crashReporter `ready` 前初始化，`uploadToServer: false` 本地收集，诊断导出带上
   crash dump（与研究报告 B5 合并做）。
3. 签名属外部依赖（证书/CI 权限），列入 Release 门禁 checklist。

---

## 2. 仓库规则符合性（dsh-code-review 视角，落地前必读）

本仓库有比通用方法论更严格的门禁规则，计划中每项落地都必须遵守：

1. **非平凡改动 MUST 配 Agent Note**（AGENTS.md）：新增 workflow job、install-cycle 脚本、
   main.ts 拆分、CodeQL、crashReporter 接入都是非平凡改动——每个 PR 必须附
   Agent Note（可合并为 1-2 篇，如"desktop release gates"与"desktop main split"）。
   纯机械改动（如把两行 step 加进 workflow）豁免。
2. **human-visible 改动需要 keyless 场景**（docs/testing.md）：桌面 UI 可见改动
   （更新入口、主题跟随、标题栏）必须更新 `e2e-window` 截图断言或 `ui-matrix`
   步骤——仓库快照体系（apps/web/tests/snapshots）不覆盖桌面渲染层，e2e-window
   截图 + ui-matrix 断言就是桌面的"快照等价物"，UI 改动时同步更新。
3. **per-file 100% 覆盖率哲学**：把 apps/desktop/src 纳入覆盖率门禁时，仓库规则是
   "未覆盖行往往是该死代码，不是缺测试"——拆分 main.ts 时优先删除/瘦身不可测胶水，
   而不是给 Electron 胶水硬凑测试；Electron 依赖层用 `/* v8 ignore -- 原因 */` 豁免。
4. **独立 CI 信号属性**：windows-desktop.yml 刻意**不参与** all-checks-passed 判定
   （ci.yml 注释明说）。新增的 nightly/兼容性 job 应保持独立信号——跑挂不阻断 PR，
   避免 Windows runner 波动拖住合并。
5. **真实入口路径**：所有新增测试必须驱动**打包后的 exe**（dist-app2/win-unpacked），
   与现有 perf-smoke/e2e-window 一致——不要对 `lib/` 或 src 做"看起来一样"的替代验证。
6. **文档同步**：改动 README（已知限制增删）、package.json scripts、workflow 时
   同 PR 更新；本计划落地后把"ui-matrix/stress-test 进 CI"从 Known Limitations 移除。

---

## 3. 三档流水线设计（对照方法论）

### PR 流水线（现有 windows-desktop.yml，补 2 步；保持独立信号，不阻断合并）
```
checkout → install → build → package(flat) → perf-smoke → pty-probe
→ bench-stream → perf-test → e2e-window
+ ui-matrix          # 新增：60 步 GUI 功能矩阵
+ stress-test        # 新增：压力门禁
```

### Nightly 流水线（新增 schedule，每日 UTC 3:00）
```
+ 完整性能套件（同 PR，含趋势 artifact）
+ soak-test（30–60 min 内存/句柄增长）
+ 兼容性矩阵 job（windows-2022 / windows-2019 hosted runner，精简集）
+ DPI 矩阵（100/150/200%）
+ 区域矩阵（zh-CN / en-US / ja-JP）
+ CodeQL（或并入 ci.yml 的 PR 触发）
```

### Release 流水线（新增 workflow，tag 触发）
```
build → sign（证书注入）→ install-cycle（安装/升级/卸载/每用户/中文路径）
→ WACK（Windows App Certification Kit，可选，对 Electron 收益有限）
→ 依赖漏洞扫描（Dependabot 已覆盖 npm；Release 前人工确认）
→ 上传 GitHub Releases（exe + blockmap + latest.yml）→ 更新链路端到端验证
```

---

## 4. 优先级与工作量估计

| 优先级 | 事项 | 工作量 | 理由 |
|---|---|---|---|
| P0 | ui-matrix + stress-test 进 CI | 0.5d | 现成资产，最大功能缺口，一行 workflow |
| ✅ | e2e-window 补交互断言（更新入口/托盘新建会话/崩溃恢复）| 已完成 | 2026-08 批次：标题栏更新入口、托盘新建会话、崩溃覆盖层断言已入 `e2e-window.mjs`；隔离模式 `DSH_E2E_ISOLATED=1` |
| P0 | 安装/升级/卸载脚本（install-cycle，含 error cases 与回滚） | 2–3d | Release 级唯一硬缺口 |
| P1 | perf-smoke 加句柄/空闲 CPU；soak-test | 1–2d | 泄漏检测，nightly 前提 |
| P1 | main.ts 拆分 + desktop-runtime 单测 | 2d | 覆盖率门禁前提 |
| P1 | windows-2022/2019 兼容性 job（先核实 hosted 镜像可用性） | 1d | 矩阵下限 |
| P1 | CodeQL + crashReporter 本地收集 | 1d | 安全/可观测性 |
| P2 | DPI/区域矩阵 | 1–2d | 体验类，可后置 |
| P2 | IPC 畸形输入 fuzz 矩阵（vitest） | 1d | 输入面防御 |
| P2 | apps/desktop 纳入覆盖率门禁 | 持续 | 需先拆分可测内核 |

**执行顺序**：P0 全部（一周内）→ P1（两周内）→ P2（按发布节奏）。
P0 完成即满足方法论"每次构建冒烟 + 功能测试 + 压力测试"的最低发布门禁；
签名与 Release 流水线依赖外部决策（证书），应尽早并行启动。
每项落地同时满足第 2 节仓库规则（Agent Note、keyless 场景、独立信号、真实入口）。
