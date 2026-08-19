import { describe, expect, it } from 'vitest'
import {
  isBase64Payload,
  isClipboardText,
  isDownloadFilename,
  isDownloadRevealPath,
  isRuntimeStream,
  isRuntimeUnaryArgs,
  isWindowMenuAction,
  sanitizeDownloadFilename,
  WINDOW_MENU_ACTIONS,
} from '../src/ipc-validation.ts'

/** Malformed and boundary inputs every IPC channel must reject or tame. */
const MALFORMED: unknown[] = [
  undefined,
  null,
  '',
  ' ',
  0,
  1,
  NaN,
  false,
  true,
  [],
  {},
  ['string'],
  { length: 5 },
  Buffer.from('x'),
  Symbol('x'),
  () => {},
]

describe('isWindowMenuAction', () => {
  it('accepts exactly the whitelisted actions', () => {
    for (const action of WINDOW_MENU_ACTIONS) {
      expect(isWindowMenuAction(action)).toBe(true)
    }
  })

  it('rejects malformed and non-whitelisted inputs', () => {
    for (const input of MALFORMED) expect(isWindowMenuAction(input)).toBe(false)
    for (const input of ['RESTORE', 'Restore', 'fullscreen', 'close\n', 'restore ', 'maximize;rm']) {
      expect(isWindowMenuAction(input)).toBe(false)
    }
  })

  it('narrows the type to WindowMenuAction', () => {
    const raw: unknown = 'minimize'
    if (isWindowMenuAction(raw)) {
      expect(['restore', 'move', 'size', 'minimize', 'maximize', 'close']).toContain(raw)
    } else {
      expect.unreachable('whitelisted action must narrow')
    }
  })
})

describe('isRuntimeUnaryArgs', () => {
  it('accepts two non-empty JSON strings', () => {
    expect(isRuntimeUnaryArgs('session.list', '{"type":"client-request"}')).toBe(true)
    expect(isRuntimeUnaryArgs('', '{}')).toBe(true)
  })

  it('rejects malformed inputs', () => {
    expect(isRuntimeUnaryArgs(undefined, '{}')).toBe(false)
    expect(isRuntimeUnaryArgs('method', undefined)).toBe(false)
    expect(isRuntimeUnaryArgs(null, null)).toBe(false)
    expect(isRuntimeUnaryArgs(42, '{}')).toBe(false)
    expect(isRuntimeUnaryArgs({}, '{}')).toBe(false)
    expect(isRuntimeUnaryArgs('method', Buffer.from('{}'))).toBe(false)
  })
})

describe('isRuntimeStream', () => {
  it('accepts only the two downlink names', () => {
    expect(isRuntimeStream('mux')).toBe(true)
    expect(isRuntimeStream('host')).toBe(true)
    for (const input of MALFORMED) expect(isRuntimeStream(input)).toBe(false)
    expect(isRuntimeStream('MUX')).toBe(false)
    expect(isRuntimeStream('mux ')).toBe(false)
    expect(isRuntimeStream('events.mux')).toBe(false)
  })
})

describe('isClipboardText', () => {
  it('accepts any string including empty', () => {
    expect(isClipboardText('')).toBe(true)
    expect(isClipboardText('copy me')).toBe(true)
  })

  it('rejects non-strings', () => {
    for (const input of MALFORMED) {
      if (typeof input !== 'string') expect(isClipboardText(input)).toBe(false)
    }
  })
})

describe('isDownloadFilename / isBase64Payload', () => {
  it('accepts non-empty filename plus base64 string', () => {
    expect(isDownloadFilename('report.md')).toBe(true)
    expect(isBase64Payload('aGVsbG8=')).toBe(true)
    expect(isBase64Payload('')).toBe(true)
  })

  it('rejects empty filename and non-string inputs', () => {
    expect(isDownloadFilename('')).toBe(false)
    expect(isDownloadFilename('   ')).toBe(true) // whitespace is a legal filename
    for (const input of MALFORMED) {
      if (typeof input !== 'string') expect(isDownloadFilename(input)).toBe(false)
    }
    expect(isBase64Payload(undefined)).toBe(false)
    expect(isBase64Payload(null)).toBe(false)
    expect(isBase64Payload(123)).toBe(false)
    expect(isBase64Payload(Buffer.from('x'))).toBe(false)
  })
})

describe('sanitizeDownloadFilename', () => {
  it('replaces every Windows-forbidden character with underscore', () => {
    expect(sanitizeDownloadFilename('a<b>c:d"e/f\\g|h?i*j')).toBe('a_b_c_d_e_f_g_h_i_j')
  })

  it('keeps legal characters, spaces, and unicode', () => {
    expect(sanitizeDownloadFilename('报告 2026.md')).toBe('报告 2026.md')
    expect(sanitizeDownloadFilename('normal-name_v2.txt')).toBe('normal-name_v2.txt')
  })

  it('tames path traversal and control characters', () => {
    expect(sanitizeDownloadFilename('../etc/passwd')).toBe('.._etc_passwd')
    expect(sanitizeDownloadFilename('..\\..\\evil')).toBe('.._.._evil')
    expect(sanitizeDownloadFilename('C:\\Windows\\system32')).toBe('C__Windows_system32')
    expect(sanitizeDownloadFilename('a\nb')).toBe('a\nb') // newline is not in the forbidden set
  })

  it('handles empty and edge inputs without throwing', () => {
    expect(sanitizeDownloadFilename('')).toBe('')
    expect(sanitizeDownloadFilename(':::::')).toBe('_____')
  })

  it('prefixes Windows reserved device names (base name, case-insensitive)', () => {
    for (const reserved of ['CON', 'con', 'Con', 'PRN', 'prn', 'AUX', 'aux', 'NUL', 'nul']) {
      expect(sanitizeDownloadFilename(reserved)).toBe('_' + reserved)
    }
    expect(sanitizeDownloadFilename('COM1')).toBe('_COM1')
    expect(sanitizeDownloadFilename('com9')).toBe('_com9')
    expect(sanitizeDownloadFilename('LPT1')).toBe('_LPT1')
    expect(sanitizeDownloadFilename('lpt9.x')).toBe('_lpt9.x')
    expect(sanitizeDownloadFilename('CON.txt')).toBe('_CON.txt')
    expect(sanitizeDownloadFilename('aux.pdf')).toBe('_aux.pdf')
  })

  it('keeps non-reserved lookalike names untouched', () => {
    expect(sanitizeDownloadFilename('COM10')).toBe('COM10')
    expect(sanitizeDownloadFilename('CON2')).toBe('CON2')
    expect(sanitizeDownloadFilename('console.txt')).toBe('console.txt')
    expect(sanitizeDownloadFilename('report.md')).toBe('report.md')
  })

  it('normalizes trailing dots and spaces', () => {
    expect(sanitizeDownloadFilename('name.')).toBe('name_')
    expect(sanitizeDownloadFilename('name ')).toBe('name_')
    expect(sanitizeDownloadFilename('a..')).toBe('a_')
    expect(sanitizeDownloadFilename('CON.')).toBe('_CON_')
    expect(sanitizeDownloadFilename('aux. ')).toBe('_aux_')
  })
})

describe('isDownloadRevealPath', () => {
  const downloads = 'C:\\Users\\demo\\Downloads'

  it('accepts paths inside the downloads directory', () => {
    expect(isDownloadRevealPath(`${downloads}\\report.pdf`, downloads)).toBe(true)
    expect(isDownloadRevealPath(`${downloads}\\sub\\dir\\file.txt`, downloads)).toBe(true)
  })

  it('matches case-insensitively', () => {
    expect(isDownloadRevealPath('c:\\users\\demo\\downloads\\file.pdf', downloads)).toBe(true)
    expect(isDownloadRevealPath(`${downloads.toUpperCase()}\\file.pdf`, downloads)).toBe(true)
  })

  it('rejects paths outside the downloads directory', () => {
    expect(isDownloadRevealPath('C:\\Windows\\system32\\x.dll', downloads)).toBe(false)
    expect(isDownloadRevealPath('C:\\Users\\demo\\Desktop\\file.pdf', downloads)).toBe(false)
    expect(isDownloadRevealPath(`${downloads}2\\file.pdf`, downloads)).toBe(false)
    expect(isDownloadRevealPath(`x${downloads}\\file.pdf`, downloads)).toBe(false)
    for (const input of MALFORMED) expect(isDownloadRevealPath(input, downloads)).toBe(false)
  })
})
