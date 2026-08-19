/**
 * Desktop runtime boot: compose the base + web-app bundle rows, disable the
 * web transport rows, provide the inert web-server stub, and attach the
 * in-process Harness host to the renderer bridge.
 * @module @deepseek-ai/dsh-desktop/desktop-boot
 */

import { writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { Context } from '@deepseek-ai/cordis'
import { boot, healProfilesModuleFallback, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-desktop-host'
import { DesktopWebServerStub } from '@deepseek-ai/dsh-desktop-host'
import { attachDesktopRuntime, detachDesktopRuntime, type DesktopRuntimeHost } from './desktop-runtime.ts'

const BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']
const requireFromApp = createRequire(import.meta.url)
// Built layout: lib/types/desktop-boot.js -> apps/desktop/package.json.
const INSTALL_ANCHOR = fileURLToPath(new URL('../../package.json', import.meta.url))
// Shipped agent-preset root, beside the desktop app's own config in both the
// source and packaged layouts. The web-app bundle declares the roster row
// with a `standard` default but no roots; the CLI profile boot injects the
// shipped root for `dsh --profile web`, so the desktop boot does the same
// with its own copy.
const DESKTOP_PRESET_ROOT = fileURLToPath(new URL('../../config/agent-presets/', import.meta.url))

let bootedCtx: Context | null = null

/** The resolvers consulted by {@link resolveRuntimeSpecifier}, in order. */
export interface RuntimeSpecifierResolvers {
  /** Resolve from the app's own packaged closure (resources/app.asar). */
  app(specifier: string): string
  /** Resolve from the profiles fallback (out-of-tree plugins). */
  profiles(specifier: string): string
}

/**
 * Resolve one bare loader-entry specifier, preferring the app closure.
 *
 * The app's own closure is authoritative for in-box plugins, so an installed
 * app on a developer machine can never pick up stale dev-tree links from the
 * profiles fallback. The profiles fallback remains the second anchor for
 * out-of-tree plugin names the app does not ship.
 * @param specifier - the bare package specifier to resolve.
 * @param resolvers - the ordered resolution anchors.
 * @returns the resolved absolute file path.
 * @throws the profiles resolver's error when neither anchor can resolve.
 */
export function resolveRuntimeSpecifier(
  specifier: string,
  resolvers: RuntimeSpecifierResolvers,
): string {
  try {
    return resolvers.app(specifier)
  } catch {
    return resolvers.profiles(specifier)
  }
}

/** The booted Harness root context, or null while none is attached. */
export function desktopRuntimeContext(): Context | null {
  return bootedCtx
}

/** Rows the desktop replaces or disables over the web composition. */
const DESKTOP_OVERLAY: PatchOptions[] = [
  { id: 'webserver', disabled: true },
  { id: 'web-runtime', disabled: true },
  { id: 'web-startup', disabled: true },
  { id: 'hmr', disabled: true },
  // The connection row stays mounted: its node half registers the /api
  // bridge on the inert stub (harmless), and its client half provides the
  // `connection` service every browser plugin depends on, carried over the
  // desktop IPC transport instead of HTTP. The webRuntime injection is what
  // the desktop composition removes.
  {
    id: 'connection',
    name: '@deepseek-ai/dsh-client-connection',
    inject: [],
    config: { trustedHosts: [] },
  },
  {
    id: 'agent-presets',
    config: {
      default: 'standard',
      roots: [{ path: DESKTOP_PRESET_ROOT, trust: 'system' }],
    },
  },
  { insert: [{ id: 'desktop-host', name: '@deepseek-ai/dsh-desktop-host' }] },
  { insert: [{ id: 'grants', name: '@deepseek-ai/dsh-grants' }] },
]

function bundlePatchPath(packageName: string): string {
  return requireFromApp.resolve(`${packageName}/cordis.patch.yml`)
}

/**
 * Boot the in-process Harness tree and attach it to the renderer bridge.
 * @returns the attached runtime host.
 */
export async function bootDesktopRuntime(): Promise<DesktopRuntimeHost> {
  healProfilesModuleFallback(INSTALL_ANCHOR)
  const profilesRoot = join(resolveDshHome(), 'profiles')
  const requireFromProfiles = createRequire(join(profilesRoot, 'noop.js'))
  // The loader anchors ctx.baseUrl at the config file's directory, and
  // client-modules resolves every dsh.client row from that anchor. The config
  // therefore lives in the profiles root, whose node_modules is the flat
  // closure maintained by healProfilesModuleFallback; a temp dir would leave
  // the client boot graph empty.
  const rootConfig = join(profilesRoot, 'desktop-cordis.yml')
  writeFileSync(rootConfig, '[]\n')
  const patches: PatchOptions[] = [
    ...BUNDLES.flatMap(packageName => loadOverlayPatches('dsh-desktop', bundlePatchPath(packageName))),
    ...DESKTOP_OVERLAY,
  ]
  const ctx = await boot('dsh-desktop', rootConfig, patches, (hostCtx) => {
    // Electron's Node exposes no internal ESM ModuleLoader, so the Loader's
    // native-internals probe returns undefined. Provide a plain-resolver
    // internal that resolves bare packages through the app closure first,
    // then the profiles fallback for out-of-tree plugin names.
    ;(hostCtx.loader as { internal: unknown }).internal = {
      import: async (specifier: string): Promise<unknown> => {
        if (specifier.startsWith('file://')) return import(specifier)
        const resolved = resolveRuntimeSpecifier(specifier, {
          app: candidate => requireFromApp.resolve(candidate),
          profiles: candidate => requireFromProfiles.resolve(candidate),
        })
        return import(pathToFileURL(resolved).href)
      },
    }
    // The WebServer constructor registers itself on the context; constructing
    // the stub is what satisfies the client-modules webServer inject.
    new DesktopWebServerStub(hostCtx)
  // Dev anchor: apps/cli declares the full profile plugin closure. The
  // packaging milestone gives the desktop app its own closure manifest.
  }, pathToFileURL(profilesRoot).href + '/')
  const service = ctx.get('desktopHost')
  if (service === undefined) throw new Error('desktop boot: desktopHost service missing')
  const host: DesktopRuntimeHost = {
    unary: (method, body) => service.unary(method, body),
    getBootManifest: () => service.manifest(),
    getBundle: id => service.bundle(id),
    onFrame: listener => service.onFrame(listener),
    onEnd: listener => service.onEnd(listener),
  }
  attachDesktopRuntime(host)
  bootedCtx = ctx
  return host
}

/** Dispose the booted Harness tree and detach the renderer bridge. */
export async function disposeDesktopRuntime(): Promise<void> {
  detachDesktopRuntime()
  const ctx = bootedCtx
  bootedCtx = null
  if (ctx !== null) await ctx.fiber.dispose()
}
