# Harness Desktop

English | [中文](README.zh.md)

> The native Windows client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — a local-first agent workspace. Frameless custom UI, tray lifetime, and the complete agent runtime **in-process**: no localhost server, no browser tab, no ports. Your agent, one click away.

![Version](https://img.shields.io/badge/Version-0.1.0--rc.9-4B8BBE?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-43.4-47848F?style=flat-square)
![Platform](https://img.shields.io/badge/Platform-Windows%2010%2B-0078D6?style=flat-square)

---

## Screenshots

![Main window](apps/desktop/docs/screenshot-main.png)

![Conversation](apps/desktop/docs/screenshot-chat.png)

![Settings](apps/desktop/docs/screenshot-settings.png)

*Captured from the packaged app (isolated mode, mock LLM). Re-capture before every release.*

---

## Features

- 🪟 **Frameless window** — custom title bar with its own window menu (`Alt+Space`), maximize / restore / minimize, close-to-tray
- 🧲 **Tray lifetime** — closing the window hides it; open it or start a new session from the tray anytime
- ⚡ **In-process runtime** — the full Harness plugin tree runs in the main process over a whitelisted IPC bridge: zero localhost HTTP ports, zero network listeners
- 🛡️ **Hardened renderer** — `sandbox` + `contextIsolation`; the main process is the only system-capability boundary
- 🔁 **Auto updates** — always-visible title-bar entry: check / download / install from this fork's GitHub Releases
- 📦 **One-click diagnostics** — export a timestamped bundle (main log + version/environment snapshot)

---

## Install

Download the latest installer from [Releases](https://github.com/zgc37359-lang/harness-desktop/releases) — `dsh-desktop-<version>-x64.exe` (NSIS per-user install, no admin required).

### Build from source

```sh
git clone https://github.com/zgc37359-lang/harness-desktop.git
cd harness-desktop
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop run dist:flat
```

The desktop app lives in `apps/desktop/` (see its [README](apps/desktop/README.md)); the NSIS installer and `latest.yml` update manifest land in `apps/desktop/dist-app2/`.

---

## Known limitations

- Installers are unsigned until a code-signing certificate is configured (SmartScreen warnings may appear).
- Windows sandbox `workspace-write` / `read-only` modes break schannel-based HTTPS clients (curl, PowerShell, .NET) with `SEC_E_NO_CREDENTIALS`; Node/Python (OpenSSL) are unaffected — use built-in web/search tools or `danger-full-access` for those commands.
- One session, one process: don't operate the same session from two harness processes (e.g. the desktop and the CLI) on one `DSH_HOME` at once.

---

## License

[MIT](LICENSE)
