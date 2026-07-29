import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as tokenModule from '../utils/token'
import {
  getToken,
  setToken,
  removeToken,
  removeAllTokens,
  listenForParentToken,
  requestParentTokenRefresh,
  getTokenActorSubject,
  haveSameTokenActor,
  isFreshAccessToken,
  isUsableRefreshedToken,
} from '../utils/token'

function testJwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode(payload)}.test-signature`
}

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

  it('keeps a guarded role-write handoff across a same-actor token refresh', () => {
    const currentToken = testJwt({ uid: 3, username: 'dirui', jti: 'before' })
    const refreshedToken = testJwt({ uid: 3, username: 'dirui', jti: 'after' })

    expect(getTokenActorSubject(currentToken)).toBe('uid:3')
    expect(haveSameTokenActor(currentToken, refreshedToken)).toBe(true)
  })

  it('uses a numeric JWT subject when uid is absent', () => {
    const currentToken = testJwt({ sub: '3', jti: 'before' })
    const refreshedToken = testJwt({ sub: '3', jti: 'after' })

    expect(getTokenActorSubject(currentToken)).toBe('uid:3')
    expect(haveSameTokenActor(currentToken, refreshedToken)).toBe(true)
  })

  it('invalidates a guarded role-write handoff when the actor changes', () => {
    const currentToken = testJwt({ uid: 3, username: 'dirui' })
    const nextToken = testJwt({ uid: 613, username: 'iamrolecanary01' })

    expect(haveSameTokenActor(currentToken, nextToken)).toBe(false)
  })

  it('fails closed for empty or unrecognized token updates', () => {
    const currentToken = testJwt({ uid: 3, username: 'dirui' })

    expect(haveSameTokenActor(currentToken, '')).toBe(false)
    expect(haveSameTokenActor(currentToken, 'not-a-jwt')).toBe(false)
    expect(haveSameTokenActor(testJwt({ sub: 'actor-name' }), currentToken)).toBe(false)
  })

  it('accepts only a currently valid access token as a refresh candidate', () => {
    const nowMs = 2_000_000_000_000
    const freshToken = testJwt({ uid: 3, exp: 2_000_000_060, jti: 'fresh' })
    const expiredToken = testJwt({ uid: 3, exp: 1_999_999_999, jti: 'expired' })
    const notYetValidToken = testJwt({
      uid: 3,
      exp: 2_000_000_060,
      nbf: 2_000_000_001,
      jti: 'future',
    })

    expect(isFreshAccessToken(freshToken, nowMs)).toBe(true)
    expect(isFreshAccessToken(expiredToken, nowMs)).toBe(false)
    expect(isFreshAccessToken(notYetValidToken, nowMs)).toBe(false)
    expect(isFreshAccessToken('not-a-jwt', nowMs)).toBe(false)
  })

  it('rejects an unchanged or expired token returned by a refresh', () => {
    const nowMs = 2_000_000_000_000
    const currentToken = testJwt({ uid: 3, exp: 2_000_000_060, jti: 'before' })
    const expiredToken = testJwt({ uid: 3, exp: 1_999_999_999, jti: 'expired' })

    expect(isUsableRefreshedToken(currentToken, currentToken, nowMs)).toBe(false)
    expect(isUsableRefreshedToken(currentToken, expiredToken, nowMs)).toBe(false)
  })

  it('accepts a new fresh token only for the same actor when the current actor is known', () => {
    const nowMs = 2_000_000_000_000
    const currentToken = testJwt({ uid: 3, exp: 2_000_000_060, jti: 'before' })
    const sameActorToken = testJwt({ uid: 3, exp: 2_000_000_120, jti: 'after' })
    const differentActorToken = testJwt({ uid: 613, exp: 2_000_000_120, jti: 'other' })

    expect(isUsableRefreshedToken(null, sameActorToken, nowMs)).toBe(true)
    expect(isUsableRefreshedToken(currentToken, sameActorToken, nowMs)).toBe(true)
    expect(isUsableRefreshedToken(currentToken, differentActorToken, nowMs)).toBe(false)
    expect(isUsableRefreshedToken('not-a-jwt', sameActorToken, nowMs)).toBe(false)
  })
})
