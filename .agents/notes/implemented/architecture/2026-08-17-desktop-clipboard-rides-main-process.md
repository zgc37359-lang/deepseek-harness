# Agent Note: Desktop clipboard writes ride the main-process bridge

Status: implemented

English | [中文](2026-08-17-desktop-clipboard-rides-main-process.zh.md)

## Problem

Copy buttons in the packaged desktop app reported success but wrote nothing:
in Electron's sandboxed renderer `navigator.clipboard.writeText` resolves
without touching the system clipboard, so the shared `writeClipboard` helper
claimed success while the user's clipboard stayed unchanged.

## Decision

The preload exposes a `clipboard.writeText` bridge backed by the main-process
Electron `clipboard` module over a whitelisted IPC channel
(`clipboard:write-text`). `writeClipboard` now prefers that bridge whenever
the desktop preload is present, falling back to the async Clipboard API and
`execCommand` on other hosts.

## Verification

- Unit tests pin bridge preference, rejection handling, and the web fallback.
- Real UI click on a diff copy button writes the diff body to the system
  clipboard (verified with `Get-Clipboard`).

## Alternatives considered

**Granting clipboard permissions to the renderer.** The renderer API is a
silent no-op in this sandbox configuration; the main process is the
system-capability boundary the desktop already owns.

## Consequences

Every copy control that goes through `writeClipboard` now writes real content
in the packaged app. Web and jsdom hosts keep their existing paths.
