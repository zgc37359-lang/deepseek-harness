# Agent Note: Desktop streaming and main-thread performance lanes

Status: implemented

English | [中文](2026-08-17-desktop-performance-lanes.zh.md)

## Problem

`scripts/perf-smoke.mjs` gated cold start and peak main-process memory, but
streaming and main-thread responsiveness had no desktop lane: there was no way
to prove the packaged app streams a model reply through its in-process
runtime, and no measurement for event-loop drift or renderer frame rate.

## Decision

`apps/desktop` gains two probe modes and two gates:

- `--bench-stream "<task>"` boots the desktop runtime without a window, creates
  one fresh Agent through `ctx.agents` (the same driver shape as
  `dsh-headless`), submits the task as an ordinary user message, waits for
  quiescence, flushes the Session, and prints first-token latency (first
  non-empty text delta), output chars/chunks, provider output tokens, total
  duration, and chars per second. `scripts/bench-stream.mjs` starts the keyless
  `dsh-llm-mock-server` (port 0, `--repeat-last` so follow-up calls such as
  title generation succeed), points `DEEPSEEK_BASE_URL`/`DEEPSEEK_API_KEY` at
  it, launches the packaged exe, and gates the result.
- `--perf-test` measures main-process event-loop drift with a
  self-rescheduling `setTimeout` tick (16 ms nominal) and counts renderer
  `requestAnimationFrame` callbacks over the same window.
  `scripts/perf-test.mjs` launches the packaged exe and gates p95 drift and
  mean FPS.

The metric folds are pure functions with deterministic unit tests; the runner
clocks are injectable. Budgets are measured Windows baselines with headroom,
not invented numbers: p95 drift 50 ms (baseline ~31.5 ms), mean FPS floor 30
(baseline ~120), first token 2000 ms (baseline 110 ms), total 5000 ms
(baseline 118 ms), throughput 100 chars/s (baseline ~568).

## Verification

- Unit tests `apps/desktop/tests/bench-stream.spec.ts` and
  `apps/desktop/tests/perf-test.spec.ts` cover the summarizers and the
  injectable drift sampler through red-green.
- Packaged runs on this machine: perf-test p95 31.5 ms / 120 FPS, exit 0;
  bench-stream first token 110 ms, total 118 ms, 67 chars / 9 chunks,
  568 chars/s, reason `completed`.
- `windows-desktop.yml` runs both scripts with the budgets above.

## Alternatives considered

**Renderer-driven Playwright chat automation.** Measures the full UI path but
is flaky, slow, and depends on chat DOM; the in-process agent lane measures the
same runtime/LLM wire path deterministically and the visible-window E2E
already covers UI mounting.

**Using `dsh --profile headless` as the benchmark.** That exercises the CLI
composition, not the desktop runtime, IPC, or packaged closure; rejected for
the desktop lane.

## Consequences

Streaming and main-thread budgets are locally gated and CI-tracked.
`--bench-stream` requires the packaged app plus the repo-internal mock server;
the mock needs no network or credentials. Remaining boundary: budgets are
single-machine baselines; the CI job will surface runner variance and can
tighten budgets once the windows-desktop workflow has history.
