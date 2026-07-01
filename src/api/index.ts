import axios from 'axios'
import type { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios'
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
 * Identity 兼容接口。读路径已用于 users list/detail 和邀请读取；
 * Stage 9.8 起，用户管理写路径会先尝试 identity legacy-proxy。
 */
const identityPluginUserApi = axios.create({
  baseURL: '/api-auth/v1/plugin-user',
  timeout: 10000
})

/**
 * 主后端接口（指向主系统 /api/v1）
 */
const mainApi = axios.create({
  baseURL: '/api/v1',
  timeout: 10000
})

// --- Token refresh state ---
let isRefreshing = false
let failedQueue: Array<{
  resolve: (token: string) => void
  reject: (error: Error) => void
}> = []
let bootstrapTokenPromise: Promise<string | null> | null = null

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
    const res = await axios.post('/api/v1/auth/refresh', { refreshToken })
    const tokenPayload = res.data?.token ?? res.data
    const accessToken = tokenPayload?.accessToken ?? tokenPayload?.token
    const newRefreshToken = tokenPayload?.refreshToken

    if (!accessToken) {
      return null
    }

    setToken(accessToken)
    if (newRefreshToken) setRefreshToken(newRefreshToken)
    return accessToken
  } catch {
    return null
  }
}

async function getRequestToken(): Promise<string | null> {
  const token = getToken()
  if (token) return token

  if (!isInIframe()) {
    return null
  }

  if (!bootstrapTokenPromise) {
    bootstrapTokenPromise = requestParentTokenRefresh()
      .then((result) => {
        const accessToken = result?.accessToken ?? getToken()
        if (accessToken) {
          setToken(accessToken)
        }
        return accessToken
      })
      .finally(() => {
        bootstrapTokenPromise = null
      })
  }

  return bootstrapTokenPromise
}

/**
 * 为 axios 实例添加请求/响应拦截器
 */
function setupInterceptors(instance: ReturnType<typeof axios.create>) {
  // Request: 注入 Authorization header
  instance.interceptors.request.use(async (config) => {
    const token = await getRequestToken()
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
setupInterceptors(identityPluginUserApi)
setupInterceptors(mainApi)

// 默认导出 userApi（用户管理接口），同时具名导出 mainApi
export default userApi
export { identityPluginUserApi, mainApi }

export interface VerifyTokenResponse {
  code: number
  message?: string
  data: {
    id: number
    username?: string
    nickname?: string
    roles?: string[]
  }
}

/**
 * 当前用户 token 校验始终由主后端提供。
 */
export function verifyCurrentToken(): Promise<{ data: VerifyTokenResponse }> {
  return mainApi.get('/plugin/verify-token')
}

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
  organization_ids?: number[]
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
  message?: string
  data: {
    total: number
    success: number
    failed: number
    results: BatchCreateResultItem[]
  }
}

export function batchCreateUsers(payload: BatchCreatePayload): Promise<{ data: BatchCreateResult }> {
  return postPluginUserWrite('/batch-create-users', payload, {
    // Batch creation is intentionally long-running for larger user sets.
    // Keep this request from inheriting the generic 10s timeout and
    // incorrectly surfacing a failure after the server already completed.
    timeout: 0,
  })
}

export function createPluginUser(payload: Record<string, unknown>): Promise<{ data: any }> {
  return postPluginUserWrite('/create-user', payload)
}

export function updatePluginUser(payload: Record<string, unknown>): Promise<{ data: any }> {
  return postPluginUserWrite('/update-user', payload)
}

export function deletePluginUser(id: string | number): Promise<{ data: any }> {
  return postPluginUserWrite('/delete-user', { id })
}

export function changePluginUserRole(id: string | number, role: string): Promise<{ data: any }> {
  return postPluginUserWrite('/change-role', { id, role })
}

export function getPluginUsers(params?: Record<string, unknown>): Promise<{ data: any }> {
  return getPluginUserReadonly('/users', params)
}

export function getPluginUserDetail(id: string | number): Promise<{ data: any }> {
  return getPluginUserReadonly('/users', { id })
}

export interface LoginAuditStats {
  legacyUserId: number | null
  identityUserId: string | null
  username: string | null
  loginCount: number
  failedLoginCount: number
  lastLoginAt: string | null
  lastFailedLoginAt: string | null
  updatedAt: string | null
}

export interface LoginAuditRecentEvent {
  eventKey: string
  eventType: string
  success: boolean
  occurredAt: string
  source: string
  traceId: string | null
  metadata: unknown
}

export interface LoginAuditResponse {
  code: number
  data: {
    stats: LoginAuditStats | null
    recentEvents: LoginAuditRecentEvent[]
  }
}

export function getPluginUserLoginAudit(id: string | number): Promise<{ data: LoginAuditResponse }> {
  return identityPluginUserApi.get(`/users/${id}/login-audit`)
}

export function listPluginInvitations(): Promise<{ data: any }> {
  return getPluginUserReadonly('/invitations')
}

export function listPluginInvitationRecords(code: string): Promise<{ data: any }> {
  return getPluginUserReadonly('/invitation-records', { code })
}

function getPluginUserReadonly(path: string, params?: Record<string, unknown>): Promise<{ data: any }> {
  return identityPluginUserApi.get(path, { params }).catch((err: AxiosError) => {
    if (shouldFallbackToLegacyPluginUser(err)) {
      return userApi.get(path, { params })
    }
    return Promise.reject(err)
  })
}

function postPluginUserWrite(
  path: string,
  payload: unknown,
  config?: AxiosRequestConfig
): Promise<{ data: any }> {
  return identityPluginUserApi.post(path, payload, config).catch((err: AxiosError) => {
    if (shouldFallbackToLegacyPluginUserWrite(err)) {
      return userApi.post(path, payload, config)
    }
    return Promise.reject(err)
  })
}

function shouldFallbackToLegacyPluginUser(err: AxiosError): boolean {
  if (!err.response) {
    return true
  }
  return [401, 404, 502, 503, 504].includes(err.response.status)
}

function shouldFallbackToLegacyPluginUserWrite(err: AxiosError): boolean {
  const response = err.response
  if (!response || response.status !== 404) {
    return false
  }

  const data = response.data as any
  const code = data?.code
  if (code === 'PLUGIN_USER_WRITE_DISABLED' || code === 'PLUGIN_USER_WRITE_UNSUPPORTED_MODE') {
    return true
  }

  if (code) {
    return false
  }

  const message = typeof data?.message === 'string' ? data.message : ''
  if (message.startsWith('Cannot POST /v1/plugin-user/')) {
    return true
  }

  return typeof data === 'string' || data == null
}

export interface OrganizationItem {
  id: number
  title: string
  name: string
}

export interface OrganizationListResponse {
  code: number
  data: OrganizationItem[]
}

export interface OrganizationDetailResponse {
  code: number
  data: OrganizationItem
}

export function listOrganizations(): Promise<{ data: OrganizationListResponse }> {
  return mainApi.get('/organization/list')
}

export function createOrganization(
  payload: Pick<OrganizationItem, 'title' | 'name'>
): Promise<{ data: OrganizationDetailResponse }> {
  return mainApi.post('/organization/create', payload)
}

export function updateOrganization(
  payload: Pick<OrganizationItem, 'id' | 'title'>
): Promise<{ data: OrganizationDetailResponse }> {
  return mainApi.post('/organization/update', payload)
}
