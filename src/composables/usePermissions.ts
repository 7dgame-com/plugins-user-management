import { ref, readonly } from 'vue'
import { pluginApi } from '../api'

export interface Permissions {
  'list-users': boolean
  'view-user': boolean
  'create-user': boolean
  'update-user': boolean
  'delete-user': boolean
  'change-role': boolean
  'manage-invitations': boolean
  'manage-organizations': boolean
}

const permissions = ref<Permissions>({
  'list-users': false,
  'view-user': false,
  'create-user': false,
  'update-user': false,
  'delete-user': false,
  'change-role': false,
  'manage-invitations': false,
  'manage-organizations': false,
})

const loaded = ref(false)
const loading = ref(false)

const ALL_ACTIONS: (keyof Permissions)[] = [
  'list-users',
  'view-user',
  'create-user',
  'update-user',
  'delete-user',
  'change-role',
  'manage-invitations',
  'manage-organizations',
]

function applyAllowedActions(allowedActions: string[]) {
  const hasWildcard = allowedActions.includes('*')
  ALL_ACTIONS.forEach((action) => {
    permissions.value[action] = hasWildcard || allowedActions.includes(action)
  })
}

export function usePermissions() {
  async function fetchPermissions() {
    if (loaded.value || loading.value) return
    loading.value = true
    try {
      const { data } = await pluginApi.get('/allowed-actions', {
        params: { plugin_name: 'user-management' }
      })
      if (data.code === 0) {
        applyAllowedActions(data.data?.actions || [])
      }
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status

      // 与宿主插件系统保持一致：权限 API 不存在时默认开放，避免开发环境卡死。
      if (status === 404) {
        applyAllowedActions(['*'])
      }
      // 其他错误保留默认（全部 false），由 UI 展示无权限态。
    } finally {
      loaded.value = true
      loading.value = false
    }
  }

  function can(action: keyof Permissions): boolean {
    return permissions.value[action]
  }

  function hasAny(): boolean {
    return Object.values(permissions.value).some(Boolean)
  }

  return {
    permissions: readonly(permissions),
    loaded: readonly(loaded),
    loading: readonly(loading),
    fetchPermissions,
    can,
    hasAny,
  }
}
