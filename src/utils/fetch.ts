declare global {
  interface RequestInit {
    timeout?: number | false
  }
}

export const fetchWithoutTimeout: typeof fetch = (input, init) => fetch(input, { ...init, timeout: false })
fetchWithoutTimeout.preconnect = fetch.preconnect
