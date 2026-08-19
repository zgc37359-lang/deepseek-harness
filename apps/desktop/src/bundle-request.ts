/**
 * dsh-bundle protocol request parsing. The handler must never throw on
 * malformed URLs: a decode failure is a 404, not a crash.
 * @module @deepseek-ai/dsh-desktop/bundle-request
 */

/**
 * Extract the client bundle id from a dsh-bundle request URL.
 * @param url - the request URL served by the protocol handler.
 * @returns the plugin id, or null when the URL is not a dsh-bundle bundle
 *   request or its percent-encoding is malformed.
 */
export function matchBundleRequest(url: URL): string | null {
  if (url.protocol !== 'dsh-bundle:') return null
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    // Malformed percent-encoding must answer 404, never reject the handler.
    return null
  }
  const match = pathname.match(/^\/plugins\/(.+)\/client\.js$/)
  return match?.[1] ?? null
}
