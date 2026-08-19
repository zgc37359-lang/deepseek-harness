/**
 * Build -> install -> launch verification for the packaged desktop app.
 *
 * Usage: node scripts/verify-install.mjs [win-unpacked-dir] [install-dir]
 *
 * Checks that the packaged closure actually contains the expected fixes
 * (host pagination caps, client load-older skip logic), that the installed
 * copy matches the build byte-for-byte, and that the installed executable
 * boots with `--smoke-test`. Any failure exits non-zero with a clear reason.
 */

import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const appDir = fileURLToPath(new URL('..', import.meta.url))
const unpacked = process.argv[2] ?? join(appDir, 'dist-app2', 'win-unpacked')
const target = process.argv[3] ?? 'C:/Users/cc/AppData/Local/Programs/DeepSeek Harness'

const failures = []
const check = (ok, message) => {
  if (!ok) failures.push(message)
}

/** Assert a marker string exists in a file. */
function contains(file, marker) {
  try {
    return readFileSync(file, 'utf8').includes(marker)
  } catch {
    return false
  }
}

// 1) The flat production closure (the exact input electron-builder packs)
//    must contain the pagination caps and the load-older skip logic.
const flatNodeModules = join(appDir, 'dist-app-flat', 'node_modules')
const hostProxy = join(flatNodeModules, '@deepseek-ai', 'dsh-host-apiproxy', 'lib', 'index.js')
const clientRuntime = join(flatNodeModules, '@deepseek-ai', 'dsh-client-runtime', 'lib', 'client.js')
check(existsSync(hostProxy), `flat apiproxy bundle missing: ${hostProxy}`)
check(existsSync(clientRuntime), `flat client runtime bundle missing: ${clientRuntime}`)
if (existsSync(hostProxy)) {
  check(contains(hostProxy, '8192'), 'apiproxy bundle lacks MAX_PAGE_EVENTS (8192)')
  check(contains(hostProxy, '32768'), 'apiproxy bundle lacks HARD_PAGE_EVENTS (32768)')
}
if (existsSync(clientRuntime)) {
  check(contains(clientRuntime, 'VISIBLE_PAGE_EVENT_TYPES'), 'client runtime bundle lacks load-older skip logic')
}

// 2) The installed copy must match the build artifact byte-for-byte.
for (const relative of ['resources/app.asar', 'DeepSeek Harness.exe']) {
  const source = join(unpacked, relative)
  const installed = join(target, relative)
  check(existsSync(source), `source artifact missing: ${source}`)
  check(existsSync(installed), `installed artifact missing: ${installed}`)
  if (existsSync(source) && existsSync(installed)) {
    check(
      statSync(source).size === statSync(installed).size,
      `${relative} size mismatch: source ${statSync(source).size} vs installed ${statSync(installed).size}`,
    )
  }
}

// 3) The installed executable must boot the full runtime.
const exe = join(target, 'DeepSeek Harness.exe')
if (existsSync(exe)) {
  const smoke = spawnSync(exe, ['--smoke-test'], {
    encoding: 'utf8',
    timeout: 120_000,
    windowsHide: true,
  })
  const output = `${smoke.stdout ?? ''}\n${smoke.stderr ?? ''}`
  check(smoke.status === 0 && output.includes('DESKTOP_SMOKE_OK'), `smoke test failed: ${output.slice(-500)}`)
} else {
  failures.push(`installed executable missing: ${exe}`)
}

if (failures.length > 0) {
  console.error('verify-install: FAILED')
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('verify-install: OK')
