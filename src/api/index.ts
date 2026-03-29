import axios from 'axios'
import type { AxiosError, InternalAxiosRequestConfig } from 'axios'
import {
  getToken,
  setToken,
  removeAllTokens,
  isInIframe,
  requestParentTokenRefresh
} from '../utils/token'

/**
 * 用户管理接口（指向主后端 /v1/plugin-user）
 */
const userApi = axios.create({
  baseURL: '/v1/plugin-user',
  timeout: 10000
})

/**
 * 通用插件接口（指向主后端 /v1/plugin，如 verify-token、allowed-actions）
 */
const pluginApi = axios.create({
  baseURL: '/v1/plugin',
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
 * 为 axios 实例添加请求/响应拦截器
 */
function setupInterceptors(instance: ReturnType<typeof axios.create>) {
  // Request: 注入 Authorization header
  instance.interceptors.request.use((config) => {
    const token = getToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  // Response: 处理 401 刷新
  instance.interceptors.response.use(
    (res) => res,
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
        let result: { accessToken: string } | null = null

        if (isInIframe()) {
          result = await requestParentTokenRefresh()
        }

        if (!result || !result.accessToken) {
          throw new Error('Token refresh failed')
        }

        setToken(result.accessToken)
        processQueue(null, result.accessToken)

        originalRequest.headers.Authorization = `Bearer ${result.accessToken}`
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
