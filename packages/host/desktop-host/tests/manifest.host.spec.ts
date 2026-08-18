import { describe, expect, it } from 'vitest'
import type { WebBootGraph } from '@deepseek-ai/dsh-client-modules'
import { rewriteManifestUrls } from '../src/manifest.ts'

const graph: WebBootGraph = {
  rev: 'r1',
  entries: [
    {
      id: '@deepseek-ai/dsh-client-modules',
      url: '/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=r1',
      rev: 'r1',
      inject: [],
      immediately: true,
    },
  ],
}

describe('rewriteManifestUrls', () => {
  it('prefixes every bundle URL with the desktop protocol base', () => {
    const rewritten = rewriteManifestUrls(graph, 'dsh-bundle://bundle')
    expect(rewritten.rev).toBe('r1')
    expect(rewritten.entries[0]?.url).toBe('dsh-bundle://bundle/plugins/@deepseek-ai/dsh-client-modules/client.js?rev=r1')
    expect(rewritten.entries[0]?.id).toBe('@deepseek-ai/dsh-client-modules')
    expect(rewritten.entries[0]?.immediately).toBe(true)
  })
})
