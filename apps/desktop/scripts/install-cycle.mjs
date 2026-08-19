/**
 * Packaged-app install/upgrade/uninstall cycle gate for Windows CI.
 *
 * DANGER: the NSIS installer and uninstaller terminate any running
 * "Harness Desktop.exe" process and rewrite Start Menu entries and
 * uninstall keys matching the product name, regardless of the install
 * target directory. This gate therefore refuses to run entirely while a
 * Harness Desktop instance is live — never bypass that guard.
 *
 * Drives the real NSIS installer: silent install to a scratch directory,
 * smoke-launch the installed exe, exercise the electron-updater upgrade
 * path against a local generic feed (happy path plus a corrupted-package
 * error case), then silent uninstall with residue assertions. The
 * uninstaller must leave the install directory, Start Menu entries, and
 * registry uninstall keys gone while user data under %APPDATA% survives.
 *
 * Usage:
 *   node scripts/install-cycle.mjs
 *   node scripts/install-cycle.mjs --installer <path> --dir <scratch-dir>
 *   node scripts/install-cycle.mjs --upgrade <new-installer> --feed-dir <dir>
 *
 * Flags:
 *   --installer <path>   NSIS installer (default: newest dsh-desktop-*.exe in dist-app2)
 *   --dir <path>         scratch install directory (default: %TEMP%\dsh-install-cycle)
 *   --upgrade <path>     second installer to serve as the "new version" upgrade
 *   --feed-dir <path>    where the local update feed is written (default: %TEMP%\dsh-install-feed)
 *   --skip-smoke         skip the installed-exe smoke launch (CI without a free
 *                        single-instance slot, or when the app is in use locally)
 *
 * The upgrade segment launches the installed app through Playwright's
 * Electron driver and therefore needs the single-instance lock free; the
 * install/uninstall segments do not launch the app but still refuse to
 * run while an instance is live (see DANGER above).
 */

import { createHash } from 'node:crypto'
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { isDesktopRunning } from './mock-llm.mjs'

const requireFromApp = createRequire(import.meta.url)
const appDir = fileURLToPath(new URL('..', import.meta.url))
const distApp2 = join(appDir, 'dist-app2')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const failures = []
const check = (name, ok, detail) => {
  failures.push({ name, ok, detail })
  console.log(JSON.stringify({ check: name, ok, detail }))
}

/** Newest dsh-desktop installer in dist-app2, or null when absent. */
function defaultInstaller() {
  if (!existsSync(distApp2)) return null
  const candidates = readdirSync(distApp2)
    .filter((name) => /^dsh-desktop-.*\.exe$/u.test(name))
    .map((name) => join(distApp2, name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return candidates[0] ?? null
}

function parseArgs() {
  const args = process.argv.slice(2)
  const value = (flag) => {
    const index = args.indexOf(flag)
    return index >= 0 ? args[index + 1] : undefined
  }
  return {
    installer: value('--installer') ?? defaultInstaller(),
    dir: value('--dir') ?? join(tmpdir(), 'dsh-install-cycle'),
    upgrade: value('--upgrade') ?? null,
    feedDir: value('--feed-dir') ?? join(tmpdir(), 'dsh-install-feed'),
    skipSmoke: args.includes('--skip-smoke'),
  }
}

/** Silent-install the NSIS installer into `dir`; returns the exit code. */
function silentInstall(installer, dir) {
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  // NSIS: /D= must be the last argument and unquoted (even with spaces).
  const args = ['/S', `/D=${dir}`]
  try {
    execFileSync(installer, args, { stdio: 'pipe', windowsHide: true, timeout: 300_000 })
    return 0
  } catch (error) {
    return error.status ?? 1
  }
}

/** Run `exe --smoke-test` and resolve with { exitCode, smokeOk }. */
function runSmoke(exe) {
  return new Promise((resolveSmoke) => {
    const child = spawn(exe, ['--smoke-test'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stdout += chunk.toString() })
    const timer = setTimeout(() => { child.kill() }, 120_000)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolveSmoke({ exitCode: code ?? 1, smokeOk: stdout.includes('DESKTOP_SMOKE_OK') })
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolveSmoke({ exitCode: 1, smokeOk: false, error: error.message })
    })
  })
}

/** Serve one directory over HTTP for the local update feed. */
async function serveDir(root) {
  const server = createServer((req, res) => {
    const name = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/').replace(/^\/+/, '')
    const file = join(root, name)
    if (!file.startsWith(root) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, { 'content-type': 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  await new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  const port = typeof address === 'object' && address !== null ? address.port : 0
  return { baseURL: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) }
}

/** base64 sha512 for electron-updater latest.yml. */
function sha512Base64(file) {
  return createHash('sha512').update(readFileSync(file)).digest('base64')
}

/** Write a generic-provider latest.yml pointing at `file` in `dir`. */
function writeLatestYml(dir, file, version) {
  const sha512 = sha512Base64(file)
  const size = statSync(file).size
  const name = basename(file)
  const yml = [
    `version: ${version}`,
    'files:',
    `  - url: ${name}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${name}`,
    `sha512: ${sha512}`,
    `releaseDate: ${new Date().toISOString()}`,
    '',
  ].join('\n')
  writeFileSync(join(dir, 'latest.yml'), yml)
}

/** Drive the upgrade path through the installed app's own updater IPC. */
async function upgradeSegment(installDir, newInstaller, feedDir, version) {
  rmSync(feedDir, { recursive: true, force: true })
  mkdirSync(feedDir, { recursive: true })
  const feedFile = join(feedDir, `dsh-desktop-${version}-x64.exe`)
  copyFileSync(newInstaller, feedFile)
  writeLatestYml(feedDir, feedFile, version)
  const feed = await serveDir(feedDir)

  const exe = join(installDir, 'Harness Desktop.exe')
  const { _electron } = requireFromApp('playwright')
  let app
  try {
    app = await _electron.launch({
      executablePath: exe,
      timeout: 120_000,
      env: { ...process.env, DSH_DESKTOP_UPDATE_FEED_URL: feed.baseURL },
    })
    const win = await app.firstWindow({ timeout: 120_000 })
    await win.waitForSelector('.web-ui-host', { timeout: 90_000 })
    await win.evaluate(() => {
      window.__dshUpdateStatus = null
      window.desktop.updates.onStatus((status) => { window.__dshUpdateStatus = status })
    })
    // The app checks on boot; wait for the downloaded state (120s budget).
    let status = null
    for (let i = 0; i < 60; i++) {
      status = await win.evaluate(() => window.__dshUpdateStatus)
      if (status?.kind === 'downloaded' || status?.kind === 'error') break
      await sleep(2000)
    }
    check('upgrade:downloaded', status?.kind === 'downloaded' && status.version === version,
      JSON.stringify(status))

    // Corrupted-package error case: rewrite the feed with a bad sha512.
    const badYml = readFileSync(join(feedDir, 'latest.yml'), 'utf8')
      .replace(/sha512: .+/u, 'sha512: dGVzdA==')
    writeFileSync(join(feedDir, 'latest.yml'), badYml)
    await win.evaluate(() => { window.__dshUpdateStatus = null })
    await win.evaluate(() => { void window.desktop.updates.check() })
    let badStatus = null
    for (let i = 0; i < 30; i++) {
      badStatus = await win.evaluate(() => window.__dshUpdateStatus)
      if (badStatus?.kind === 'error' || badStatus?.kind === 'downloaded') break
      await sleep(2000)
    }
    check('upgrade:corrupt-package-reports-error', badStatus?.kind === 'error',
      JSON.stringify(badStatus))
  } finally {
    await app?.close().catch(() => {})
    await feed.close()
  }
}

/** Uninstall and assert residue cleanup plus user-data retention. */
function uninstallSegment(installDir) {
  const uninstaller = join(installDir, 'Uninstall Harness Desktop.exe')
  const userData = join(process.env.APPDATA ?? '', 'Harness Desktop')
  const userDataExisted = existsSync(userData)
  const startMenu = join(process.env.APPDATA ?? '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Harness Desktop')

  if (!existsSync(uninstaller)) {
    check('uninstall:silent', false, `uninstaller missing: ${uninstaller}`)
  } else {
    let code
    try {
      execFileSync(uninstaller, ['/S'], { stdio: 'pipe', windowsHide: true, timeout: 180_000 })
      code = 0
    } catch (error) {
      code = error.status ?? 1
    }
    check('uninstall:silent', code === 0, `exit=${code}`)
  }

  check('uninstall:dir-removed', !existsSync(installDir), installDir)
  check('uninstall:start-menu-removed', !existsSync(startMenu), startMenu)
  check('uninstall:user-data-kept', !userDataExisted || existsSync(userData),
    `userData existed=${userDataExisted} kept=${existsSync(userData)}`)

  // Registry uninstall keys under HKCU must be gone.
  try {
    const reg = execFileSync('reg.exe', [
      'query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      '/f', 'Harness Desktop', '/s',
    ], { encoding: 'utf8', windowsHide: true })
    check('uninstall:registry-cleared', !reg.includes('Harness Desktop'),
      `remaining keys: ${reg.split('\n').filter((l) => l.includes('Harness Desktop')).slice(0, 3).join('; ')}`)
  } catch {
    // reg query exits 1 when nothing matches: that is the passing case.
    check('uninstall:registry-cleared', true, 'no matching uninstall keys')
  }
}

async function main() {
  const opts = parseArgs()
  if (opts.installer === null || !existsSync(opts.installer)) {
    console.error(`install-cycle: installer not found: ${opts.installer ?? '(none in dist-app2)'}`)
    process.exitCode = 1
    return
  }
  // Hard gate: the NSIS installer and uninstaller both terminate any
  // running "Harness Desktop.exe" process and rewrite Start Menu entries
  // and uninstall keys matching the product name, regardless of the target
  // directory. Running this gate while an instance is live uninstalls the
  // user's real installation, so every segment is refused up front.
  if (isDesktopRunning()) {
    console.error(
      'install-cycle: Harness Desktop is running; close it before this gate (the NSIS ' +
      'installer/uninstaller terminates running instances of the product name)',
    )
    process.exitCode = 1
    return
  }
  console.log(JSON.stringify({ stage: 'install', installer: opts.installer, dir: opts.dir }))

  const installCode = silentInstall(opts.installer, opts.dir)
  check('install:silent', installCode === 0, `exit=${installCode}`)
  const exe = join(opts.dir, 'Harness Desktop.exe')
  check('install:exe-present', existsSync(exe), exe)
  check('install:uninstaller-present', existsSync(join(opts.dir, 'Uninstall Harness Desktop.exe')),
    join(opts.dir, 'Uninstall Harness Desktop.exe'))

  if (!opts.skipSmoke) {
    if (isDesktopRunning()) {
      check('smoke:launch', false,
        'Harness Desktop is already running; the single-instance lock blocks the smoke launch (use --skip-smoke)')
    } else {
      const smoke = await runSmoke(exe)
      check('smoke:launch', smoke.smokeOk, `exit=${smoke.exitCode} smokeOk=${smoke.smokeOk}${smoke.error ? ` error=${smoke.error}` : ''}`)
    }
  } else {
    check('smoke:launch', true, 'skipped (--skip-smoke)')
  }

  if (opts.upgrade !== null) {
    if (!existsSync(opts.upgrade)) {
      check('upgrade:downloaded', false, `upgrade installer not found: ${opts.upgrade}`)
    } else if (isDesktopRunning()) {
      check('upgrade:downloaded', false,
        'Harness Desktop is already running; the single-instance lock blocks the upgrade launch')
    } else {
      await upgradeSegment(opts.dir, opts.upgrade, opts.feedDir, '0.2.0')
    }
  }

  uninstallSegment(opts.dir)

  console.log(JSON.stringify({ ok: failures.every((f) => f.ok), failures }, null, 2))
  if (failures.some((f) => !f.ok)) process.exitCode = 1
}

await main()
