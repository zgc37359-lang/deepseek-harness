/**
 * Packaged-app DPI matrix gate for Windows CI: launches the exe under
 * forced device scale factors of 100% / 150% / 200% and asserts the custom
 * title bar and Web UI host render with the expected CSS layout at every
 * scale. Catches high-DPI regressions in the frameless chrome that a
 * single 100% run cannot see.
 *
 * Usage: node scripts/e2e-dpi.mjs   (packaged app must not be running)
 *
 * Environment:
 *   DSH_DESKTOP_DPI_SCALES   comma-separated scale factors (default "1,1.5,2")
 */

import { _electron } from 'playwright'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { isDesktopRunning } from './mock-llm.mjs'

if (isDesktopRunning()) {
  console.error('DESKTOP_DPI_FAIL: Harness Desktop is already running; close it before this gate')
  process.exit(1)
}

const appDir = fileURLToPath(new URL('..', import.meta.url))
const exe = resolve(appDir, 'dist-app2', 'win-unpacked', 'Harness Desktop.exe')
const scales = (process.env.DSH_DESKTOP_DPI_SCALES ?? '1,1.5,2')
  .split(',').map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const failures = []

/** Run one scale pass: boot, assert layout, capture a screenshot. */
async function runScale(scale) {
  const app = await _electron.launch({
    executablePath: exe,
    timeout: 120000,
    args: [`--force-device-scale-factor=${scale}`],
  })
  try {
    const win = await app.firstWindow({ timeout: 120000 })
    const consoleErrors = []
    win.on('console', (m) => {
      if (['error', 'warning'].includes(m.type())) consoleErrors.push(`${m.type()}: ${m.text().slice(0, 200)}`)
    })
    win.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 200)}`))

    await win.waitForSelector('.titlebar', { timeout: 30000 })
    await win.waitForSelector('.web-ui-host', { timeout: 90000 })
    await sleep(1500)

    const layout = await win.evaluate(() => {
      const bar = document.querySelector('.titlebar')
      const host = document.querySelector('.web-ui-host')
      const barStyle = bar ? getComputedStyle(bar) : null
      const hostRect = host ? host.getBoundingClientRect() : null
      const barRect = bar ? bar.getBoundingClientRect() : null
      return {
        barHeightCss: barStyle ? barStyle.height : null,
        barHeightPx: barRect ? Math.round(barRect.height) : null,
        barWidthPx: barRect ? Math.round(barRect.width) : null,
        hostHeightPx: hostRect ? Math.round(hostRect.height) : null,
        hostWidthPx: hostRect ? Math.round(hostRect.width) : null,
        devicePixelRatio: window.devicePixelRatio,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
      }
    })

    const checks = {
      'titlebar rendered': layout.barHeightPx !== null && layout.barHeightPx > 0,
      'web-ui-host fills below titlebar': layout.hostHeightPx !== null && layout.hostHeightPx > 0,
      'titlebar CSS height is 40px': layout.barHeightCss === '40px',
      'window at least 800 CSS px wide': layout.innerWidth >= 800,
      'devicePixelRatio matches forced scale': Math.abs(layout.devicePixelRatio - scale) < 0.01,
      'no console errors': consoleErrors.length === 0,
    }
    const ok = Object.values(checks).every(Boolean)
    results.push({ scale, layout, checks, ok })
    if (!ok) {
      for (const [name, passed] of Object.entries(checks)) {
        if (!passed) failures.push(`scale ${scale}: ${name}`)
      }
    }
  } finally {
    await app.close().catch(() => {})
  }
}

for (const scale of scales) {
  await runScale(scale)
}

console.log(JSON.stringify({ results, ok: failures.length === 0, failures }, null, 2))
if (failures.length > 0) process.exitCode = 1
