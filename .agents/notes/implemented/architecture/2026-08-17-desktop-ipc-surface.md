# Agent Note: Desktop IPC transport replaces the localhost Web surface

Status: implemented

English | [中文](2026-08-17-desktop-ipc-surface.zh.md)

## Problem

The web client connection layer reaches the host through HTTP/SSE/WebSocket served by a localhost web server. A Windows desktop product must not depend on a localhost HTTP port: ports collide with other software, the network surface widens the attack area, and process cleanup becomes a separate lifecycle problem.

## Decision

`apps/desktop` is an Electron app whose main process hosts the complete Harness plugin tree in-process and never starts the webserver. The renderer reuses the existing React Web UI and its `AbstractApiClient` seam: the desktop carrier in `packages/client/connection` replaces HTTP/SSE/WebSocket with Electron IPC — unary calls and `respond` travel through the preload invoke bridge, and the `events.mux`/`events.host` downlinks are pushed IPC frames. Envelope parsing, rpcId validation, and reconnect semantics stay in the base class.

`packages/host/desktop-host` provides the host half: `DesktopHost` routes unary calls through `toFetchHandler`, exposes the two downlink streams directly from `apiProxy.events`, and rewrites the boot manifest to the `dsh-bundle://` protocol. `DesktopWebServerStub` satisfies the client-modules injection contract without ever listening. The renderer runs sandboxed with a whitelisted preload bridge; the main process is the only system-capability entry (window, tray, dialogs, updater, external links).

The desktop composition disables `webserver`, `web-runtime`, and `web-startup`, but keeps the `connection` row mounted with a desktop config (empty `trustedHosts`, no `webRuntime` inject): its node half registers only on the inert stub while its client half provides the `connection` service every browser plugin depends on. Both the unary/respond `AbstractApiClient` face and the generic `connection.rpc` channel ride the same preload bridge. The client boot config lives at `$DSH_HOME/profiles/desktop-cordis.yml` so `ctx.baseUrl` anchors at the flat profiles `node_modules`; the renderer CSP allows `unsafe-eval` because the vendored Loader and schemastery evaluate config expressions.

## Verification

Carrier contract tests pin the IPC envelope, automatic carrier selection, and the generic-RPC bridge; the packaged app passes a Playwright window E2E that boots the runtime, mounts the full Web UI shell, and asserts a non-empty boot manifest. HTTP-only host surfaces without an IPC equivalent (Cordis runner inspect/inventory, `/plugins/events`) remain logged as known gaps.

## Alternatives considered

**Localhost HTTP MVP.** Wrapping `dsh web` in Electron is fastest but keeps the port, process, and network-attack lifecycle problems; rejected for the release-shaped product.

**Tauri/WebView2 with a Node sidecar.** The runtime still requires Node, so the sidecar is unavoidable and adds a second process and Rust surface; Electron keeps one process tree and reuses the existing React client.

**Renderer fetch against a main-process HTTP endpoint.** This would recreate a network protocol over loopback for no benefit; IPC is the native bridge and the carrier seam already isolates the transport.

## Consequences

The desktop app owns no port and no network listener. The renderer trusts only the whitelisted IPC surface, and the main process owns all native capabilities. The in-process boot composes the client bundle from the same manifests as the web surface, so UI behavior stays on one implementation. The packaged app must carry the complete plugin closure, including peer-only packages — see the [flattened production closure note](../process/2026-08-17-desktop-flat-production-closure.md). Browser downlink semantics remain on the [WebSocket carrier note](2026-08-04-websocket-downlink-carrier.md).
