/**
 * Build a flattened production node_modules for electron-builder.
 *
 * pnpm's isolated layout leaves bare workspace packages unresolvable inside
 * the packaged app (resources/app). This script walks the production
 * dependency graph from apps/desktop, dereferences every workspace symlink,
 * and copies each package's real directory (minus nested node_modules) into
 * one flat node_modules tree. The runtime then resolves every bare specifier
 * from the app root, exactly like an npm install.
 *
 * Usage: node scripts/flatten-deps.mjs [target-dir]
 */

import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const target = process.argv[2] ?? join(appDir, 'dist-app-flat')
const nodeModules = join(target, 'node_modules')

/** Resolve `spec` from the package whose real directory is `fromDir`. */
function resolvePackageJson(spec, fromDir) {
  const requireFrom = createRequire(join(fromDir, 'package.json'))
  try {
    return requireFrom.resolve(`${spec}/package.json`)
  } catch {
    return undefined
  }
}

const copied = new Map()
const queue = []

function enqueue(spec, fromDir) {
  const resolved = resolvePackageJson(spec, fromDir)
  if (resolved === undefined) return
  const real = dirname(realpathSync(resolved))
  if (copied.has(spec)) {
    if (copied.get(spec) !== real) {
      console.warn(`flatten-deps: keeping first copy of ${spec} (${copied.get(spec)}), skipped ${real}`)
    }
    return
  }
  copied.set(spec, real)
  queue.push({ spec, real })
}

function copyPackage(realDir, spec) {
  const targetDir = join(nodeModules, spec)
  mkdirSync(dirname(targetDir), { recursive: true })
  cpSync(realDir, targetDir, {
    recursive: true,
    dereference: true,
    filter: (source) => {
      const relative = source.startsWith(realDir) ? source.slice(realDir.length) : source
      return !relative.split(sep).includes('node_modules')
    },
  })
}

// Seed with the app's production dependencies (electron is provided by the runtime).
const rootPackage = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
for (const spec of Object.keys(rootPackage.dependencies ?? {})) {
  // The Electron runtime itself is provided by the packaging toolchain;
  // everything else in dependencies (including electron-updater) is runtime.
  if (spec === 'electron') continue
  enqueue(spec, appDir)
}

while (queue.length > 0) {
  const { spec, real } = queue.shift()
  const manifest = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'))
  const deps = { ...manifest.dependencies, ...manifest.peerDependencies }
  for (const dep of Object.keys(deps ?? {})) {
    enqueue(dep, real)
  }
}

// Assemble the app directory: package.json, compiled main, renderer, flat deps.
rmSync(target, { recursive: true, force: true })
mkdirSync(target, { recursive: true })
const packagedManifest = {
  ...rootPackage,
  // electron-builder must not run its own production install on the flat
  // tree, and rejects a `build` field in the application package.json.
  // Packaging settings live in electron-builder.flat.yml instead.
  dependencies: {},
}
delete packagedManifest.build
writeFileSync(join(target, 'package.json'), `${JSON.stringify(packagedManifest, null, 2)}\n`)
cpSync(join(appDir, 'lib'), join(target, 'lib'), { recursive: true, dereference: true })
cpSync(join(appDir, 'dist', 'renderer'), join(target, 'dist', 'renderer'), { recursive: true, dereference: true })
if (existsSync(join(appDir, 'config', 'agent-presets'))) {
  cpSync(
    join(appDir, 'config', 'agent-presets'),
    join(target, 'config', 'agent-presets'),
    { recursive: true, dereference: true },
  )
}
mkdirSync(nodeModules, { recursive: true })
for (const [spec, real] of copied) copyPackage(real, spec)

console.log(`flatten-deps: ${copied.size} packages -> ${target}`)
