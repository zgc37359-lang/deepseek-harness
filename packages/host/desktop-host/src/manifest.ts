/**
 * Boot-manifest URL rewrite for the desktop carrier: the client module system
 * fetches plugin bundles through the Electron `dsh-bundle` protocol instead of
 * the web composition's `/plugins/...` route.
 * @module @deepseek-ai/dsh-desktop-host/manifest
 */

import type { WebBootEntry, WebBootGraph } from '@deepseek-ai/dsh-client-modules'

/** Prefix every bundle URL with the desktop protocol base. */
export function rewriteManifestUrls(graph: WebBootGraph, prefix: string): WebBootGraph {
  return {
    rev: graph.rev,
    entries: graph.entries.map(row => rewriteEntry(row, prefix)),
  }
}

function rewriteEntry(row: WebBootEntry, prefix: string): WebBootEntry {
  return { ...row, url: `${prefix}${row.url}` }
}
