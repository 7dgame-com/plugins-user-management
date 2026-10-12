import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import axios from 'axios'

describe('Identity compatibility mode', () => {
  beforeEach(() => {
    vi.resetModules()
    localStorage.clear()
    ;(window as unknown as { __ENV__: unknown }).__ENV__ = {
      AUTH_PROVIDER: 'identity'
    }
  })
  afterEach(() => {
    vi.restoreAllMocks()
    delete (window as unknown as { __ENV__?: unknown }).__ENV__
  })

  it('routes invitation operations to Identity and never falls back to the old writer', async () => {
    const {
      default: api,
      identityPluginUserApi,
      createPluginUser
    } = await import('../api')
    expect(api.defaults.baseURL).toBe('/api-auth/v1/plugin-user')
    const legacy = vi.spyOn(api, 'post')
    const error = {
      response: { status: 404, data: { code: 'PLUGIN_USER_WRITE_DISABLED' } }
    }
    vi.spyOn(identityPluginUserApi, 'post').mockRejectedValue(error)
    await expect(createPluginUser({ username: 'test' })).rejects.toBe(error)
    expect(legacy).not.toHaveBeenCalled()
  })

  it('clears cached credentials on an empty host token update', async () => {
    const tokens = await import('../utils/token')
    tokens.setToken('old')
    tokens.setRefreshToken('old-refresh')
    const callback = vi.fn()
    const stop = tokens.listenForParentToken(callback)
    window.dispatchEvent(
      new MessageEvent('message', {
        source: window.parent,
        data: { type: 'TOKEN_UPDATE', payload: { token: '' } }
      })
    )
    expect(tokens.getToken()).toBeNull()
    expect(tokens.getRefreshToken()).toBeNull()
    expect(callback).toHaveBeenCalledWith('')
    stop()
  })

  it('places the Identity proxy before the broad main API proxy in development', () => {
    const source = readFileSync('vite.config.ts', 'utf8')
    expect(source.indexOf("'/api-auth'")).toBeLessThan(source.indexOf("'/api'"))
    expect(source).toContain('http://localhost:8086')
  })

  it('ignores a late refresh header from a request made before logout', async () => {
    const tokens = await import('../utils/token')
    tokens.setToken('access')
    tokens.setRefreshToken('refresh')
    const { default: api } = await import('../api')
    api.defaults.adapter = async (config) => {
      tokens.removeAllTokens()
      return {
        config,
        status: 200,
        statusText: 'OK',
        data: {},
        headers: { 'x-refresh-token': 'late' }
      }
    }
    await api.get('/test')
    expect(tokens.getRefreshToken()).toBeNull()
  })

  it('retries a transient refresh once with the same idempotency key', async () => {
    const encode = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url')
    const access = (jti: string) =>
      `${encode({ alg: 'ES256' })}.${encode({ uid: 24, jti, exp: Math.floor(Date.now() / 1000) + 3600 })}.signature`
    const tokens = await import('../utils/token')
    tokens.setToken(access('old'))
    tokens.setRefreshToken('refresh')
    const { default: api } = await import('../api')
    let calls = 0
    api.defaults.adapter = async (config) => {
      if (calls++ === 0)
        throw Object.assign(new Error('401'), {
          config,
          response: { status: 401 },
          isAxiosError: true
        })
      return { config, status: 200, statusText: 'OK', data: {}, headers: {} }
    }
    const rotate = vi
      .spyOn(axios, 'post')
      .mockRejectedValueOnce(
        Object.assign(new Error('drain'), {
          response: { status: 503 },
          isAxiosError: true
        })
      )
      .mockResolvedValueOnce({
        data: {
          token: { accessToken: access('new'), refreshToken: 'next-refresh' }
        }
      })
    await api.get('/test')
    expect(rotate).toHaveBeenCalledTimes(2)
    expect(rotate.mock.calls[0][2]).toEqual(rotate.mock.calls[1][2])
    expect(tokens.getRefreshToken()).toBe('next-refresh')
  })
})
