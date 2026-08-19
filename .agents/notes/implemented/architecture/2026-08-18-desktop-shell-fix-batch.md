# Agent Note: Desktop shell fix batch — tray, updates, logs, crashes, protocol

Status: implemented

English | [中文](2026-08-18-desktop-shell-fix-batch.zh.md)

## Problem

A UX pass over the packaged desktop app found ten defects: the tray「新建会话」event had no renderer consumer; auto-update always failed for fork installs (the publish config pointed at the upstream repo) and its UI vanished once the Web UI mounted; downloads with Windows reserved device names reported success while creating unusable files; `main.log` grew without bound; after two renderer crashes the window stayed silently dead; malformed `dsh-bundle` URLs could throw inside the protocol handler; the placeholder manifest poll gave up after 30 s; stray compiled artifacts sat untracked in a package src tree; and a boot-time `fs.Stats` deprecation warning repeated on every launch.

## Decision

- **Tray new session**: the renderer subscribes to `tray:new-session` and runs `activateNewSession` (`src/renderer/tray-actions.ts`) — click the sidebar new-session button (the full create-and-open flow), falling back to the `session.create` RPC lane.
- **Updates**: `build.publish` now points at `zgc37359-lang/deepseek-harness`; `updateStatusText` moved to `src/shared/update-status.ts`; the title bar carries an always-visible update entry (status text, 检查更新, 重启安装 when downloaded).
- **Downloads**: `sanitizeDownloadFilename` prefixes Windows reserved base names (CON/PRN/AUX/NUL/COM1-9/LPT1-9, case-insensitive, with-extension forms included) and normalizes trailing dots/spaces (`src/ipc-validation.ts`).
- **Log rotation**: `src/main-log.ts` appends timestamped lines and rotates by size (`DSH_DESKTOP_LOG_MAX_BYTES`, default 10 MiB; `DSH_DESKTOP_LOG_KEEP`, default 3).
- **Crash recovery**: `src/crash-policy.ts` budgets two auto-reloads, then the main process pushes the new `shell:renderer-crashed` channel; `src/renderer/crash-overlay.tsx` surfaces a 重新加载 recovery surface.
- **Protocol robustness**: `src/bundle-request.ts` decodes defensively and answers 404 instead of throwing.
- **Manifest polling**: `src/renderer/manifest-poller.ts` polls with 500 ms → 2 s backoff until the runtime attaches, aborted on unmount.
- **Repo hygiene**: stray tsc emits in `packages/client/connection/src` were deleted and gitignored.
- **Boot warning**: the `fs.Stats constructor is deprecated.` warning originates inside the Electron runtime's Node (not reproducible in plain Node, absent from every dependency source); the main-process warning handler now logs each distinct message once.
- **E2E**: `scripts/e2e-window.mjs` gained an isolated mode (`DSH_E2E_ISOLATED=1`: temp userData + DSH_HOME + a dummy key that skips the API-key onboarding step, no running-instance guard) and asserts the title-bar update entry, the tray new-session flow, and renderer crash recovery.

## Alternatives considered

**Native dialogs for every recovery surface.** Dialogs work without a renderer, but a native modal for the crash overlay would bypass the app's own styling and cannot offer the in-app recovery flow; the crash-state query keeps the renderer as the single UI surface.

**Unbounded auto-reload.** Reloading forever would hide the failure and risk a crash loop; the bounded budget plus the overlay gives the user an explicit recovery path instead.

## Verification

Each fix landed TDD-first: `ipc-validation`, `crash-policy`, `bundle-request`, `main-log`, `update-status`, `manifest-poller`, `tray-actions` specs, plus jsdom component specs for `CrashOverlay` and the `TitleBar` update entry (root vitest include extended to `apps/*/tests/**/*.spec.tsx`). The extended `e2e-window` gate passes in isolated mode against the packaged exe.

## Consequences

The shell now surfaces every crash and every update state; logs stay bounded; downloads never produce reserved-name ghosts; and the local e2e gate can run beside a live instance without touching its data. The fork feed now carries a published `v0.1.0-rc.7` desktop release (semver tag + installer assets), so the boot check resolves to "已是最新版本" for current installs and offers downloads for newer releases; code signing remains pending (SmartScreen). The desktop base was merged forward to upstream rc.7 in the same release cycle. Old sessions recorded before the thinking defense (separate note) may still display leaked `<thinking>` text in history.
