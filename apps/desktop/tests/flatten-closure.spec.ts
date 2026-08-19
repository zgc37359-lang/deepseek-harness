import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectClosure, verifyFlatClosure } from '../scripts/flatten-deps.mjs'

const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-flatten-'))
  tempDirs.push(dir)
  return dir
}

function makePackage(dir: string, manifest: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('collectClosure', () => {
  it('reports an unresolvable hard dependency with its origin', () => {
    const root = tempDir()
    makePackage(root, { name: 'app', dependencies: { 'pkg-a': '1.0.0' } })
    makePackage(join(root, 'node_modules', 'pkg-a'), {
      name: 'pkg-a',
      dependencies: { 'pkg-b': '1.0.0', 'missing-dep': '1.0.0' },
    })
    makePackage(join(root, 'node_modules', 'pkg-b'), { name: 'pkg-b' })

    const { copied, missing } = collectClosure(root)
    expect(copied.has('pkg-a')).toBe(true)
    expect(copied.has('pkg-b')).toBe(true)
    expect(missing).toEqual([{ spec: 'missing-dep', origin: 'pkg-a' }])
  })

  it('skips absent optional dependencies and joins present ones', () => {
    const root = tempDir()
    makePackage(root, { name: 'app', dependencies: { 'pkg-a': '1.0.0' } })
    makePackage(join(root, 'node_modules', 'pkg-a'), {
      name: 'pkg-a',
      dependencies: {},
      optionalDependencies: { 'present-optional': '1.0.0', 'absent-optional': '1.0.0' },
    })
    makePackage(join(root, 'node_modules', 'present-optional'), { name: 'present-optional' })

    const { copied, missing } = collectClosure(root)
    expect(missing).toEqual([])
    expect(copied.has('present-optional')).toBe(true)
    expect(copied.has('absent-optional')).toBe(false)
  })

  it('resolves dependencies whose package.json is not exported', () => {
    const root = tempDir()
    makePackage(root, { name: 'app', dependencies: { 'pkg-a': '1.0.0' } })
    makePackage(join(root, 'node_modules', 'pkg-a'), {
      name: 'pkg-a',
      exports: { '.': './index.js' },
      dependencies: { 'pkg-b': '1.0.0' },
    })
    makePackage(join(root, 'node_modules', 'pkg-b'), { name: 'pkg-b' })

    const { copied, missing } = collectClosure(root)
    expect(missing).toEqual([])
    expect(copied.has('pkg-a')).toBe(true)
    expect(copied.has('pkg-b')).toBe(true)
  })
})

describe('verifyFlatClosure', () => {
  it('flags missing hard dependencies and non-optional peers', () => {
    const root = tempDir()
    const flatModules = join(root, 'node_modules')
    makePackage(join(flatModules, 'pkg-a'), {
      name: 'pkg-a',
      dependencies: { 'pkg-b': '1.0.0' },
      peerDependencies: { 'pkg-c': '1.0.0', 'optional-peer': '1.0.0' },
      peerDependenciesMeta: { 'optional-peer': { optional: true } },
    })
    makePackage(join(flatModules, 'optional-peer'), { name: 'optional-peer' })

    const copied = new Map<string, string>([['pkg-a', join(root, 'pkg-a')]])
    const errors = verifyFlatClosure(flatModules, copied)
    expect(errors).toEqual([
      'missing dependency pkg-b (dependency of pkg-a)',
      'missing peer pkg-c (peer of pkg-a)',
    ])
  })

  it('flags a missing koffi native binding for the build platform', () => {
    const root = tempDir()
    const flatModules = join(root, 'node_modules')
    makePackage(join(flatModules, 'koffi'), { name: 'koffi' })
    const copied = new Map<string, string>([['koffi', join(root, 'koffi')]])

    const errors = verifyFlatClosure(flatModules, copied, 'win32', 'x64')
    expect(errors).toEqual(['koffi native binding @koromix/koffi-win32-x64 missing from the flat tree'])
  })

  it('passes a complete flat tree', () => {
    const root = tempDir()
    const flatModules = join(root, 'node_modules')
    makePackage(join(flatModules, 'pkg-a'), {
      name: 'pkg-a',
      dependencies: { 'pkg-b': '1.0.0' },
    })
    makePackage(join(flatModules, 'pkg-b'), { name: 'pkg-b' })
    makePackage(join(flatModules, 'koffi'), { name: 'koffi' })
    makePackage(join(flatModules, '@koromix', 'koffi-win32-x64'), {
      name: '@koromix/koffi-win32-x64',
    })

    const copied = new Map<string, string>([
      ['pkg-a', join(root, 'pkg-a')],
      ['pkg-b', join(root, 'pkg-b')],
      ['koffi', join(root, 'koffi')],
      ['@koromix/koffi-win32-x64', join(root, '@koromix', 'koffi-win32-x64')],
    ])
    expect(verifyFlatClosure(flatModules, copied, 'win32', 'x64')).toEqual([])
  })
})
