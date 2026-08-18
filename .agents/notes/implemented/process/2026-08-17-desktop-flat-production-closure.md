# Agent Note: Desktop packaged app ships a flattened production node_modules

Status: implemented

English | [中文](2026-08-17-desktop-flat-production-closure.zh.md)

## Problem

pnpm's isolated `node_modules` layout leaves bare workspace and peer-only packages unresolvable inside `resources/app`: the packaged main process failed first with `ERR_MODULE_NOT_FOUND` for `@deepseek-ai/cordis-plugin-group`. `pnpm deploy --legacy --prod` deploys only direct dependencies and drops the transitive closure.

## Decision

`apps/desktop/scripts/flatten-deps.mjs` walks the production graph from `apps/desktop` dependencies plus peerDependencies, dereferences every workspace symlink, and copies each real package directory into one hoisted `node_modules` under `dist-app-flat`. The generated app `package.json` keeps only runtime metadata with empty `dependencies` and no `build` field. `electron-builder.flat.yml` packages that directory into the NSIS installer and `latest.yml`.

electron-builder always excludes `node_modules` from its main file set and copies node modules from its own collector, whose pnpm production graph omits peer-only packages. The desktop app therefore declares those packages (cordis, cordis-plugin-group, cordis-plugin-loader, and the peer-reachable capability packages) as real dependencies so the collector's graph is complete; the asar then matches the flat closure package for package. `pnpm exec electron-builder` is avoided because pnpm 11 runs a dependency-status check before exec and aborts without a TTY; the build invokes electron-builder directly with Node.

## Verification

`node scripts/flatten-deps.mjs` produces the closure; the packaged `app.asar` is diffed against the flat tree for missing `@deepseek-ai/*` packages; the packaged app prints `DESKTOP_SMOKE_OK` and attaches the runtime; `scripts/perf-smoke.mjs` gates cold start and main-process peak memory in CI.

## Alternatives considered

**Standalone closure outside the workspace.** A hoisted tree outside `D:/deepseek-harness` would need every copied `package.json` spec rewritten from `workspace:^` to exact versions before pnpm could resolve it; the in-workspace closure keeps the workspace graph authoritative.

**`beforeBuild` hook returning false.** electron-builder marks node_modules externally handled but still excludes `node_modules/**` from the main file set in v26, producing an almost empty asar; rejected.

**`pnpm deploy --legacy --prod`.** Deploys only direct dependencies and misses the transitive closure; rejected.

## Consequences

The desktop package carries a reproducible 246-package flat closure and boots without a port. Cost: a second packaging path to maintain, native modules still need Electron-ABI rebuilds before production (`npmRebuild: false`), and installers remain unsigned until a code-signing certificate is configured. See the [desktop IPC surface note](../architecture/2026-08-17-desktop-ipc-surface.md) for the transport boundary this closure serves.
