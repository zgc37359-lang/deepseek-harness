# Agent Note: Packaged Electron runs the native folder-dialog worker as Node

Status: implemented

English | [中文](2026-08-17-desktop-native-picker-worker-unpack.zh.md)

## Problem

In the packaged desktop app, `host.pickDirectory` failed with "win32 folder
dialog worker exited before reporting a result". `win32-dialog-host.ts` spawns
`process.execPath` with the worker script, but in packaged Electron
`process.execPath` is the app executable: launching it re-runs the app, which
exits on the single-instance lock, instead of the worker. A plain Node child
also cannot read the worker from inside `app.asar`.

After fixing the launch, selecting a folder still crashed the worker with a
`napi_get_last_error_info` fatal error: `readUtf16` viewed a fixed 32 KiB
window past the COM display-name allocation, which koffi 3.1 cannot read.

## Decision

`dsh-host-directory-picker-native` detects the packaged Electron plane by the
app executable's `resources/app.asar` (execPath alone is ambiguous when the
profiles fallback resolves the plugin tree into a dev checkout) and spawns the
worker differently: the app executable is launched with `ELECTRON_RUN_AS_NODE=1`
so it behaves as plain Node. The worker path is the asar-unpacked copy when the
module loaded from inside `app.asar` (electron-builder `asarUnpack` for the
picker package, `koffi`, and `@koromix` platform binaries), or the real
on-disk sibling when the module resolved through the dev tree. The spawn
triple and path decision are pure, tested helpers.

The string read now uses `koffi.decode.string16(ptr)`, the supported
NUL-terminated UTF-16 reader for koffi's BigInt pointers; the fixed-window
`koffi.view` path is gone.

## Verification

- New unit test pins the packaged spawn triple (unpacked worker path plus
  `ELECTRON_RUN_AS_NODE`).
- Packaged probe: spawning the exe in run-as-node mode with the unpacked
  worker reports `{kind:'showing',threadId}` — koffi/COM load and the dialog
  thread starts.
- The packaged app folder picker then opens the native dialog (user-verified).
- An automated real pick drives the dialog through UI Automation, selects
  `D:\deepseek-harness`, and the worker reports
  `{kind:'done',path:"D:\\deepseek-harness"}` and exits 0 without crashing.

## Alternatives considered

**Electron `dialog.showOpenDialog` as a desktop picker backend.** Native and
simpler, but requires a new desktop backend row and a service swap; the shared
koffi worker already implements the seam and only its packaging and launch
were broken. Kept the shared implementation.

**Bundling a real Node binary.** Heavyweight and unnecessary because Electron
itself can run as Node.

## Consequences

The desktop package grows by the unpacked picker and koffi files; the shared
worker still runs under plain Node for web/CLI surfaces. Any future native
module loaded by a spawned worker in the packaged app must follow the same
unpack plus `ELECTRON_RUN_AS_NODE` pattern.
