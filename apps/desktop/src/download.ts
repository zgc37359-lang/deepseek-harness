/**
 * Streaming base64 download writer.
 *
 * The download IPC delivers the file as one base64 string; decoding it into
 * a single Buffer doubles the peak memory for large downloads, and a
 * synchronous `writeFileSync` blocks the main process's event loop. This
 * module decodes the string in bounded slices and pipes them through Node's
 * backpressure-aware streams instead.
 * @module @deepseek-ai/dsh-desktop/download
 */

import { createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

/** Decode at most this many base64 characters per slice (~48 KiB decoded). */
const BASE64_SLICE_CHARS = 64 * 1024

/** Decoded byte length of a canonical base64 string (padded to 4). */
function decodedLength(base64: string): number {
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(base64.length / 4) * 3 - padding)
}

/**
 * Write a base64 payload to `path` as an incremental, backpressure-aware
 * stream. On failure the partial file is removed before rethrowing.
 * @param path - absolute destination path (caller already validated it).
 * @param base64 - the canonical base64 payload.
 * @returns the decoded byte count written.
 */
export async function writeBase64Stream(path: string, base64: string): Promise<number> {
  const source = Readable.from((function* generate(): Generator<Buffer> {
    for (let offset = 0; offset < base64.length; offset += BASE64_SLICE_CHARS) {
      yield Buffer.from(base64.slice(offset, offset + BASE64_SLICE_CHARS), 'base64')
    }
  })())
  try {
    await pipeline(source, createWriteStream(path))
  } catch (error) {
    await rm(path, { force: true }).catch(() => {})
    throw error
  }
  return decodedLength(base64)
}
