import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getToken, setToken, removeToken, removeAllTokens, isInIframe } from '../utils/token'

describe('token utils', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('getToken returns null when no token set', () => {
    expect(getToken()).toBeNull()
  })

  it('setToken / getToken round-trip', () => {
    setToken('abc123')
    expect(getToken()).toBe('abc123')
  })

  it('removeToken clears the token', () => {
    setToken('abc123')
    removeToken()
    expect(getToken()).toBeNull()
  })

  it('removeAllTokens clears the token', () => {
    setToken('abc123')
    removeAllTokens()
    expect(getToken()).toBeNull()
  })

  it('isInIframe returns false in test environment', () => {
    // jsdom: window.self === window.top
    expect(isInIframe()).toBe(false)
  })
})
