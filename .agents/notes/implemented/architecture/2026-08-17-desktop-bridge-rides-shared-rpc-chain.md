# Agent Note: Desktop bridge rides the shared connection RPC chain

Status: implemented

English | [中文](2026-08-17-desktop-bridge-rides-shared-rpc-chain.zh.md)

## Problem

The desktop host routed every client unary call straight into the apiProxy
unary table, so every Remote endpoint (commands/list, goals/*, plugin
inventory, cordis-runner, message feedback) returned 404: in the web
composition those endpoints are claimed by the Typert gateway interceptor on
the shared `/api` connection RPC chain before the unary fallback, and the
desktop bridge bypassed that chain. Every UI control backed by a Remote
silently did nothing (slash/command menus, plugin inventory, plugin config
details).

## Decision

`DesktopHost` injects the `connection` service and composes the same shared
fetch handler the web transport uses:
`connection.createSharedFetchHandler('/api', { fetch: toFetchHandler(apiProxy) })`.
Remote endpoints claimed by the Typert gateway dispatch through it; everything
else falls back to the unary table. Requests use a loopback authority
(`http://127.0.0.1/api/...`) because the bridge is IPC-local and the trust
fence treats loopback as trusted.

## Verification

- Two new unit tests (red-green): a Remote endpoint is served by the
  connection chain; an ordinary method still falls back to the unary handler.
- Packaged app: `commands/list` over the IPC bridge returns the six host
  commands; the slash menu renders them; the settings plugin inventory panel
  renders without the previous `dynamicCordisRunner` errors; clicking a plugin
  row opens its config form.

## Alternatives considered

**Duplicating gateway dispatch inside desktop-host.** Would drift from the
web composition; the shared chain is the single routing source.

**Serving a real loopback HTTP server.** Reintroduces the port/lifecycle
problems the desktop IPC surface exists to avoid.

## Consequences

The desktop surface now matches web behavior for all Remote-backed controls.
Remaining HTTP-only gaps narrow to `/plugins/events` (optional client-modules
noise) and `host.listDirectory` (native picker serves only `native`).
