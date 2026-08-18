/**
 * Generate apps/desktop/build/icon.ico from the web favicon: white fish glyph
 * on the app's dark rounded-square background, at 16/32/48/256 pixels.
 *
 * Usage: node scripts/generate-icon.mjs
 */

import { createRequire } from 'node:module'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const requireFromApp = createRequire(import.meta.url)
const sharp = requireFromApp('sharp')

const appDir = fileURLToPath(new URL('..', import.meta.url))
const faviconPath = join(appDir, '..', 'web', 'public', 'favicon.svg')
const svg = readFileSync(faviconPath, 'utf8')
const pathMatch = svg.match(/<path\b[^>]*\bd="([^"]+)"/)
if (pathMatch === null) throw new Error('generate-icon: favicon.svg path element not found')

const fishPath = pathMatch[1]
const sizes = [16, 32, 48, 256]
const wrapper = (size) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
  `<rect width="${size}" height="${size}" rx="${Math.round(size * 0.1875)}" fill="#0f1115"/>` +
  `<g transform="translate(${size / 2} ${size / 2}) scale(${size / 50}) translate(-25 -25)">` +
  `<path d="${fishPath}" fill="#ffffff"/></g></svg>`

const pngs = await Promise.all(sizes.map(async (size) =>
  sharp(Buffer.from(wrapper(size))).png().toBuffer()))

/** Pack PNG-compressed ICO entries (Vista+ format). */
function buildIco(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const entries = []
  const data = []
  let offset = 6 + 16 * images.length
  images.forEach((png, index) => {
    const size = sizes[index]
    const entry = Buffer.alloc(16)
    entry.writeUInt8(size === 256 ? 0 : size, 0)
    entry.writeUInt8(size === 256 ? 0 : size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(png.length, 8)
    entry.writeUInt32LE(offset, 12)
    entries.push(entry)
    data.push(png)
    offset += png.length
  })
  return Buffer.concat([header, ...entries, ...data])
}

const outDir = join(appDir, 'build')
mkdirSync(outDir, { recursive: true })
const outFile = join(outDir, 'icon.ico')
writeFileSync(outFile, buildIco(pngs))
writeFileSync(join(outDir, 'icon-preview.png'), pngs[sizes.indexOf(256)])
console.log(`generate-icon: ${outFile} (${sizes.join('/')} px)`)
