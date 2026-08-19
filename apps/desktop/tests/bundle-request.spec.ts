import { describe, expect, it } from 'vitest'
import { matchBundleRequest } from '../src/bundle-request.ts'

describe('matchBundleRequest', () => {
  it('extracts the plugin id from a bundle URL', () => {
    expect(matchBundleRequest(new URL('dsh-bundle://bundle/plugins/ui-conversation/client.js'))).toBe('ui-conversation')
  })

  it('decodes percent-encoded ids', () => {
    expect(matchBundleRequest(new URL('dsh-bundle://bundle/plugins/a%20b/client.js'))).toBe('a b')
  })

  it('rejects non-bundle paths and wrong suffixes', () => {
    expect(matchBundleRequest(new URL('dsh-bundle://bundle/other/client.js'))).toBe(null)
    expect(matchBundleRequest(new URL('dsh-bundle://bundle/plugins/x/other.js'))).toBe(null)
    expect(matchBundleRequest(new URL('https://example.com/plugins/x/client.js'))).toBe(null)
  })

  it('returns null for malformed percent-encoding instead of throwing', () => {
    expect(matchBundleRequest(new URL('dsh-bundle://bundle/plugins/%zz/client.js'))).toBe(null)
    expect(matchBundleRequest(new URL('dsh-bundle://bundle/plugins/%E0%A4%A/client.js'))).toBe(null)
  })
})
