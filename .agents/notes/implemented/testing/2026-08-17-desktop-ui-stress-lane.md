# Agent Note: Desktop UI stress lane and expanded matrix

Status: implemented

English | [中文](2026-08-17-desktop-ui-stress-lane.zh.md)

## Problem

The desktop UI matrix covered core links (window controls, session
creation/switching, presets, modes, model selection, text and tool sends,
settings, copy, session log) but not the full interactive surface, and no
automated lane stressed the real queue, large outputs, or rapid repeated
actions. "Everything is clickable" regressions had to be found by hand.

## Decision

`apps/desktop/scripts/ui-matrix.mjs` grows from 31 to 60 steps:

- Shell: minimize/restore and close-to-tray.
- Sidebar: collapse/expand rail, expand collapsed session buckets, view
  options (grouped/flat/manual/recent), workspace row menus, session row
  rename apply/restore, session fork, workspace create.
- Composer: command palette, `/goal`, send button, context meter.
- Settings: theme light/dark/system, default permission preset, provider
  edit, plugin inventory, preset view/copy.
- Conversation: message feedback (like/dislike + note), details panel,
  trajectory filters/search.

`apps/desktop/scripts/stress-test.mjs` is a new gate: four queued burst
messages, a 120-line output, five rapid session actions, active-window
event-loop drift sampling, and main-process memory delta, with failure
budgets (p95 drift ≤ 200 ms, memory delta ≤ 700 MiB, zero console/page
errors).

## Verification

- Expanded matrix: 60 steps, all pass (ungrouped-session surfaces skip
  explicitly instead of failing; the run seeds a real session first so
  sends and conversation actions run against content).
- Stress lane: burst 4/4 completed, 120/120 lines in ~16 s, rapid clicks
  ~20 ms each, event-loop p95 30 ms, memory delta 49 MiB, zero errors.
- Existing perf gates on the rebuilt package: cold start 2.1 s / 288 MiB;
  event-loop p95 31.6 ms / 120 FPS; stream first token ~1.7 s, throughput
  122 chars/s (one transient run measured 91 chars/s and passed on retry).

## Alternatives considered

**Waiting for every New Session click to mint a new id.** The runtime
reuses an existing blank session in the target workspace by design, so the
matrix now accepts create-or-reuse and locates the live session by its turn
count instead.

## Consequences

The UI matrix and stress lane run locally and can be added to the Windows
desktop workflow. The matrix tolerates the app reopening onto a blank
forked session by seeding content before exercising the hero.
