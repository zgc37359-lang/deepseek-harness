# @deepseek-ai/dsh-desktop-host

English | [中文](README.zh.md)

In-process desktop host for the Electron application. It provides
`ctx.desktopHost` over the transport-free gateway: unary/respond reuse
`toFetchHandler`, the mux/host downlink streams come straight from
`apiProxy.events`, and the boot manifest is the `clientModules` graph with
bundle URLs rewritten to the `dsh-bundle://bundle` protocol. The exported
`DesktopWebServerStub` satisfies the client-modules node half's `webServer`
inject without ever listening, so the desktop profile boots no HTTP server.

## Model Experience

None; the desktop host moves already-composed protocol messages between the
renderer and the same host services the web deployment uses.

## Known Limitations and Deferred Work

- The desktop composition disables the web transport rows (`webserver`,
  `web-runtime`, `web-startup`) and keeps the `connection` row mounted with a
  desktop config (`trustedHosts: []`, no `webRuntime` inject) so the browser
  `connection` service exists while its node half registers only on the inert
  stub.
- Host HTTP-only surfaces have no IPC equivalent yet: the Cordis runner
  inspect/inventory endpoints and the `/plugins/events` SSE stream answer
  nothing in the desktop host.
- Client bundles must be built before the modules scan runs; the same
  `pnpm run build` requirement as the web deployment applies.
