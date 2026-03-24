const TOKEN_KEY = 'user-mgmt-token'

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

export function removeAllTokens() {
  removeToken()
}

/**
 * 监听主框架的 postMessage，接收 INIT 消息中的 token
 *
 * 握手顺序：调用时立即发送 PLUGIN_READY → 主系统收到后发送 INIT → 存储 token
 */
export function listenForParentToken(callback: (token: string) => void) {
  // 立即发送 PLUGIN_READY，通知主系统插件已就绪
  window.parent.postMessage({
    type: 'PLUGIN_READY',
    id: `ready-${Date.now()}`
  }, '*')

  window.addEventListener('message', (event) => {
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
  })
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
    window.parent.postMessage({ type: 'TOKEN_REFRESH_REQUEST' }, '*')
  })
}
