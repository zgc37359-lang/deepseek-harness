# DeepSeek Harness 桌面端（dsh-desktop）进化研究报告

> 基于对 `apps/desktop/` 全部源码、`packages/host/desktop-host/`、`packages/client/connection` 桌面 carrier、
> `.agents/notes/` 中 10+ 篇桌面相关决策记录、`.github/workflows/windows-desktop.yml` 的逐文件分析。
> 报告日期：2026-08。状态：研究输出，未改动产品代码（除清理构建产物）。

## 0. 现状一句话

这是一个**架构上已经走对路**的 Electron 壳：无边框窗口 + 自绘标题栏、托盘常驻、单实例、
主进程内嵌完整 Harness 插件树、白名单 IPC 桥、无 localhost HTTP 端口、sandbox + contextIsolation 渲染层、
CI 有冷启动/内存/事件循环/帧率/首 token/吞吐六道性能门禁。
缺的是**产品化收尾**（签名、更新链路、窗口状态记忆、日志轮转）和**体验类功能**（全局快捷键、通知、主题跟随、崩溃恢复）。

---

## 1. 架构全景（读完代码后的还原）

```
Electron main process (apps/desktop/src/main.ts)
├─ 窗口：frame:false + 自绘 TitleBar（React），Alt+Space 自定义系统菜单，move/size 用光标轮询
├─ 托盘：Tray + 菜单（打开主窗口/新建会话/退出），close 事件 = hide（常驻托盘）
├─ 单实例：requestSingleInstanceLock + second-instance → showMainWindow
├─ 安全面：sandbox:true, contextIsolation:true, nodeIntegration:false, 白名单 IPC（IPC 常量表）
│   ├─ window:* 窗口控制 / tray:* / updates:* / downloads:* / diagnostics:* / clipboard:*
│   └─ runtime:*  → desktop-runtime.ts → @deepseek-ai/dsh-desktop-host（进程内 Harness）
├─ 协议：dsh-bundle:// 提供客户端 bundle；webContents 禁导航、外链走 shell.openExternal
├─ 更新：electron-updater + update.ts 状态机（check/download/install 经 IPC）
└─ 诊断：main.log（追加写，无轮转）+ 一键导出（main.log + versions.json）
```

**运行时**（desktop-boot.ts）：组合 `dsh-base` + `dsh-web-app` 两个 bundle，
禁用 webserver/web-runtime/web-startup/hmr，保留 connection 行改为桌面 carrier，
注入 desktop-host + grants。`DesktopHost` 复用 `toFetchHandler` 走同一 RPC 链
（重要决策：桌面桥骑共享 RPC 链，Remote 控件行为与 Web 一致）。

**渲染层**：vite + React，挂载现有 `AppWebEntry`（完整 Web UI），通过
`packages/client/connection/src/client/desktop-api-client.ts` 走 IPC unary + 下行事件流。

**打包**：`flatten-deps.mjs` 平铺 246 包生产闭包 → electron-builder flat 配置 →
NSIS 安装器 + latest.yml。CI（windows-desktop.yml）跑 perf-smoke / pty-probe / bench-stream /
perf-test / e2e-window 六道门禁。

---

## 2. 已确认的已知限制（README 如实）与代码对照

| README 声称 | 代码实际 | 状态 |
|---|---|---|
| Win11 hover snap-layout 浮层不可用 | `frame:false` + 自绘按钮，确实没有 | 属实，体验缺口 |
| move/size 光标循环无自动化测试 | main.ts `beginWindowDrag` setInterval 16ms | 属实 |
| 未签名（无代码签名证书） | electron-builder 无 sign 配置 | 属实，更新链路的前提 |
| 更新源在签名版本发布前无意义 | `app.isPackaged` 时启动即 check | 属实 |
| CSP 允许 unsafe-eval | index.html：`script-src 'self' dsh-bundle: 'unsafe-eval'` | 属实，Loader/schemastery 需要 |
| Cordis runner inspect/inventory 无桌面 IPC 对应 | 确实没有 | 属实，缺口 |

**发现：README 图标描述已过时** —— README 说"使用默认 Electron 图标"，
但 `scripts/generate-icon.mjs` 已生成 `build/icon.ico`（鱼形 glyph），
`electron-builder.flat.yml` 已配置 `win.icon: build/icon.ico`。README 需要更新。

---

## 3. 优化点（按价值排序）

### A. 产品化收尾（高价值、低风险）

**A1. 窗口状态记忆**（最值得先做）
- 现状：每次启动固定 1280x800，位置、最大化状态、显示器全不记忆。
- 做法：`win.getBounds()` 在 close/移动时写入 userData JSON（节流），创建时恢复，
  校验坐标仍在某个显示器内（`screen.getAllDisplays()`），多显示器拔掉时回退默认。
- 竞品（Claude Desktop、Cherry Studio）全部记忆窗口状态，这是桌面应用的基本盘。

**A2. 更新 UI 在正常使用时不可见**
- 现状：`renderer/main.tsx` 中更新按钮只渲染在 **placeholder** 分支
  （`runtimeAttached && manifest !== null` 为 false 时）。Web UI 挂载后（正常情况）
  更新入口消失，更新状态只能靠主进程静默推给没人听的 IPC。
- 做法：把更新状态/按钮挂到标题栏（TitleBar 右侧小图标）或通过 slot 注入 Web UI
  设置页；托盘菜单加"检查更新"。

**A3. 日志轮转**
- 现状：`main.log` appendFileSync 无限增长。
- 做法：按大小/日期轮转（如 5MB × 3），诊断导出前 flush。Node 22 无内置轮转，
  手写 30 行或引入 `rotating-file-stream`（仓库偏好：能省代码就引依赖，见依赖政策）。

**A4. 启动即检查更新的节流**
- 现状：`app.isPackaged` 时启动立即 `checkForUpdates()`，每次启动打 GitHub API。
- Electron 官方 performance 文档**点名"启动后立即检查更新"是典型性能错误**——应推迟到空闲或用户触发。
- 做法：距上次检查 < 24h 则跳过（存时间戳）；失败静默 + 指数退避；或改为窗口空闲/托盘点击时检查。

**A5. README 同步**
- 图标描述过时；`dist` 常规路径与 `dist:flat` 的取舍可在 README 补一句；
  顺带把 Known Limitations 的"更新"条目与 A2/A4 联动更新。

### B. 稳定性与健壮性（中价值、中风险）

**B1. 渲染进程崩溃的用户可见处理**
- 现状：`render-process-gone` 静默 reload（最多 2 次），用户无感知、无诊断。
- 做法：第 3 次崩溃弹对话框（带"导出诊断包"），记录 crash 前的 renderer console 尾部。

**B2. 主进程 uncaughtException 策略**
- 现状：非 EPIPE 直接 `app.exit(1)` —— 会丢掉托盘常驻和未保存状态。
- 做法：先尝试优雅 shutdown（复用 `shutdown()`），失败再强退；记录诊断。

**B3. 下载落盘阻塞主进程**
- 现状：`downloadSave` 把 base64 全量放内存 + `writeFileSync` 同步写盘（大文件会卡主进程事件循环）。
- 做法：分块写（Buffer 分段 + appendFileSync 或流），或走临时文件 + rename；
  同名校验防覆盖（追加序号）。注意 IPC 传 base64 本身有上限压力，可改为传 ArrayBuffer。

**B4. shutdown 超时后残留**
- 现状：`SHUTDOWN_TIMEOUT_MS` 10s 后 `app.exit(0)`，但子进程（shell/pty/subprocess）
  可能残留。
- 做法：退出前枚举进程树（仓库已有 subprocess 进程树能力）kill 残留。

**B5. 诊断包增强**
- 现状：只有 main.log + versions.json。
- 做法：加 renderer console（preload 转发）、崩溃次数、更新状态、窗口状态、
  显示器信息、`$DSH_HOME` 结构概览（注意脱敏：不拷 settings.yaml 原文，只拷 key 名）。
- 可选升级：引入 electron-log（main/renderer/preload 分入口 + file transport 轮转 +
  `eventLogger.startLogging()` 自动记录 `render-process-gone`/`child-process-gone`/`did-fail-load`
  等崩溃事件 + `errorHandler.startCatching()` 捕获未处理异常）——替换手写 appendFileSync 日志，
  与 A3/B1 一次做完。仓库偏好"能省代码就引依赖"（依赖政策），electron-log 是社区标准。

### C. 安全加固（中价值、需评估）

**C1. 收窄 CSP 的 connect-src**
- 现状：`connect-src 'self' dsh-bundle: ws://localhost:* http://localhost:*`。
- 桌面没有 webserver，`ws://localhost:*` 和 `http://localhost:*` 是 Web 载体的遗留。
  如果桌面 UI 不 fetch localhost，应收窄到 `'self' dsh-bundle:`。
- ⚠️ 需验证：Web UI 内部是否有依赖 localhost fetch 的逻辑（如 mock 服务器、用户自配 baseURL）。

**C2. Electron fuses 加固**
- 现状：无 fuses 配置（runAsNode / nodeOptions / embeddedAsar 等熔断未显式设置）。
- 做法：electron-builder 26.15.3 原生支持 `electronFuses` 配置（已验证本仓库安装版本），
  在配置里直接声明：`RunAsNode: false`、`EnableNodeOptionsEnvironmentVariable: false`、
  `EnableNodeCliInspectArguments: false`、`OnlyLoadAppFromAsar: true`、
  `EnableEmbeddedAsarIntegrityValidation: true`、`EnableCookieEncryption: true`。
- 注意与 `2026-08-17-desktop-sandbox-runner-electron-run-as-node` note 的关系：
  那条 note 拒绝的是 boot 时设 `ELECTRON_RUN_AS_NODE`（会改 process.execPath 语义），
  而 fuses 烧熔断是另一层（改的是二进制本身），两者不冲突，但要验证 sandbox runner
  不依赖 runAsNode 路径。

**C3. 代码签名**（高价值，但需要证书/流程）
- Windows 无签名 = SmartScreen 警告 + electron-updater 无法校验更新文件完整性
  （差分更新需要签名才能安全落地）。
- 额外影响（Electron Tray 文档）：未签名时托盘 GUID 与**安装路径**绑定，
  路径变化（如更新换目录）托盘位置即失效；签名且证书含组织名时 GUID 与签名绑定，跨更新持久。
- 路线：EV/OV 证书 → CI 里 sign（Azure Trusted Signing 或自托管证书）→
  GitHub Releases 发布 → latest.yml + blockmap 生效 → 更新链路真正可用。
- 这是"进化 exe"最卡脖子的一步，README 也明说了。

### D. 性能（已有门禁，继续收紧）

- 冷启动预算 15s / 峰值内存 1GiB（实测 2.1s / 288MiB，裕量巨大）。
  可考虑把预算收紧到 8s / 700MiB，倒逼启动路径优化（懒加载非首屏插件）。
- 事件循环 p95 预算 50ms（实测 31.6ms），bench-stream 首 token 预算 2s（实测 ~1.7s），
  裕量合理，保持。
- 启动耗时大头在进程内 boot 整个插件树：可测 `--bench-stream` 之外加一个
  `--boot-trace` 模式输出各 bundle/插件加载耗时，用数据找优化点。

### E. 工程与测试

**E1. 孤儿脚本处置**
- `scripts/probeA/B/C.mjs`、`probe-export.mjs`、`probe-provider.mjs`、`stress-test.mjs`、
  `ui-matrix.mjs` 未接入 package.json scripts 也未进 CI（ui-matrix/stress-test 有 Agent Note
  记录是本地门禁，probe* 无任何记录）。建议：probe* 删除或归档；ui-matrix/stress-test
  要么进 CI（windows-desktop.yml 加一步）要么在 README 注明本地用法。

**E2. 拖拽 move/size 自动化测试**
- README 已知限制。Playwright Electron 可模拟：`window.desktop.window.menuAction('move')`
  后 mouse.move 断言 `getBounds()` 变化。补上后移除 Known Limitations 条目。

**E3. 窗口管理逻辑拆分**
- main.ts 541 行单文件，窗口/IPC/托盘/协议/生命周期混在一起。
  可拆 `window.ts` / `tray.ts` / `ipc.ts`（main 侧）/ `protocol.ts`，测试友好度提升。
  （仓库惯例是插件化，但 main.ts 是 app 壳不是插件，拆文件即可。）

---

## 4. 功能进化路线（按发布节奏）

### 第一波：桌面应用"基本盘"（1-2 周）

1. 窗口状态记忆（A1）
2. 更新入口进标题栏/设置（A2）+ 检查节流（A4）
3. 日志轮转（A3）
4. 渲染崩溃可见处理 + 诊断增强（B1/B5）
5. README 同步 + 孤儿脚本处置（A5/E1）

### 第二波：桌面体验增强（2-4 周）

6. **全局快捷键**（如 Ctrl+Alt+D 唤起/隐藏窗口；globalShortcut 注册需处理**占用冲突静默失败**，
   与单实例/托盘配合，参考 Cherry Studio/Claude Desktop Quick Entry 的唤起体验）
7. **系统通知**：任务完成、需审批、更新就绪 → Notification API
   （main 进程 new Notification，经 IPC 由渲染层触发；**前置条件：`app.setAppUserModelId`**，
   Windows toast 与任务栏分组依赖它，当前未调用）
8. **主题跟随**：标题栏目前硬编码深色（styles.css `--titlebar-bg: #171a21`），
   Web UI 有 light/dark/system 主题；标题栏应订阅主题（preload 加 IPC 或
   渲染层 CSS 变量联动）
9. **托盘增强**：菜单加"最近会话"（读 session 列表）、"暂停/停止当前任务"、
   "退出时确认"；托盘图标可做状态点（运行中/空闲）
10. **开机自启**（可选设置，`app.setLoginItemSettings`，Windows 注册表 Run 键）
11. **多显示器/DIP 细节**：窗口状态记忆里带 display id；cursor 轮询拖拽
    在高 DPI 下校准（目前 16ms 轮询在 125%/150% 缩放下可能有偏差）
12. **devtools 策略**：生产环境默认禁 F12/Ctrl+Shift+I（`webContents.on('before-input-event')`
    或 Menu 移除），设隐藏开关（诊断需要时 --debug 参数）
13. **运行中任务面板**（竞品借鉴清单里最突出的差异化项）：借鉴 Cursor/VS Code 的
    任务面板 + Claude Cowork——把 agent 运行中的任务做成可枚举、可取消、
    步骤流式展开的第一等公民；后台任务完成发系统通知（与 7 联动）。

### 第三波：平台能力（1-2 月）

14. **dsh:// 深度链接**：`app.setAsDefaultProtocolClient('dsh')` +
    second-instance 携带 argv 路由（如 `dsh://session/<id>` 唤起并打开指定会话）。
    单实例锁已就位，只差参数解析；注意传参用 `additionalData`（argv 顺序不保证）。
15. **文件拖放**：渲染层 dragover/drop → main 进程读路径 → 上传/attach 到会话
    （Web UI 已有 attachment 体系，桌面只需把 File.path 送进现有工具链）
16. **任务栏集成**：Windows JumpList（最近会话）、TaskbarProgress（任务运行进度）
17. **MCP 管理 UI**：仓库已有 mcp-client，桌面设置页接入（Claude Desktop/Cherry Studio 标配）
18. **崩溃恢复**：启动时检测上次异常退出 → 提示恢复会话（session 持久化已有，
    差一个"上次会话列表"恢复入口）；crashReporter 在 ready 前初始化
    （`uploadToServer: false` 只本地收集，配合 B5 诊断导出）
19. **划词助手**（Cherry Studio 特色）：全局热键 + 系统选区 → 送进现有 agent 工具链
    （翻译/解释/追问），桌面壳差异化小功能
20. **本地 OpenAI 兼容端点**（Chatbox 启示）：DSH 暴露本地端点后，
    Chatbox/Cherry Studio 等聚合端可接入 DSH 的 agent 能力——"被接入"反过来扩大生态

### 第四波：发布链路（并行推进，最卡脖子）

21. **代码签名 + GitHub Releases 自动发布**（C3）：CI 构建 NSIS → 签名 →
    gh release 上传 exe/blockmap/latest.yml → electron-updater 全链路验证
    （本地已能用 `--update-feed` 直连测试）
22. **差分更新验证**：electron-updater 的 NSIS web installer 差分（blockmap）
    在 225MB 安装包上省流量明显
23. **更新渠道**：stable/beta 两档（`--channel` 或 latest-beta.yml），
    与 A4 节流联动；`publisherName` 校验发布者防中间人

---

## 5. 架构层面的中长期思考（值得记入 notes 的方向）

- **主进程瘦身**：目前主进程 = Electron shell + 完整插件树 + node-pty + 打包闭包。
  若未来要降主进程内存/崩溃面，可评估把 agent 运行时移入 `utilityProcess`
  （Electron 官方建议 fork 子进程优先用 utilityProcess 而非 child_process.fork；
  可用 MessagePort 直连渲染层、`serviceName` 进 `app.getAppMetrics`、
  `child-process-gone` 的 reason 枚举含 `oom`/`memory-eviction`/`integrity-failure` 可监控；
  仓库已有 subprocess/workflow-worker-thread 的 worker 先例），主进程只做 IPC 网关。
  这是大手术，当前 288MiB 实测内存下不急，但值得记为方向。
- **sandbox runner 与 ELECTRON_RUN_AS_NODE**：已有 note 记录决策（拒绝 boot 设 env），
  未来若 sandbox runner 需要 Node 二进制，可考虑随包携带独立 node.exe
  （与 Electron 解耦，也顺带解决 fuses 冲突面）。
- **桌面 host 的 Remote 面补齐**：README 已知限制（runner inspect/inventory、
  /plugins/events 无 IPC 对应）——补齐后 E2E 里的报错会消失，也是
  "桌面 UI 与 Web UI 行为一致"承诺的收尾。

---

## 6. 竞品对照与生态启示

> 完整调研（含来源链接与 ✅/⚠️ 核实标注）：[research-competitors.md](research-competitors.md)。
> 关键事实：**DeepSeek 官方没有 Windows 桌面端**（下载页仅手机 App，官方 GitHub 组织无桌面仓库）——
> "官方形态的本地 agent 桌面壳"定位独特，无正面竞争。

| 竞品 | 定位 | 最值得借鉴的点 |
|---|---|---|
| **Claude Desktop** | 官方全功能桌面端（Electron） | Quick Entry 全局热键、桌面扩展（MCP 客户端）、Cowork 后台任务、CLI↔桌面会话互通、企业 MSIX+可控更新 |
| **Cherry Studio** | 开源多模型聚合端（国内流行） | 多 Provider 面板、内置 RAG、划词助手、MCP 管理、nightly/stable 双渠道 |
| **Chatbox** | 轻量 BYOK 聚合端 | 本地存储 + 自定义 OpenAI 兼容端点；DSH 可反向暴露端点被它接入 |
| **LobeHub** | agent 平台化 | Agent Builder、Skills/MCP 商店、定时调度、白盒记忆 |
| **Cursor / VS Code** | IDE agent 体验 | 任务面板（步骤/进度/取消）、后台任务+通知、进程可见/kill、崩溃恢复 |

**对本项目的最高优先级启示（含 Electron 官方依据）**：

1. **工程加固先于功能**：`@electron/fuses` 在 afterPack 翻转（`RunAsNode`/`NodeOptions`/`CliInspect` 关、
   `OnlyLoadAppFromAsar` + `EnableEmbeddedAsarIntegrityValidation` + `EnableCookieEncryption` 开）
   ——本仓库 electron-builder 26.15.3 原生支持 `electronFuses` 配置（已验证）。
   注意与 `2026-08-17-desktop-sandbox-runner-electron-run-as-node` note 不冲突（fuses 改二进制，
   那条 note 拒绝的是 boot 设 env）。
2. **代码签名**：未签名 → SmartScreen 警告 + **托盘 GUID 与安装路径绑定（路径变化托盘位置失效）**
   （Electron Tray 文档：签名且含组织名时 GUID 与签名绑定，跨更新持久）。
3. **更新检查不要在启动时立即做**——Electron 官方 performance 文档点名这是典型性能错误（对应 A4）。
4. **agent 运行时隔离**：Electron 官方建议 fork 子进程优先用 `utilityProcess` 而非 `child_process.fork`，
   可用 MessagePort 直连渲染层、`serviceName` 进 `app.getAppMetrics` 与 `child-process-gone`
   （`reason` 枚举含 `oom`/`memory-eviction`/`integrity-failure`）——主进程内嵌 agent 运行时
   是当前架构最大风险面，未来迁移方向明确（见第 5 节）。
5. **崩溃诊断**：crashReporter 需在 `ready` 前初始化；electron-log 的 `eventLogger.startLogging()`
   自动记录 `render-process-gone`/`child-process-gone`/`crashed`/`did-fail-load` 等事件 + file transport
   轮转——比手写 appendFileSync 日志更适合诊断增强（B5）。
6. **全局快捷键**：`globalShortcut.register` 占用冲突会**静默失败，必须处理返回值**；Wayland 走 portal。
7. **单实例 + 深链**：`second-instance` 传参用 `additionalData`（argv 顺序不保证）；深链用
   `app.setAsDefaultProtocolClient` → 二次实例解析 URL（对应路线 14）。
8. **Windows 通知/任务栏**：`app.setAppUserModelId` 是 toast 通知与任务栏分组的前提（当前未调用）。

---

## 7. 建议的下一步动作（如果用户要落地）

1. **先把 `apps/desktop/` 提交进 git**（当前 0 个文件被跟踪，全部改动只存在于本地，
   工作区还有大量其他未提交修改——建议先提交/建分支，避免进化过程中丢失工作）
2. 先做 A1+A2+A3+A5（纯本地、低风险、两天内可交付，含测试与 note）
3. 并行评估 C2 fuses + C3 签名（需要用户提供证书/CI 权限决策）
4. E1 孤儿脚本处置（需用户确认 probe* 是否保留）
5. 每次改动遵循仓库规矩：非平凡改动配 Agent Note、跑桌面门禁
   （build → smoke → perf-smoke → e2e-window 或 windows-desktop CI）
