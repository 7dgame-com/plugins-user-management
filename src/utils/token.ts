const TOKEN_KEY = 'user-mgmt-token'
const REFRESH_TOKEN_KEY = 'user-mgmt-refresh-token'

/** 是否在 iframe 中运行 */
export function isInIframe(): boolean {
  try {
    return window.self !== window.top
  } catch {
    return true
  }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY)
}

export function setRefreshToken(token: string) {
  localStorage.setItem(REFRESH_TOKEN_KEY, token)
}

export function removeRefreshToken() {
  localStorage.removeItem(REFRESH_TOKEN_KEY)
}

export function removeAllTokens() {
  removeToken()
  removeRefreshToken()
}

function decodeTokenPayload(token: string | null | undefined): Record<string, unknown> | null {
  if (!token) return null

  const encodedPayload = token.split('.')[1]
  if (!encodedPayload) return null

  try {
    const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const bytes = Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as unknown
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? payload as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function getTokenActorSubject(token: string | null | undefined): string | null {
  const payload = decodeTokenPayload(token)
  if (!payload) return null

  const subject = payload.uid ?? payload.sub
  const numericSubject = typeof subject === 'number'
    ? subject
    : typeof subject === 'string' && /^\d+$/.test(subject.trim())
      ? Number(subject)
      : Number.NaN

  return Number.isSafeInteger(numericSubject) && numericSubject > 0
    ? `uid:${numericSubject}`
    : null
}

export function isFreshAccessToken(
  token: string | null | undefined,
  nowMs = Date.now()
): boolean {
  const payload = decodeTokenPayload(token)
  if (!payload) return false

  const expiresAt = Number(payload.exp)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= 0 || expiresAt * 1000 <= nowMs) {
    return false
  }

  if (payload.nbf !== undefined) {
    const notBefore = Number(payload.nbf)
    if (!Number.isSafeInteger(notBefore) || notBefore * 1000 > nowMs) {
      return false
    }
  }

  return true
}

/**
 * A refresh response is usable only when it supplies a new, currently valid
 * access token for the same actor. JWT signature verification remains the
 * backend's responsibility; this client-side check prevents obvious stale or
 * expired host responses from being mistaken for a successful refresh.
 */
export function isUsableRefreshedToken(
  currentToken: string | null | undefined,
  nextToken: string | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!nextToken || nextToken === currentToken || !isFreshAccessToken(nextToken, nowMs)) {
    return false
  }

  if (!currentToken) return true

  const currentSubject = getTokenActorSubject(currentToken)
  if (!currentSubject) return false

  return getTokenActorSubject(nextToken) === currentSubject
}

export function haveSameTokenActor(
  currentToken: string | null | undefined,
  nextToken: string | null | undefined
): boolean {
  if (!currentToken || !nextToken) return false
  if (currentToken === nextToken) return true

  const currentSubject = getTokenActorSubject(currentToken)
  const nextSubject = getTokenActorSubject(nextToken)
  return currentSubject !== null && currentSubject === nextSubject
}

/**
 * 监听主框架的 postMessage，接收 INIT / TOKEN_UPDATE / DESTROY 消息
 *
 * 返回 cleanup 函数，调用方应在组件卸载时（onBeforeUnmount）执行以移除监听器。
 * 注意：PLUGIN_READY 握手由 usePluginMessageBridge 统一负责，此函数不再发送。
 */
export function listenForParentToken(callback: (token: string) => void): () => void {
  function handleMessage(event: MessageEvent) {
    if (event.source !== window.parent) return

    const { type, payload } = event.data || {}

    if (type === 'INIT' && payload?.token) {
      setToken(payload.token)
      callback(payload.token)
    }

    if (type === 'TOKEN_UPDATE' && payload?.token) {
      setToken(payload.token)
      callback(payload.token)
    }

    if (type === 'DESTROY') {
      removeAllTokens()
    }
  }

  window.addEventListener('message', handleMessage)
  return () => window.removeEventListener('message', handleMessage)
}

/**
 * 通过 postMessage 请求主框架刷新 token
 */
export function requestParentTokenRefresh(): Promise<{
  accessToken: string
} | null> {
  const timeout = Number(
    import.meta.env.VITE_IFRAME_REFRESH_TIMEOUT
  ) || 3000

  return new Promise((resolve) => {
    let settled = false

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return

      const { type, payload } = event.data || {}
      if (type === 'TOKEN_UPDATE' && payload?.token) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        window.removeEventListener('message', onMessage)
        resolve({ accessToken: payload.token })
      }
    }

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      resolve(null)
    }, timeout)

    window.addEventListener('message', onMessage)
    window.parent.postMessage(
      { type: 'TOKEN_REFRESH_REQUEST', id: `token-refresh-request-${Date.now()}` },
      '*'
    )
  })
}
