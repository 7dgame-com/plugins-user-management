import axios from 'axios'
import type { AxiosError, InternalAxiosRequestConfig } from 'axios'
import {
  getToken,
  setToken,
  removeAllTokens,
  isInIframe,
  requestParentTokenRefresh,
  getRefreshToken,
  setRefreshToken
} from '../utils/token'

/**
 * 用户管理接口（指向主后端 /api/v1/plugin-user）
 */
const userApi = axios.create({
  baseURL: '/api/v1/plugin-user',
  timeout: 10000
})

/**
 * 通用插件接口（指向主后端 /api/v1/plugin，如 verify-token、allowed-actions）
 */
const pluginApi = axios.create({
  baseURL: '/api/v1/plugin',
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
 * 两段式 token 刷新：
 * 1. iframe 模式下先请求主框架刷新
 * 2. 主框架超时后回退到本地 refresh token
 * 两段均失败才返回 null，由上层触发 TOKEN_EXPIRED
 */
async function tryRefreshToken(): Promise<string | null> {
  if (isInIframe()) {
    const result = await requestParentTokenRefresh()
    if (result?.accessToken) {
      setToken(result.accessToken)
      return result.accessToken
    }
    // 主框架超时，回退到本地刷新
  }

  const refreshToken = getRefreshToken()
  if (!refreshToken) return null

  try {
    const res = await axios.post('/api/auth/refresh', { refreshToken })
    const { accessToken, refreshToken: newRefreshToken } = res.data
    setToken(accessToken)
    if (newRefreshToken) setRefreshToken(newRefreshToken)
    return accessToken
  } catch {
    return null
  }
}

/**
 * 为 axios 实例添加请求/响应拦截器
 */
function setupInterceptors(instance: ReturnType<typeof axios.create>) {
  // Request: 注入 Authorization header
  instance.interceptors.request.use((config) => {
    const token = getToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  // Response: 提取 x-refresh-token 响应头 + 处理 401 刷新
  instance.interceptors.response.use(
    (res) => {
      const refreshToken = res.headers['x-refresh-token']
      if (refreshToken) setRefreshToken(refreshToken)
      return res
    },
    async (err: AxiosError) => {
      const originalRequest = err.config as InternalAxiosRequestConfig & {
        _retry?: boolean
      }

      if (err.response?.status !== 401 || originalRequest._retry) {
        return Promise.reject(err)
      }

      if (isRefreshing) {
        return new Promise<string>((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then((newToken) => {
          originalRequest.headers.Authorization = `Bearer ${newToken}`
          originalRequest._retry = true
          return instance(originalRequest)
        })
      }

      originalRequest._retry = true
      isRefreshing = true

      try {
        const newToken = await tryRefreshToken()

        if (!newToken) {
          throw new Error('Token refresh failed')
        }

        processQueue(null, newToken)
        originalRequest.headers.Authorization = `Bearer ${newToken}`
        return instance(originalRequest)
      } catch (refreshError) {
        removeAllTokens()

        if (isInIframe()) {
          window.parent.postMessage({ type: 'TOKEN_EXPIRED' }, '*')
        }

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
}

setupInterceptors(userApi)
setupInterceptors(pluginApi)

// 默认导出 userApi（用户管理接口），同时具名导出 pluginApi
export default userApi
export { pluginApi }

// --- Batch Create Users API ---

export interface BatchCreateUserItem {
  username: string
  nickname: string
  password: string
  role: string
  status: number
}

export interface BatchCreatePayload {
  users: BatchCreateUserItem[]
}

export interface BatchCreateResultItem {
  index: number
  username: string
  success: boolean
  id?: number
  error?: string
}

export interface BatchCreateResult {
  code: number
  data: {
    total: number
    success: number
    failed: number
    results: BatchCreateResultItem[]
  }
}

export function batchCreateUsers(payload: BatchCreatePayload): Promise<{ data: BatchCreateResult }> {
  return userApi.post('/batch-create-users', payload)
}
