# Agent Note: Desktop composition ships its own agent-preset roster

Status: implemented

English | [中文](2026-08-17-desktop-ships-agent-preset-roster.zh.md)

## Problem

After a folder pick, clicking the workspace could not open a session: the
input stayed in its choose-a-workspace posture. The host rejected
`session.create` with `agent-preset-not-found: preset "standard" not found
(available: none)`: the web-app bundle declares the `agent-presets` roster row
with a `standard` default but no roots, and only the `dsh` CLI profile boot
injects the shipped preset root. The desktop boot (`apps/desktop`) never
injected one.

## Decision

`apps/desktop` ships its own read-only preset root
(`config/agent-presets/`, the `standard`/`code`/`cordis`/`minimal` presets
copied from the CLI's shipped root) and the desktop overlay patches the
`agent-presets` row with `default: standard` plus that root under `system`
trust. The packaging path carries the presets in the app directory
(`flatten-deps.mjs` copies `config/agent-presets`, electron-builder `files`
includes them). The preset-only plugin packages that were missing from the
desktop closure (`dsh-persona`, `dsh-tool-ask-user`, `dsh-terminal`,
`dsh-tool-bash-persistent`, `dsh-tool-cordis`,
`dsh-agent-tool-presentation`, `dsh-terminal-bash`) are now real
dependencies. The loader's profiles-fallback resolver also falls back to the
app's own node_modules when the healed profiles junction is missing a newly
added package.

## Verification

- `session.create` through the packaged app's IPC bridge returns
  `{ok:true, value:{sessionId, agentPreset:"standard"}}`.
- Driving the rendered UI: the workspace picker lists the picked workspace,
  clicking it opens the session and the composer becomes enabled
  (hero prompt placeholder instead of the choose-a-workspace placeholder).
- Packaged smoke still exits 0 with `DESKTOP_SMOKE_OK`.

## Alternatives considered

**Reusing the CLI's preset files through the dev tree.** Works on this
checkout but not in the packaged app; the desktop package must own its copy.

**Fixing `healProfilesModuleFallback` to refresh stale junctions.** Touches
shared boot code for a packaged-anchor edge and still leaves the preset
packages out of the closure; the dependency and resolver changes fix the
actual gap.

## Consequences

The desktop package owns its preset roster, so its default agent composition
matches the web surface. Adding a future preset-only plugin requires adding it
to `apps/desktop` dependencies (the closure is the source of truth), and the
resolver fallback keeps the profiles junction from masking a missing link.
