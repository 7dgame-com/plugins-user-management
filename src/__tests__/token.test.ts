import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as tokenModule from '../utils/token'
import { getToken, setToken, removeToken, removeAllTokens, listenForParentToken, requestParentTokenRefresh } from '../utils/token'

describe('Bug Condition Exploration', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('Bug 1: PLUGIN_READY should be sent exactly 1 time', () => {
    const postMessageSpy = vi.spyOn(window.parent, 'postMessage')
    listenForParentToken(vi.fn())
    // simulate usePluginMessageBridge.onMounted also sending PLUGIN_READY
    window.parent.postMessage({ type: 'PLUGIN_READY', id: 'bridge' }, '*')
    const count = postMessageSpy.mock.calls.filter(
      c => c[0]?.type === 'PLUGIN_READY'
    ).length
    expect(count).toBe(1) // FAILS on unfixed code (actual: 2)
  })

  it('Bug 3: listenForParentToken should return a cleanup function', () => {
    const result = listenForParentToken(vi.fn())
    expect(typeof result).toBe('function') // FAILS on unfixed code (actual: undefined)
  })
})

describe('Preservation', () => {
  beforeEach(() => { localStorage.clear() })
  afterEach(() => { vi.restoreAllMocks() })

  it('getToken/setToken/removeToken/removeAllTokens round-trip', () => {
    expect(getToken()).toBeNull()
    setToken('tok')
    expect(getToken()).toBe('tok')
    removeToken()
    expect(getToken()).toBeNull()
    setToken('tok2')
    removeAllTokens()
    expect(getToken()).toBeNull()
  })

  it('requestParentTokenRefresh resolves with accessToken when parent responds', async () => {
    const original = window.addEventListener.bind(window)
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, ...rest) => {
      if (type === 'message') {
        setTimeout(() => {
          (listener as EventListener)(new MessageEvent('message', {
            data: { type: 'TOKEN_UPDATE', payload: { token: 'new-token' } },
            source: window.parent,
          }))
        }, 0)
      }
      return original(type, listener as EventListener, ...rest)
    })
    const result = await requestParentTokenRefresh()
    expect(result).toEqual({ accessToken: 'new-token' })
  })
})
