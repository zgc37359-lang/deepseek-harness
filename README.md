# Harness Desktop

English | [中文](README.zh.md)

> A native Windows client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): an agent workspace for reading projects, editing files, running commands, and moving work forward from one place.

> **[Open the website](https://harness-desktop.pages.dev/) · [Download Windows v0.1.1](https://github.com/zgc37359-lang/harness-desktop/releases/latest/download/dsh-desktop-0.1.1-x64.exe) · [View releases](https://github.com/zgc37359-lang/harness-desktop/releases)**

![Latest release](https://img.shields.io/badge/Latest%20release-0.1.1-4B8BBE?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-43.4-47848F?style=flat-square)
![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11%20x64-0078D6?style=flat-square)

## What it does

Harness Desktop puts an agent in your Windows workspace. Start with a goal, then let it inspect the project, edit files, run PowerShell commands, search for information, and keep the result in the same work context.

## Screenshots

![Main window](apps/desktop/docs/screenshot-main.png)

![Conversation](apps/desktop/docs/screenshot-chat.png)

![Settings](apps/desktop/docs/screenshot-settings.png)

*Screenshots come from the packaged app in isolated mode with a mock LLM. Re-capture them before a release when the UI changes.*

## Features

- **Workspace-first agent** — work with conversations, files, tasks, and tool results in one desktop workspace.
- **Project operations** — inspect a project, edit files, and run PowerShell commands from the agent workflow.
- **Permission controls** — sensitive actions can require your confirmation before they run.
- **In-process desktop runtime** — the Harness runtime runs inside the Electron main process through a whitelisted IPC bridge; the desktop shell does not require a localhost HTTP server.
- **Hardened renderer** — the renderer uses Electron sandboxing and context isolation; system capabilities stay behind the main-process bridge.
- **Tray lifetime** — closing the window hides it; the tray can reopen the app or start a new session.
- **Auto updates** — check, download, and install releases from the app's title-bar update entry.
- **Diagnostics export** — export a timestamped bundle containing the main log and version/environment snapshot.

## Install

The current stable release is **v0.1.1**. Download dsh-desktop-0.1.1-x64.exe from the [latest release](https://github.com/zgc37359-lang/harness-desktop/releases/latest). It is an NSIS per-user installer and does not require administrator permission.

The application targets **Windows 10/11 x64**. If Windows SmartScreen warns about the installer, the package is unsigned until a code-signing certificate is configured.

## Run

To start the local Web UI from a source checkout, run:

```sh
pnpm dsh web --port 0
```

The command prints the local URL. The Web UI is a separate source-runtime entry from the packaged Windows desktop application.

## Run from source

To build the Windows desktop application, install the repository dependencies first:

Requirements: Node.js ^22.19.0 or >=24.0.0 and pnpm 11.7.0.

After cloning, run:

```sh
git clone https://github.com/zgc37359-lang/harness-desktop.git
cd harness-desktop
pnpm install --frozen-lockfile
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop run dist:flat
```

The packaged NSIS installer and latest.yml update manifest are written to apps/desktop/dist-app2/.

## Data and limitations

- Session and workspace data are managed by the desktop application. Content sent to a model follows the model provider configured for the session and that provider's policy.
- A session should be operated by one Harness process at a time. Do not operate the same session from the desktop app and the CLI simultaneously under one DSH_HOME.
- The desktop application currently targets Windows x64.

## License

[MIT](LICENSE)
