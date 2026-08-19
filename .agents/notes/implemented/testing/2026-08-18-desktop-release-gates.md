# Agent Note: Desktop release gates and IPC validation extraction

Status: implemented

English | [中文](2026-08-18-desktop-release-gates.zh.md)

## Problem

The desktop shell shipped with performance gates (cold start, memory,
event-loop, frame rate, first token) but no functional, stress, install, or
input-validation coverage: the 60-step UI matrix and the stress lane existed
only as local scripts, the NSIS install/upgrade/uninstall path had zero
automated coverage, and every IPC argument check lived inline in
`main.ts` where no test could reach it. CI could not run the interactive
gates at all: they required a real model backend that keyless runners lack.

## Decision

- **Keyless interactive gates.** New `scripts/mock-llm.mjs` starts the
  repo's scriptable mock LLM server on an ephemeral port and injects
  `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL` into the packaged app via
  Playwright's `env` option. `ui-matrix.mjs` and `stress-test.mjs` use it:
  a real `DEEPSEEK_API_KEY` keeps the real provider, otherwise the mock
  replies with the fixed text each lane's assertions need (`seed-ok
  matrix-ok button-ok` for the matrix; `burst-ok` plus 120 `line-N` rows
  for the stress lane). Steps that require genuine tool execution
  (`conversation:user-question`, `conversation:todo-panel`,
  `hero:stop-generation`) skip explicitly under the mock.
- **Install cycle gate.** New `scripts/install-cycle.mjs` drives the real
  NSIS installer end to end: silent install to a scratch directory, smoke
  launch, local-feed upgrade (generic provider via
  `DSH_DESKTOP_UPDATE_FEED_URL`, including a corrupted-package error case),
  silent uninstall, and residue assertions (install dir, Start Menu,
  HKCU uninstall keys) with user-data retention. It refuses to run while
  any DeepSeek Harness instance is live: the NSIS installer and
  uninstaller terminate running instances of the product name and rewrite
  Start Menu and registry entries regardless of the target directory. The
  gate runs on a dedicated hosted runner in `windows-desktop.yml`.
- **Soak lane.** New `scripts/soak-test.mjs` drives N turns through the
  real UI against the mock LLM and gates main-process RSS and handle
  growth, catching leaks a single-turn gate cannot see.
- **Idle CPU and handle sampling.** `perf-smoke.mjs` adds peak handle
  count; `perf-test.mjs` samples main-process CPU during its visible
  window as the idle baseline. `--smoke-test` exits immediately after the
  marker, so idle CPU cannot be measured there.
- **IPC validation extraction.** New `src/ipc-validation.ts` holds the
  pure argument checks every whitelisted channel needs (window menu
  whitelist, runtime unary args, download filename sanitization, reveal
  path containment, clipboard/stream checks). `main.ts` calls only these.
  A fuzz matrix in `tests/ipc-validation.spec.ts` covers malformed and
  boundary inputs; it caught a real defect: the reveal-path check used a
  bare prefix match and admitted sibling directories such as
  `Downloads2`. The check now requires an exact equality or a
  path-separator boundary.
- **Local crash collection.** `crashReporter.start({ uploadToServer:
  false })` runs before app ready so every renderer is monitored; dumps
  land under userData `crashDumps` and the diagnostics export copies them
  when present.
- **CodeQL.** New `codeql.yml` scans the desktop surface only
  (`apps/desktop`, `packages/host/desktop-host`, `packages/client/
  connection`) to stay inside the job budget.
- **Windows hosted image.** `windows-2019`/`windows-2022` hosted images
  are retired; the install-cycle job uses `windows-2025`. A true Win10
  22H2 baseline requires a self-hosted Win10 runner (deferred).

## Verification

- `tests/ipc-validation.spec.ts` (17 tests) and
  `tests/desktop-runtime.spec.ts` (8 tests, subscription fan-out) pass;
  the full desktop suite is 34 tests green.
- `pnpm run typecheck` passes on the desktop app.
- `mock-llm.mjs` starts, serves, and closes the mock server (verified
  locally); `isDesktopRunning()` correctly detects a live instance and the
  three Playwright gates refuse with a clear message instead of a silent
  single-instance timeout.
- The interactive and install gates are CI-only signals in
  `windows-desktop.yml` (never part of an all-checks-passed verdict) and
  run on fresh hosted runners, so the NSIS side effects stay confined.

## Alternatives considered

- **WinAFL-style fuzzing of the exe.** The input surface is IPC, not a
  file parser; the validation matrix plus the existing JSON schema checks
  cover it with far less machinery.
- **Running install-cycle on the self-hosted perf runner.** Rejected: the
  uninstaller terminates running instances and rewrites product-name
  resources, which would corrupt the shared runner.
- **Mocking Electron in unit tests for main.ts.** Rejected: the pure
  checks moved to `ipc-validation.ts` are what needs testing; the glue
  stays thin and untested by design.

## Consequences

- All eight desktop gates now run in CI against the packaged exe; the
  interactive ones are keyless.
- The install-cycle gate cannot run on a developer machine with a live
  instance or an existing installation — that is a hard guard, not a
  convenience skip.
- New IPC channels must add their argument checks to `ipc-validation.ts`
  (and the fuzz matrix), keeping `main.ts` free of inline validation.
