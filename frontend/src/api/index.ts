import axios from 'axios'
import type { AxiosError, InternalAxiosRequestConfig } from 'axios'
import {
  getToken,
  setToken,
  getRefreshToken,
  setRefreshToken,
  removeAllTokens,
  isInIframe,
  requestParentTokenRefresh
} from '../utils/token'

const api = axios.create({
  baseURL: '/api',
  timeout: 10000
})

// --- Token refresh state ---
let isRefreshing = false
let failedQueue: Array<{
  resolve: (token: string) => void
  reject: (error: Error) => void
}> = []

function processQueue(error: Error | null, token: string | null) {
  failedQueue.forEach(({ resolve, reject }) => {
    if (error || !token) {
      reject(error ?? new Error('Token refresh failed'))
    } else {
      resolve(token)
    }
  })
  failedQueue = []
}

/**
 * 使用本地 refresh token 调用后端刷新端点。
 * 使用原生 axios（非 api 实例）避免拦截器递归。
 */
async function refreshWithLocalToken(): Promise<{
  accessToken: string
  refreshToken: string
} | null> {
  const refreshToken = getRefreshToken()
  if (!refreshToken) return null

  const res = await axios.post('/api/auth/refresh', { refreshToken })
  return res.data
}

// --- Request interceptor ---
api.interceptors.request.use((config) => {
  const token = getToken()
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// --- Response interceptor ---
api.interceptors.response.use(
  (res) => {
    const refreshToken = res.headers['x-refresh-token']
    if (refreshToken) {
      setRefreshToken(refreshToken)
    }
    return res
  },
  async (err: AxiosError) => {
    const originalRequest = err.config as InternalAxiosRequestConfig & {
      _retry?: boolean
    }

    // Only handle 401 and avoid retrying the same request twice
    if (err.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(err)
    }

    // If already refreshing, queue this request
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject })
      }).then((newToken) => {
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        originalRequest._retry = true
        return api(originalRequest)
      })
    }

    originalRequest._retry = true
    isRefreshing = true

    try {
      let result: { accessToken: string; refreshToken?: string } | null = null

      // iframe 模式：优先通过 postMessage 请求主框架刷新
      if (isInIframe()) {
        result = await requestParentTokenRefresh()
      }

      // 若 iframe 刷新超时（返回 null）或非 iframe 模式，使用本地 refresh token
      if (!result) {
        result = await refreshWithLocalToken()
      }

      if (!result || !result.accessToken) {
        throw new Error('Token refresh failed')
      }

      // 刷新成功：更新本地 token
      setToken(result.accessToken)
      if (result.refreshToken) {
        setRefreshToken(result.refreshToken)
      }

      // 重试队列中的请求
      processQueue(null, result.accessToken)

      // 重试原始请求
      originalRequest.headers.Authorization = `Bearer ${result.accessToken}`
      return api(originalRequest)
    } catch (refreshError) {
      // 刷新失败：清除所有 token
      removeAllTokens()

      // 通知主框架 token 已失效
      if (isInIframe()) {
        window.parent.postMessage({ type: 'TOKEN_EXPIRED' }, '*')
      }

      // reject 所有队列中的请求
      processQueue(
        refreshError instanceof Error
          ? refreshError
          : new Error('Token refresh failed'),
        null
      )

      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  }
)

export default api
