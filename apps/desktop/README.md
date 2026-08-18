# @deepseek-ai/dsh-desktop

English | [中文](README.zh.md)

Windows desktop application shell over the DeepSeek Harness web UI. This
app owns the Electron shell: frameless window with a fully custom title bar,
tray lifetime, single-instance, and a whitelisted IPC bridge. The main process
hosts the complete Harness plugin tree in-process; the renderer mounts the
existing Web UI below the custom title bar and talks to the runtime through the
desktop IPC transport (unary calls plus downlink event streams), with no
localhost HTTP server.

## Commands

```sh
pnpm --filter @deepseek-ai/dsh-desktop run build
pnpm --filter @deepseek-ai/dsh-desktop run smoke
pnpm --filter @deepseek-ai/dsh-desktop run start
pnpm --filter @deepseek-ai/dsh-desktop run dist
pnpm --filter @deepseek-ai/dsh-desktop run dist:flat
pnpm --filter @deepseek-ai/dsh-desktop run perf:test
pnpm --filter @deepseek-ai/dsh-desktop run bench:stream
```

`smoke` launches a hidden window, waits for the preload ping, prints
`DESKTOP_SMOKE_OK`, and exits; it needs no display interaction.

`dist` runs the regular electron-builder pipeline (intended for a machine with
full native tooling). `dist:flat` is the reproducible packaging path for this
repo: [scripts/flatten-deps.mjs](scripts/flatten-deps.mjs) builds a hoisted
production `node_modules` (dereferencing every workspace symlink, including
peer-only packages such as `@deepseek-ai/cordis-plugin-group`), then
[electron-builder.flat.yml](electron-builder.flat.yml) packages it into the
NSIS installer and `latest.yml` update manifest under `dist-app2/`. Run it with
plain Node; `pnpm exec electron-builder` is avoided because pnpm 11 runs a
dependency-status check before exec that aborts on this workspace without a
TTY.

`perf:test` runs [scripts/perf-test.mjs](scripts/perf-test.mjs) against the
packaged app and gates event-loop drift (p95) plus renderer frame rate.
`bench:stream` runs [scripts/bench-stream.mjs](scripts/bench-stream.mjs), which
starts the scriptable mock LLM server and drives one real Agent session through
the packaged desktop runtime, gating first-token latency and throughput.

## Known Limitations

- Win11 hover snap-layout flyout on the custom maximize button is not
  available; edge-drag snapping and Win+arrow keys remain available.
- Move/size from the custom window menu use a main-process cursor loop and are
  not yet covered by automated tests.
- Packaged builds skip native rebuild (`npmRebuild: false`). `node-pty` loads
  from its N-API prebuilds in the packaged app (verified by the packaged
  `--pty-probe`); the shipped closure needs no Electron-ABI rebuild today.
- Installers and executables are unsigned (no code-signing certificate
  configured) and use the default Electron icon.
- `electron-updater` is wired (check/download/install over IPC) but the
  update feed only becomes meaningful once signed releases exist on GitHub
  Releases. `scripts/perf-smoke.mjs` gates cold start and main-process peak
  memory, `scripts/perf-test.mjs` gates event-loop drift (p95) and renderer
  frame rate, and `scripts/bench-stream.mjs` gates first-token latency and
  throughput against the mock LLM server. Budgets are measured Windows
  baselines with headroom.
- The renderer CSP allows `unsafe-eval` because the vendored Cordis Loader
  and schemastery evaluate config expressions; the renderer stays sandboxed
  and the main process remains the system-capability boundary.
- The Cordis runner inspect/inventory endpoints and `/plugins/events` are
  host-HTTP-only and have no desktop IPC equivalent yet; they log errors in
  the visible-window E2E until a desktop host face exists.
