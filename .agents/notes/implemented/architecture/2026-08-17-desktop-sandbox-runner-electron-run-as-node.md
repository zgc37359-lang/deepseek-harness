# Agent Note: Windows sandbox runner starts as plain Node under Electron

Status: implemented

English | [中文](2026-08-17-desktop-sandbox-runner-electron-run-as-node.zh.md)

## Problem

Every sandboxed shell command in the packaged Windows desktop app silently
did nothing: `pwsh` reported exit code 0 with empty stdout/stderr, file
writes never landed, and `exit 42` probes returned 0. Only
`danger-full-access` (no sandbox) worked.

## Root cause

The windows-acl confinement runner invocation is
`[process.execPath, runner.js]`. Inside the packaged Electron app,
`process.execPath` is the app binary, and the runner process was spawned
without `ELECTRON_RUN_AS_NODE=1`; the "runner" was therefore a second app
instance that immediately quit under the single-instance lock — exit 0, one
blank line, no confinement, no command execution. The standalone runner and
the dsh CLI (where `process.execPath` is `node`) worked, which is why only
the packaged app failed.

## Decision

`ConfinedArgv` now carries an optional `env` map that consumers merge over
the spawn environment. The windows-acl rung returns
`{ ELECTRON_RUN_AS_NODE: '1' }` when it runs under an Electron main process;
the bash/pwsh sandbox executors and the bash terminal pass it into their
subprocess/pty spawns. The runner itself is unchanged.

## Verification

- Reproduced outside the app: `DeepSeek Harness.exe runner.js …` exits 0
  with a blank line; adding `ELECTRON_RUN_AS_NODE=1` returns real output.
- The desktop UI matrix's tool-call step (Workspace Write sandbox) now
  receives real pwsh output; the sandbox probe returns
  `sandbox-write-on` under Workspace Write and `sandbox-full-off` under
  Full access.
- Typecheck passes; sandbox-local, shell-executor, and terminal tests cover
  the env hand-off on their platform lanes.

## Alternatives considered

**Setting `ELECTRON_RUN_AS_NODE` in the desktop boot.** This would fix only
the desktop carrier and silently change every future `process.execPath`
spawn; the seam change keeps the requirement next to the runner that has it.

## Consequences

Sandboxed bash/pwsh tools and the sandboxed terminal execute real commands
in the packaged desktop app. Other runners (bwrap, Landlock, Seatbelt) and
plain Node hosts are unaffected because they return no `env`.
