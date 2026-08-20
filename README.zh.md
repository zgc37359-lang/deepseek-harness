# Harness Desktop

[English](README.md) | 中文

> [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的 Windows 原生客户端：把 Agent 放进工作区，用一个桌面应用读项目、改文件、跑命令，持续推进任务。

> **[打开官网](https://harness-desktop.pages.dev/) · [下载 Windows v0.1.1](https://github.com/zgc37359-lang/harness-desktop/releases/latest/download/dsh-desktop-0.1.1-x64.exe) · [查看 Releases](https://github.com/zgc37359-lang/harness-desktop/releases)**

![最新发布版](https://img.shields.io/badge/Latest%20release-0.1.1-4B8BBE?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-43.4-47848F?style=flat-square)
![平台](https://img.shields.io/badge/Platform-Windows%2010%2F11%20x64-0078D6?style=flat-square)

## 它能做什么

Harness Desktop 把 Agent 放进 Windows 工作区。从一个目标开始，让它理解项目、修改文件、运行 PowerShell 命令、搜索资料，并在同一个工作上下文里留下结果。

## 截图

![主界面](apps/desktop/docs/screenshot-main.png)

![对话](apps/desktop/docs/screenshot-chat.png)

![设置](apps/desktop/docs/screenshot-settings.png)

*截图来自隔离模式下的打包版应用，使用 mock LLM。界面发生变化时，请在发布前重新截图。*

## 特性

- **工作区优先的 Agent** — 在同一个桌面工作区里处理会话、文件、任务和工具结果。
- **项目操作** — 在 Agent 工作流中查看项目、修改文件并运行 PowerShell 命令。
- **权限控制** — 敏感操作可以在执行前请求你的确认。
- **进程内桌面运行时** — Harness 运行时在 Electron 主进程中运行，通过白名单 IPC 桥通信；桌面端不依赖 localhost HTTP 服务器。
- **加固渲染层** — 使用 Electron sandbox 和 context isolation，系统能力留在主进程桥接层之后。
- **托盘常驻** — 关闭窗口会隐藏应用，可以从托盘重新打开或新建会话。
- **自动更新** — 在应用标题栏入口检查、下载并安装 Releases 中的更新。
- **诊断导出** — 导出带时间戳的诊断包，包含主日志和版本/环境快照。

## 安装

当前稳定版是 **v0.1.1**。从[最新 Release](https://github.com/zgc37359-lang/harness-desktop/releases/latest) 下载 dsh-desktop-0.1.1-x64.exe。这是 NSIS 每用户安装包，不需要管理员权限。

应用面向 **Windows 10/11 x64**。如果 Windows SmartScreen 对安装包发出警告，这是因为配置代码签名证书前安装包仍未签名。

<a id="run"></a>

## 运行

从源码启动本地 Web UI：

```sh
pnpm dsh web --port 0
```

命令会打印本地访问地址。Web UI 的源码运行入口与打包后的 Windows 桌面应用是两条独立路径。

<a id="run-from-source"></a>

## 从源码运行

要构建 Windows 桌面应用，请先安装仓库依赖。

环境要求：Node.js ^22.19.0 或 >=24.0.0，pnpm 11.7.0。

克隆仓库后运行：

```sh
git clone https://github.com/zgc37359-lang/harness-desktop.git
cd harness-desktop
pnpm install --frozen-lockfile
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop run dist:flat
```

打包后的 NSIS 安装器和 latest.yml 更新清单写入 apps/desktop/dist-app2/。

## 数据与限制

- 会话和工作区数据由桌面应用管理；发送给模型的内容遵循当前会话配置的模型提供商及其策略。
- 一个会话同一时间应只由一个 Harness 进程操作，不要在同一个 DSH_HOME 下同时用桌面端和 CLI 操作同一会话。
- 当前桌面应用面向 Windows x64。

## 许可证

[MIT](LICENSE)
