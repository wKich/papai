const TRACKING_PARAM_PATTERNS = [/^utm_/i, /^fbclid$/i, /^gclid$/i] as const

export function isTrackingParam(key: string): boolean {
  return TRACKING_PARAM_PATTERNS.some((pattern) => pattern.test(key))
}

export function normalizeWebUrl(rawUrl: string): string {
  const url = new URL(rawUrl)
  url.hostname = url.hostname.toLowerCase()
  url.hash = ''

  const params = [...url.searchParams.entries()]
    .filter(([key]) => !isTrackingParam(key))
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue)
      }

      return leftKey.localeCompare(rightKey)
    })

  url.search = new URLSearchParams(params).toString()
  return url.toString()
}
