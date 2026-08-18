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
 * The closure walk FAILS LOUD on any declared dependency that cannot be
 * resolved: a silently skipped package would produce an installer whose
 * plugins import missing code at boot. After the tree is assembled, a second
 * pass verifies that every copied package's hard dependencies are present in
 * the flat tree and that koffi's native binding for the build platform is
 * bundled (optional dependencies are skipped by definition, and
 * platform-skipped optional binaries are expected).
 *
 * Usage: node scripts/flatten-deps.mjs [target-dir]
 */

import { createRequire } from 'node:module'
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const appDir = fileURLToPath(new URL('..', import.meta.url))

/**
 * Resolve `spec` from the package whose real directory is `fromDir`.
 *
 * This probes the node_modules lookup paths for a directory holding the
 * named manifest instead of `require.resolve(`${spec}/package.json`)`: many
 * packages (sharp, koffi, shiki, ...) do not export `./package.json`, and
 * require.resolve would reject them even though their code imports fine.
 */
function resolvePackageJson(spec, fromDir) {
  const requireFrom = createRequire(join(fromDir, 'package.json'))
  for (const searchPath of requireFrom.resolve.paths(spec) ?? []) {
    const candidate = join(searchPath, spec)
    if (existsSync(join(candidate, 'package.json'))) return join(candidate, 'package.json')
  }
  return undefined
}

function copyPackage(realDir, spec, flatNodeModules) {
  const targetDir = join(flatNodeModules, spec)
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

/**
 * Walk the production dependency closure from an app manifest.
 *
 * Hard dependencies (and non-optional peers) that cannot be resolved are
 * reported instead of skipped; optional dependencies join the closure only
 * when present, since a platform pnpm install legitimately omits them.
 * @param appRoot - absolute directory holding the app package.json.
 * @returns the copied-package map and the list of unresolvable declarations.
 */
export function collectClosure(appRoot) {
  const copied = new Map()
  const missing = []
  const queue = []

  const enqueue = (spec, fromDir, origin, { optional = false } = {}) => {
    const resolved = resolvePackageJson(spec, fromDir)
    if (resolved === undefined) {
      if (!optional) missing.push({ spec, origin })
      return
    }
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

  // Seed with the app's production dependencies (electron is provided by the runtime).
  const rootPackage = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
  for (const spec of Object.keys(rootPackage.dependencies ?? {})) {
    // The Electron runtime itself is provided by the packaging toolchain;
    // everything else in dependencies (including electron-updater) is runtime.
    if (spec === 'electron') continue
    enqueue(spec, appRoot, '<app>')
  }

  while (queue.length > 0) {
    const { spec, real } = queue.shift()
    const manifest = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'))
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      enqueue(dep, real, spec)
    }
    for (const dep of Object.keys(manifest.optionalDependencies ?? {})) {
      enqueue(dep, real, spec, { optional: true })
    }
    for (const dep of Object.keys(manifest.peerDependencies ?? {})) {
      const optional = manifest.peerDependenciesMeta?.[dep]?.optional === true
      enqueue(dep, real, spec, { optional })
    }
  }

  return { copied, missing }
}

/**
 * Verify a freshly assembled flat tree against its closure manifest.
 *
 * Every copied package's hard dependencies and non-optional peers must exist
 * at the flat root; koffi additionally needs its platform binding (its
 * optionalDependency) or the packaged sandbox throws at import time.
 * @param flatNodeModules - absolute `node_modules` dir of the flat app tree.
 * @param copied - spec -> real source dir map from {@link collectClosure}.
 * @param platform - build platform (defaults to the current process).
 * @param arch - build architecture (defaults to the current process).
 * @returns the list of verification errors (empty when the tree is complete).
 */
export function verifyFlatClosure(
  flatNodeModules,
  copied,
  platform = process.platform,
  arch = process.arch,
) {
  const errors = []
  const has = (spec) => existsSync(join(flatNodeModules, spec, 'package.json'))
  for (const spec of copied.keys()) {
    const manifestPath = join(flatNodeModules, spec, 'package.json')
    if (!existsSync(manifestPath)) {
      errors.push(`package ${spec} missing from the flat tree`)
      continue
    }
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      if (!has(dep)) errors.push(`missing dependency ${dep} (dependency of ${spec})`)
    }
    for (const dep of Object.keys(manifest.peerDependencies ?? {})) {
      const optional = manifest.peerDependenciesMeta?.[dep]?.optional === true
      if (!optional && !has(dep)) errors.push(`missing peer ${dep} (peer of ${spec})`)
    }
  }
  if (copied.has('koffi')) {
    const native = `@koromix/koffi-${platform}-${arch}`
    if (!has(native)) errors.push(`koffi native binding ${native} missing from the flat tree`)
  }
  return errors
}

function main() {
  const target = process.argv[2] ?? join(appDir, 'dist-app-flat')
  const nodeModules = join(target, 'node_modules')

  const { copied, missing } = collectClosure(appDir)
  if (missing.length > 0) {
    console.error(`flatten-deps: ${missing.length} declared dependencies could not be resolved:`)
    for (const { spec, origin } of missing) {
      console.error(`  - ${spec} (declared by ${origin})`)
    }
    process.exit(1)
  }

  // Assemble the app directory: package.json, compiled main, renderer, flat deps.
  rmSync(target, { recursive: true, force: true })
  mkdirSync(target, { recursive: true })
  const rootPackage = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8'))
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
  for (const [spec, real] of copied) copyPackage(real, spec, nodeModules)

  const errors = verifyFlatClosure(nodeModules, copied)
  if (errors.length > 0) {
    console.error(`flatten-deps: flat closure verification failed:`)
    for (const error of errors) console.error(`  - ${error}`)
    process.exit(1)
  }

  console.log(`flatten-deps: ${copied.size} packages -> ${target}`)
}

const isMain = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (isMain) main()
