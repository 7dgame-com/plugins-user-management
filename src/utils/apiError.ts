const FIELD_LABELS: Record<string, string> = {
  id: '用户 ID',
  username: '用户名',
  nickname: '昵称',
  email: '邮箱',
  password: '密码',
  password_hash: '密码',
  password_reset_token: '密码重置令牌',
  auth_key: '授权密钥',
  status: '状态',
  role: '角色',
  organization_ids: '所属组织',
  organization_id: '所属组织',
  user_id: '用户',
  created_at: '创建时间',
  updated_at: '更新时间',
  email_verified_at: '邮箱验证时间',
}

const BACKEND_MESSAGE_MAP: Array<[RegExp, string]> = [
  [/^organization_ids 必须为数组$/i, '所属组织参数格式不正确，请重新选择组织'],
  [/^organization_ids 仅允许正整数$/i, '所属组织参数格式不正确，请重新选择组织'],
  [/^存在无效的 organization_ids$/i, '所选组织不存在或已失效，请重新选择'],
  [/^保存用户组织关系失败$/i, '保存用户所属组织失败，请稍后重试'],
  [/^创建用户失败$/i, '创建用户失败，请稍后重试'],
  [/^更新用户失败$/i, '更新用户失败，请稍后重试'],
  [/^角色修改失败$/i, '角色修改失败，请稍后重试'],
  [/^Your request was made with invalid credentials\.$/i, '登录状态已失效，请重新登录后再试'],
  [/^You are requesting with an invalid credential\.$/i, '登录状态已失效，请重新登录后再试'],
  [/^You are not allowed to perform this action\.$/i, '没有权限执行此操作'],
  [/^Page not found\.$/i, '接口不存在或已下线，请联系管理员'],
  [/^Network Error$/i, '网络异常，请检查连接后重试'],
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)))
}

function labelFor(attribute: string | undefined): string {
  if (!attribute) return '字段'

  const normalized = attribute
    .trim()
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()

  return FIELD_LABELS[normalized] || attribute.trim()
}

function normalizeMessage(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim()
}

function translateEnglishValidation(message: string, field?: string): string | null {
  const quotedUnique = message.match(/^(.+?) "(.+)" has already been taken\.$/i)
  if (quotedUnique) {
    return `${labelFor(field || quotedUnique[1])}“${quotedUnique[2]}”已存在`
  }

  const unique = message.match(/^(.+?) has already been taken\.$/i)
  if (unique) {
    return `${labelFor(field || unique[1])}已存在`
  }

  const blank = message.match(/^(.+?) cannot be blank\.$/i)
  if (blank) {
    return `请填写${labelFor(field || blank[1])}`
  }

  if (/^The email format is invalid\.$/i.test(message)) {
    return '邮箱格式不正确'
  }

  const invalidEmail = message.match(/^(.+?) is not a valid email address\.$/i)
  if (invalidEmail) {
    return `请输入有效的${labelFor(field || invalidEmail[1])}`
  }

  const invalid = message.match(/^(.+?) is invalid\.$/i)
  if (invalid) {
    return `${labelFor(field || invalid[1])}格式不正确`
  }

  const maxLength = message.match(/^(.+?) should contain at most (\d+) characters?\.$/i)
  if (maxLength) {
    return `${labelFor(field || maxLength[1])}不能超过 ${maxLength[2]} 个字符`
  }

  const minLength = message.match(/^(.+?) should contain at least (\d+) characters?\.$/i)
  if (minLength) {
    return `${labelFor(field || minLength[1])}不能少于 ${minLength[2]} 个字符`
  }

  const integer = message.match(/^(.+?) must be an integer\.$/i)
  if (integer) {
    return `${labelFor(field || integer[1])}必须为整数`
  }

  return null
}

function translateBackendMessage(raw: string, field?: string): string {
  const message = normalizeMessage(raw)
  if (!message) return ''

  for (const [pattern, replacement] of BACKEND_MESSAGE_MAP) {
    if (pattern.test(message)) return replacement
  }

  return translateEnglishValidation(message, field) || message
}

function collectValidationMessages(value: unknown, field?: string): string[] {
  if (!value) return []

  if (typeof value === 'string') {
    return [translateBackendMessage(value, field)]
  }

  if (Array.isArray(value)) {
    return value.flatMap((item) => collectValidationMessages(item, field))
  }

  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, nestedValue]) => {
      if (['code', 'status', 'type', 'name'].includes(key)) return []
      if (key === 'message' || key === 'error') {
        return collectValidationMessages(nestedValue, field)
      }
      if (key === 'errors') {
        return collectValidationMessages(nestedValue, field)
      }
      return collectValidationMessages(nestedValue, key)
    })
  }

  return []
}

function getResponseData(error: unknown): unknown {
  if (isRecord(error) && isRecord(error.response) && 'data' in error.response) {
    return error.response.data
  }

  return undefined
}

function getResponseStatus(error: unknown): number | undefined {
  if (!isRecord(error) || !isRecord(error.response)) return undefined
  const status = error.response.status
  return typeof status === 'number' ? status : undefined
}

function getErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message
  if (isRecord(error) && typeof error.message === 'string') return error.message
  return undefined
}

export function formatApiError(error: unknown, fallback = '操作失败'): string {
  const data = getResponseData(error)
  const status = getResponseStatus(error)

  if (isRecord(data)) {
    const primary = typeof data.message === 'string'
      ? translateBackendMessage(data.message)
      : undefined
    const nestedError = data.error
    const nestedMessages = nestedError
      ? collectValidationMessages(nestedError)
      : []
    const detailMessages = data.errors
      ? collectValidationMessages(data.errors)
      : []

    if (primary) {
      const details = uniq([...detailMessages, ...nestedMessages]).filter((item) => item !== primary)
      return details.length > 0 ? `${primary}：${details.join('；')}` : primary
    }

    const messages = uniq(collectValidationMessages(data))
    if (messages.length > 0) {
      return messages.join('；')
    }
  }

  if (typeof data === 'string') {
    return translateBackendMessage(data)
  }

  if (status === 401) return '登录状态已失效，请重新登录后再试'
  if (status === 403) return '没有权限执行此操作'
  if (status === 404) return '接口不存在或已下线，请联系管理员'
  if (status && status >= 500) return '服务暂时不可用，请稍后重试'

  const message = getErrorMessage(error)
  if (message) {
    if (/timeout/i.test(message)) return '请求超时，请稍后重试'
    return translateBackendMessage(message)
  }

  return fallback
}
