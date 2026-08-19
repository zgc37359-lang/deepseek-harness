# Harness Desktop

English | [中文](README.zh.md)

> The native Windows client for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — a local-first agent workspace. Frameless custom UI, tray lifetime, and the complete agent runtime **in-process**: no localhost server, no browser tab, no ports. Your agent, one click away.

![Version](https://img.shields.io/badge/Version-0.1.0--rc.9-4B8BBE?style=flat-square)
![Electron](https://img.shields.io/badge/Electron-43.4-47848F?style=flat-square)
![Platform](https://img.shields.io/badge/Platform-Windows%2010%2B-0078D6?style=flat-square)

---

## Screenshots

![Main window](docs/screenshot-main.png)

![Conversation](docs/screenshot-chat.png)

![Settings](docs/screenshot-settings.png)

*Captured from the packaged app (isolated mode, mock LLM). Re-capture before every release.*

---

## Features

- 🪟 **Frameless window** — custom title bar with its own window menu (`Alt+Space`), maximize / restore / minimize, close-to-tray
- 🧲 **Tray lifetime** — closing the window hides it; open it or start a new session from the tray anytime
- ⚡ **In-process runtime** — the full Harness plugin tree runs in the main process over a whitelisted IPC bridge: zero localhost HTTP ports, zero network listeners
- 🛡️ **Hardened renderer** — `sandbox` + `contextIsolation`; the main process is the only system-capability boundary
- 🔁 **Auto updates** — always-visible title-bar entry: check / download / install from the fork's GitHub Releases
- 📦 **One-click diagnostics** — export a timestamped bundle (main log + version/environment snapshot)

---

## Install

Download the latest installer from [Releases](https://github.com/zgc37359-lang/harness-desktop/releases) — `dsh-desktop-<version>-x64.exe` (NSIS per-user install, no admin required).

### Build from source

```sh
git clone https://github.com/zgc37359-lang/harness-desktop.git
cd deepseek-harness
pnpm install
pnpm run build
pnpm --filter @deepseek-ai/dsh-desktop run dist:flat
```

The NSIS installer and `latest.yml` update manifest land in `apps/desktop/dist-app2/`.

---

## Known limitations

- Installers are unsigned until a code-signing certificate is configured (SmartScreen warnings may appear).
- Windows sandbox `workspace-write` / `read-only` modes break schannel-based HTTPS clients (curl, PowerShell, .NET) with `SEC_E_NO_CREDENTIALS`; Node/Python (OpenSSL) are unaffected — use built-in web/search tools or `danger-full-access` for those commands.
- One session, one process: don't operate the same session from two harness processes (e.g. the desktop and the CLI) on one `DSH_HOME` at once.

---

## Release process

Every release follows the same steps so the update chain and the landing page never drift:

1. **Bump the version** in `package.json` (`0.1.0` for stable, `0.1.0-rc.N` for prerelease) and commit.
2. **Build and package**: `pnpm --filter @deepseek-ai/dsh-desktop run dist:flat` — artifacts land in `apps/desktop/dist-app2/`.
3. **Publish the GitHub release** with `gh` and upload the three artifacts (exe, blockmap, `latest.yml`). Use `--prerelease` for rc versions; **stable releases must NOT be prerelease** — GitHub's `releases/latest` only resolves to non-prerelease tags, and the landing-page download button depends on it:
   ```sh
   gh release create v0.1.0 --repo zgc37359-lang/harness-desktop --title "Harness Desktop 0.1.0" --notes-file body.md
   gh release upload v0.1.0 --repo zgc37359-lang/harness-desktop dist-app2/dsh-desktop-0.1.0-x64.exe dist-app2/dsh-desktop-0.1.0-x64.exe.blockmap dist-app2/latest.yml --clobber
   ```
4. **Update the landing page** (`apps/desktop/site/index.html`): the download button points at `releases/latest/download/dsh-desktop-<version>-x64.exe` — the filename follows the version, so update it, commit, and redeploy:
   ```sh
   cd apps/desktop/site
   wrangler pages deploy . --project-name harness-desktop --branch main --commit-dirty=true
   ```
5. **Push** the branch; the pre-push hook runs the typecheck.

The live site is https://harness-desktop.pages.dev.

---

## License

[MIT](../../LICENSE)
