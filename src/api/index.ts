import axios from 'axios'
import type { AxiosError, AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios'
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

const ROLE_WRITE_CANARY_ARM_STORAGE_KEY = 'user-mgmt-role-write-canary-arm-v1'
const ROLE_WRITE_EVIDENCE_STORAGE_KEY = 'user-mgmt-role-write-evidence-v1'
const ROLE_WRITE_REPLAY_STORAGE_KEY = 'user-mgmt-role-write-replay-v1'
const ROLE_WRITE_CANARY_ARM_TTL_MS = 5 * 60 * 1000
const ROLE_WRITE_CANARY_CLOCK_SKEW_MS = 30 * 1000
const ROLE_WRITE_CANARY_HOST_ACK_TIMEOUT_MS = 3000
const ROLE_WRITE_CANARY_TARGET_PATH = '/users'

interface PendingHostRoleWriteArm {
  armed: ArmedRoleWriteCanary
  resolve: (armed: ArmedRoleWriteCanary) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}

let pendingHostRoleWriteArm: PendingHostRoleWriteArm | null = null

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

export interface RoleWriteDecisionPreview {
  writePerformed: false
  sourceOfTruth: 'legacy'
  roleWriteMode: string
  rolloutMode: string
  selected: boolean
  reason: string
  dualWriteExecutable?: boolean
  missingCapabilities?: string[]
  correlationId: string
  route: 'change-role'
  actorFingerprint: string | null
  matchedSelectorKind: string | null
}

export interface ArmedRoleWriteCanary {
  correlationId: string
  actorFingerprint: string
  matchedSelectorKind: 'uid'
  armedAt: string
  expiresAt: string
  handoffClaimed: boolean
}

export interface RoleWriteRequestEvidence {
  recordedAt: string
  correlationId: string | null
  route: string | null
  mode: string | null
  decision: string | null
  entry: string | null
  actorFingerprint: string | null
  matchedSelectorKind: string | null
  upstreamHost: string | null
  fallbackUsed: boolean
  identityStatus: number | null
  failureCode: string | null
  guarded: boolean
  armHandoffClaimed: boolean
  idempotencyKeyPresent: boolean
  idempotencyReplay: boolean
  evidenceComplete: boolean
}

export interface GuardedRoleWriteReplay {
  correlationId: string
  actorFingerprint: string
  targetId: number
  role: 'user' | 'manager' | 'admin'
  idempotencyKey: string
  armedAt: string
  expiresAt: string
}

export function getRoleWriteDecisionPreview(correlationId = createRoleWriteCorrelationId()): Promise<{
  data: { code: number; data: RoleWriteDecisionPreview }
}> {
  return identityPluginUserApi.get('/role-write-decision', {
    headers: { 'X-Identity-IAM-Role-Write-Correlation': correlationId },
  })
}

export function armNextRoleWriteCanary(preview: RoleWriteDecisionPreview): Promise<ArmedRoleWriteCanary> {
  if (!isPassingRoleWritePreview(preview)) {
    throw new Error('Role-write canary can only be armed from a passing zero-write preview.')
  }
  if (!isInIframe()) {
    throw new Error('Role-write canary requires the authenticated plugin host.')
  }
  const armedAt = new Date()
  const armed: ArmedRoleWriteCanary = {
    correlationId: preview.correlationId,
    actorFingerprint: preview.actorFingerprint!,
    matchedSelectorKind: 'uid',
    armedAt: armedAt.toISOString(),
    expiresAt: new Date(armedAt.getTime() + ROLE_WRITE_CANARY_ARM_TTL_MS).toISOString(),
    handoffClaimed: false,
  }

  rejectPendingHostRoleWriteArm(new Error('A newer role-write preview replaced the pending request.'))
  safeSessionRemove(ROLE_WRITE_CANARY_ARM_STORAGE_KEY)

  return new Promise<ArmedRoleWriteCanary>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      if (pendingHostRoleWriteArm?.armed.correlationId !== armed.correlationId) return
      pendingHostRoleWriteArm = null
      postRoleWriteHostMessage('ROLE_WRITE_CANARY_ARM_CANCEL', {
        correlationId: armed.correlationId,
      })
      reject(new Error('Role-write canary host acknowledgement timed out.'))
    }, ROLE_WRITE_CANARY_HOST_ACK_TIMEOUT_MS)

    pendingHostRoleWriteArm = { armed, resolve, reject, timeoutId }
    postRoleWriteHostMessage('ROLE_WRITE_CANARY_ARM_REQUEST', {
      ...armed,
      targetPath: ROLE_WRITE_CANARY_TARGET_PATH,
    })
  })
}

export function getArmedRoleWriteCanary(): ArmedRoleWriteCanary | null {
  const sessionArm = safeSessionGet<ArmedRoleWriteCanary>(ROLE_WRITE_CANARY_ARM_STORAGE_KEY)
  if (isValidRoleWriteCanaryArm(sessionArm)) {
    return sessionArm
  }

  safeSessionRemove(ROLE_WRITE_CANARY_ARM_STORAGE_KEY)
  return null
}

export function clearArmedRoleWriteCanary(): void {
  const sessionArm = safeSessionGet<ArmedRoleWriteCanary>(ROLE_WRITE_CANARY_ARM_STORAGE_KEY)
  const pendingCorrelationId = pendingHostRoleWriteArm?.armed.correlationId
  rejectPendingHostRoleWriteArm(new Error('Role-write canary was cleared.'))
  safeSessionRemove(ROLE_WRITE_CANARY_ARM_STORAGE_KEY)
  postRoleWriteHostMessage('ROLE_WRITE_CANARY_ARM_CANCEL', {
    correlationId: sessionArm?.correlationId ?? pendingCorrelationId,
  })
}

export function handleRoleWriteHostMessage(
  type: string,
  payload: Record<string, unknown>
): boolean {
  if (type === 'ROLE_WRITE_CANARY_ARM_ACK') {
    const pending = pendingHostRoleWriteArm
    if (!pending) return false
    if (
      payload.accepted !== true
      || payload.correlationId !== pending.armed.correlationId
      || payload.actorFingerprint !== pending.armed.actorFingerprint
    ) {
      rejectPendingHostRoleWriteArm(new Error('Role-write canary host rejected the handoff request.'))
      return false
    }
    clearTimeout(pending.timeoutId)
    pendingHostRoleWriteArm = null
    if (!safeSessionSet(ROLE_WRITE_CANARY_ARM_STORAGE_KEY, pending.armed)) {
      postRoleWriteHostMessage('ROLE_WRITE_CANARY_ARM_CANCEL', {
        correlationId: pending.armed.correlationId,
      })
      pending.reject(new Error('Role-write canary could not persist the pending host handoff.'))
      return false
    }
    pending.resolve(pending.armed)
    return true
  }

  if (type !== 'ROLE_WRITE_CANARY_HANDOFF') {
    return false
  }

  const targetPath = payload.targetPath
  const handoff = payload as unknown as ArmedRoleWriteCanary
  const pendingArm = getArmedRoleWriteCanary()
  if (
    targetPath !== ROLE_WRITE_CANARY_TARGET_PATH
    || normalizeRoleWritePath(window.location.pathname) !== ROLE_WRITE_CANARY_TARGET_PATH
    || !pendingArm
    || pendingArm.handoffClaimed !== false
    || pendingArm.correlationId !== handoff.correlationId
    || pendingArm.actorFingerprint !== handoff.actorFingerprint
    || pendingArm.matchedSelectorKind !== handoff.matchedSelectorKind
    || handoff.handoffClaimed !== false
    || !isValidRoleWriteCanaryArm(handoff)
  ) {
    return false
  }

  const claimedHandoff: ArmedRoleWriteCanary = { ...handoff, handoffClaimed: true }
  if (!safeSessionSet(ROLE_WRITE_CANARY_ARM_STORAGE_KEY, claimedHandoff)) {
    return false
  }
  postRoleWriteHostMessage('ROLE_WRITE_CANARY_HANDOFF_CLAIMED', {
    correlationId: claimedHandoff.correlationId,
    actorFingerprint: claimedHandoff.actorFingerprint,
  })
  return true
}

export function getLastRoleWriteRequestEvidence(): RoleWriteRequestEvidence | null {
  return safeSessionGet<RoleWriteRequestEvidence>(ROLE_WRITE_EVIDENCE_STORAGE_KEY)
}

export function getPendingRoleWriteReplay(): GuardedRoleWriteReplay | null {
  const replay = safeSessionGet<GuardedRoleWriteReplay>(ROLE_WRITE_REPLAY_STORAGE_KEY)
  if (isValidGuardedRoleWriteReplay(replay)) {
    return replay
  }

  safeSessionRemove(ROLE_WRITE_REPLAY_STORAGE_KEY)
  return null
}

export async function replayLastGuardedRoleWrite(): Promise<{
  response: { data: any }
  evidence: RoleWriteRequestEvidence
}> {
  const replay = getPendingRoleWriteReplay()
  if (!replay) {
    throw new Error('No valid guarded role-write request is available for idempotency replay.')
  }

  const previewResponse = await getRoleWriteDecisionPreview(replay.correlationId)
  const preview = previewResponse.data.data
  if (!isPassingRoleWritePreview(preview) || preview.actorFingerprint !== replay.actorFingerprint) {
    safeSessionRemove(ROLE_WRITE_REPLAY_STORAGE_KEY)
    throw new Error('Role-write idempotency replay no longer matches the approved operator gate.')
  }

  const armedCanary: ArmedRoleWriteCanary = {
    correlationId: replay.correlationId,
    actorFingerprint: replay.actorFingerprint,
    matchedSelectorKind: 'uid',
    armedAt: replay.armedAt,
    expiresAt: replay.expiresAt,
    handoffClaimed: true,
  }
  const response = await identityPluginUserApi.post('/change-role', {
    id: replay.targetId,
    role: replay.role,
  }, {
    headers: guardedRoleWriteHeaders(armedCanary),
  })
  const evidence = recordRoleWriteEvidence(response, {
    armedCanary,
    fallbackUsed: false,
    identityStatus: response.status,
    idempotencyKeyPresent: true,
    idempotencyReplay: true,
  })
  if (!evidence.evidenceComplete) {
    safeSessionRemove(ROLE_WRITE_REPLAY_STORAGE_KEY)
    throw new Error('Role-write idempotency replay returned incomplete guarded evidence.')
  }

  safeSessionRemove(ROLE_WRITE_REPLAY_STORAGE_KEY)
  return { response, evidence }
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
  const armedCanary = path === '/change-role' ? getArmedRoleWriteCanary() : null
  if (path === '/change-role' && armedCanary && armedCanary.handoffClaimed !== true) {
    // A host ACK alone never permits a role write; the new iframe must claim the handoff.
    clearArmedRoleWriteCanary()
    return Promise.reject(new Error('Role-write canary requires the guarded dual-write handoff.'))
  }
  const requestConfig = path === '/change-role'
    ? withRoleWriteCorrelation(config, armedCanary)
    : config

  return identityPluginUserApi.post(path, payload, requestConfig).then((response) => {
    if (path === '/change-role') {
      const evidence = recordRoleWriteEvidence(response, {
        armedCanary,
        fallbackUsed: false,
        identityStatus: response.status,
        idempotencyKeyPresent: Boolean(armedCanary),
        idempotencyReplay: false,
      })
      if (armedCanary && evidence.evidenceComplete) {
        rememberGuardedRoleWriteReplay(armedCanary, payload)
      }
      clearArmedRoleWriteCanary()
    }
    return response
  }).catch((err: AxiosError) => {
    if (path === '/change-role' && armedCanary) {
      recordRoleWriteEvidence(err.response, {
        armedCanary,
        fallbackUsed: false,
        identityStatus: err.response?.status ?? null,
        failureCode: safeResponseCode(err),
        idempotencyKeyPresent: true,
        idempotencyReplay: false,
      })
      clearArmedRoleWriteCanary()
      return Promise.reject(err)
    }
    if (shouldFallbackToLegacyPluginUserWrite(err)) {
      return userApi.post(path, payload, requestConfig).then((response) => {
        if (path === '/change-role') {
          recordRoleWriteEvidence(response, {
            armedCanary: null,
            fallbackUsed: true,
            identityStatus: err.response?.status ?? null,
            failureCode: safeResponseCode(err),
            idempotencyKeyPresent: false,
            idempotencyReplay: false,
          })
        }
        return response
      })
    }
    return Promise.reject(err)
  })
}

function withRoleWriteCorrelation(config?: AxiosRequestConfig, armedCanary?: ArmedRoleWriteCanary | null): AxiosRequestConfig {
  const headers = { ...(config?.headers as Record<string, string> | undefined) }
  const existing = headers['X-Identity-IAM-Role-Write-Correlation']
  return {
    ...config,
    headers: {
      ...headers,
      ...(armedCanary
        ? guardedRoleWriteHeaders(armedCanary)
        : {
            'X-Identity-IAM-Role-Write-Correlation':
              typeof existing === 'string' && existing.length > 0
                ? existing
                : createRoleWriteCorrelationId(),
          }),
    },
  }
}

function guardedRoleWriteHeaders(armedCanary: ArmedRoleWriteCanary): Record<string, string> {
  return {
    'X-Identity-IAM-Role-Write-Correlation': armedCanary.correlationId,
    'X-Identity-IAM-Role-Write-Require-Dual-Write': '1',
    'Idempotency-Key': roleWriteIdempotencyKey(armedCanary.correlationId),
  }
}

function recordRoleWriteEvidence(
  response: AxiosResponse | undefined,
  context: {
    armedCanary: ArmedRoleWriteCanary | null
    fallbackUsed: boolean
    identityStatus: number | null
    failureCode?: string | null
    idempotencyKeyPresent?: boolean
    idempotencyReplay?: boolean
  }
): RoleWriteRequestEvidence {
  const correlationId = responseHeader(response, 'x-identity-iam-role-write-correlation')
  const route = responseHeader(response, 'x-identity-iam-role-write-route')
  const mode = responseHeader(response, 'x-identity-iam-role-write')
  const decision = responseHeader(response, 'x-identity-iam-role-write-decision')
  const entry = responseHeader(response, 'x-identity-iam-role-write-entry')
  const actorFingerprint = responseHeader(response, 'x-identity-iam-role-write-actor')
  const matchedSelectorKind = responseHeader(response, 'x-identity-iam-role-write-selector-kind')
  const upstreamHost = responseHeader(response, 'x-xrugc-upstream-host')
  const armed = context.armedCanary
  const evidence: RoleWriteRequestEvidence = {
    recordedAt: new Date().toISOString(),
    correlationId,
    route,
    mode,
    decision,
    entry,
    actorFingerprint,
    matchedSelectorKind,
    upstreamHost,
    fallbackUsed: context.fallbackUsed,
    identityStatus: context.identityStatus,
    failureCode: context.failureCode ?? null,
    guarded: Boolean(armed),
    armHandoffClaimed: Boolean(armed?.handoffClaimed),
    idempotencyKeyPresent: context.idempotencyKeyPresent === true,
    idempotencyReplay: context.idempotencyReplay === true,
    evidenceComplete: Boolean(
      armed
      && armed.handoffClaimed === true
      && !context.fallbackUsed
      && context.identityStatus !== null
      && context.identityStatus >= 200
      && context.identityStatus < 300
      && mode === 'dual-write'
      && decision === 'canary_actor_selected'
      && entry === 'plugin-user-change-role'
      && route === 'change-role'
      && correlationId === armed.correlationId
      && actorFingerprint === armed.actorFingerprint
      && matchedSelectorKind === 'uid'
      && upstreamHost
      && context.idempotencyKeyPresent === true
    ),
  }
  safeSessionSet(ROLE_WRITE_EVIDENCE_STORAGE_KEY, evidence)
  return evidence
}

function responseHeader(response: AxiosResponse | undefined, name: string): string | null {
  const value = response?.headers?.[name]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function safeResponseCode(error: AxiosError): string | null {
  const code = (error.response?.data as any)?.code
  return typeof code === 'string' || typeof code === 'number' ? String(code).slice(0, 80) : null
}

function isPassingRoleWritePreview(preview: RoleWriteDecisionPreview): boolean {
  return preview.writePerformed === false
    && preview.sourceOfTruth === 'legacy'
    && preview.roleWriteMode === 'dual-write'
    && preview.rolloutMode === 'canary'
    && preview.selected === true
    && preview.reason === 'canary_actor_selected'
    && preview.dualWriteExecutable === true
    && Array.isArray(preview.missingCapabilities)
    && preview.missingCapabilities.length === 0
    && preview.route === 'change-role'
    && preview.matchedSelectorKind === 'uid'
    && isSafeCorrelationId(preview.correlationId)
    && typeof preview.actorFingerprint === 'string'
    && /^[a-f0-9]{16}$/.test(preview.actorFingerprint)
}

function isSafeCorrelationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{8,128}$/.test(value)
}

function isValidRoleWriteCanaryArm(armed: ArmedRoleWriteCanary | null): armed is ArmedRoleWriteCanary {
  const now = Date.now()
  const armedAt = Date.parse(armed?.armedAt ?? '')
  const expiresAt = Date.parse(armed?.expiresAt ?? '')
  return Boolean(
    armed
    && isSafeCorrelationId(armed.correlationId)
    && /^[a-f0-9]{16}$/.test(armed.actorFingerprint)
    && armed.matchedSelectorKind === 'uid'
    && typeof armed.handoffClaimed === 'boolean'
    && Number.isFinite(armedAt)
    && Number.isFinite(expiresAt)
    && armedAt <= now + ROLE_WRITE_CANARY_CLOCK_SKEW_MS
    && expiresAt > armedAt
    && expiresAt > now
    && expiresAt - armedAt <= ROLE_WRITE_CANARY_ARM_TTL_MS
    && expiresAt <= now + ROLE_WRITE_CANARY_ARM_TTL_MS + ROLE_WRITE_CANARY_CLOCK_SKEW_MS
  )
}

function rememberGuardedRoleWriteReplay(armed: ArmedRoleWriteCanary, payload: unknown): void {
  const body = payload && typeof payload === 'object' ? payload as Record<string, unknown> : null
  const targetId = Number(body?.id)
  const role = body?.role
  if (!Number.isInteger(targetId) || targetId <= 0 || !isReplayableRole(role)) {
    safeSessionRemove(ROLE_WRITE_REPLAY_STORAGE_KEY)
    return
  }

  safeSessionSet(ROLE_WRITE_REPLAY_STORAGE_KEY, {
    correlationId: armed.correlationId,
    actorFingerprint: armed.actorFingerprint,
    targetId,
    role,
    idempotencyKey: roleWriteIdempotencyKey(armed.correlationId),
    armedAt: armed.armedAt,
    expiresAt: armed.expiresAt,
  } satisfies GuardedRoleWriteReplay)
}

function isValidGuardedRoleWriteReplay(replay: GuardedRoleWriteReplay | null): replay is GuardedRoleWriteReplay {
  if (!replay || !isSafeCorrelationId(replay.correlationId)) return false
  if (!/^[a-f0-9]{16}$/.test(replay.actorFingerprint)) return false
  if (!Number.isInteger(replay.targetId) || replay.targetId <= 0) return false
  if (!isReplayableRole(replay.role)) return false
  if (replay.idempotencyKey !== roleWriteIdempotencyKey(replay.correlationId)) return false

  const armedAt = Date.parse(replay.armedAt)
  const expiresAt = Date.parse(replay.expiresAt)
  const now = Date.now()
  return Number.isFinite(armedAt)
    && Number.isFinite(expiresAt)
    && armedAt <= now + ROLE_WRITE_CANARY_CLOCK_SKEW_MS
    && expiresAt > now
    && expiresAt - armedAt <= ROLE_WRITE_CANARY_ARM_TTL_MS
}

function isReplayableRole(role: unknown): role is GuardedRoleWriteReplay['role'] {
  return role === 'user' || role === 'manager' || role === 'admin'
}

function roleWriteIdempotencyKey(correlationId: string): string {
  return `role-write-canary:${correlationId}`
}

function safeSessionSet(key: string, value: unknown): boolean {
  try {
    sessionStorage.setItem(key, JSON.stringify(value))
    return sessionStorage.getItem(key) !== null
  } catch {
    return false
  }
}

function safeSessionGet<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) as T : null
  } catch {
    return null
  }
}

function safeSessionRemove(key: string): void {
  try {
    sessionStorage.removeItem(key)
  } catch {
    // Ignore storage policy failures.
  }
}

function rejectPendingHostRoleWriteArm(error: Error): void {
  const pending = pendingHostRoleWriteArm
  if (!pending) return
  clearTimeout(pending.timeoutId)
  pendingHostRoleWriteArm = null
  pending.reject(error)
}

function postRoleWriteHostMessage(type: string, payload: Record<string, unknown>): void {
  window.parent.postMessage({
    type,
    id: `role-write-host-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    payload,
  }, '*')
}

function normalizeRoleWritePath(path: string): string {
  const normalized = path.replace(/\/+$/, '')
  return normalized || '/'
}

function createRoleWriteCorrelationId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `role-write-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
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
