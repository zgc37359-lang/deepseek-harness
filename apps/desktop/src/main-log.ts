/**
 * Size-bounded main-process log: one append function that rotates the log
 * file once it exceeds a byte budget, keeping a bounded number of rotated
 * generations. Purely filesystem-backed so it is testable without Electron.
 * @module @deepseek-ai/dsh-desktop/main-log
 */

import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'

/** Default rotation budget: 10 MiB per generation. */
export const DEFAULT_LOG_MAX_BYTES = 10 * 1024 * 1024

/** Default number of rotated generations kept (main.log.1 .. main.log.keep). */
export const DEFAULT_LOG_KEEP = 3

/** Log-rotation policy for {@link appendLogLine}. */
export interface LogRotationOptions {
  /** Rotate once the current file exceeds this many bytes. */
  maxBytes: number
  /** Number of rotated generations to retain. */
  keep: number
}

function resolveOptions(options?: Partial<LogRotationOptions>): LogRotationOptions {
  return {
    maxBytes: options?.maxBytes ?? DEFAULT_LOG_MAX_BYTES,
    keep: options?.keep ?? DEFAULT_LOG_KEEP,
  }
}

/**
 * Rotate the log file: shift generations down (main.log.1 -> main.log.2, …)
 * and move the current file to main.log.1, leaving main.log empty.
 * @param logFile - the active log file path.
 * @param keep - generations to retain; older ones are deleted.
 */
export function rotateLogs(logFile: string, keep: number): void {
  if (!existsSync(logFile)) return
  for (let i = keep - 1; i >= 1; i--) {
    const older = logFile + '.' + String(i)
    const newer = logFile + '.' + String(i + 1)
    if (!existsSync(older)) continue
    rmSync(newer, { force: true })
    renameSync(older, newer)
  }
  rmSync(logFile + '.1', { force: true })
  renameSync(logFile, logFile + '.1')
}

/**
 * Append one timestamped log line, rotating first when the current file would
 * exceed the byte budget.
 * @param logFile - the active log file path (parent dir is created).
 * @param level - the log level label.
 * @param message - the line content.
 * @param options - rotation policy overrides.
 */
export function appendLogLine(
  logFile: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  options?: Partial<LogRotationOptions>,
): void {
  const { maxBytes, keep } = resolveOptions(options)
  const line = `[${new Date().toISOString()}] ${level} ${message}\n`
  mkdirSync(dirname(logFile), { recursive: true })
  const size = existsSync(logFile) ? statSync(logFile).size : 0
  if (size + line.length > maxBytes) rotateLogs(logFile, keep)
  appendFileSync(logFile, line)
}
