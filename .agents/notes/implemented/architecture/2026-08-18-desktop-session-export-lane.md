# Agent Note: Desktop Session export rides an RPC lane with a visible save path

Status: implemented

English | [中文](2026-08-18-desktop-session-export-lane.zh.md)

## Problem

The `/export` command failed in the packaged desktop app with
"Session 导出失败 / Failed to fetch". The web download controller fetches
`/api/session.export` from `location.origin`, but the desktop renderer has no
HTTP origin (`dsh://`, origin `null`); the fallback `http://dsh.internal` is
unreachable. Even after routing bytes, the success dialog still said "browser
is downloading" and never told the user where the file landed.

## Decision

- Host: new `session.exportZip` RPC reuses the session-log export pipeline
  and returns the ZIP bytes as base64 plus the conventional filename.
- Desktop main/preload: `desktop.download.save(filename, base64)` writes to
  the user's Downloads folder; `desktop.download.reveal(path)` opens it in
  Explorer (paths outside Downloads are refused).
- Client controller: when the desktop bridge is present, the export rides
  the RPC lane instead of `fetch`, and publishes the saved path into the
  download dialog state.
- Dialog: desktop success shows "已保存到：<path>" and a
  "在文件夹中显示" button; web deployments keep the browser copy.

## Verification

- Unit tests cover the desktop RPC branch (success and failure), the saved
  path in the dialog, and the reveal action.
- Packaged app: `/export` writes `dsh-session-<id>.zip` into Downloads and
  the success dialog shows the path.

## Alternatives considered

**Serving the HTTP endpoint from the desktop host.** The desktop host
deliberately has no web server; the RPC lane matches the rest of the bridge.

## Consequences

Session export works on desktop with a desktop-appropriate confirmation.
Web deployments keep the same controller and dialog copy as before.
