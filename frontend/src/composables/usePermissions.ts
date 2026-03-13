import { ref, readonly } from 'vue'
import api from '../api'

export interface Permissions {
  'list-users': boolean
  'view-user': boolean
  'create-user': boolean
  'update-user': boolean
  'delete-user': boolean
  'change-role': boolean
  'manage-invitations': boolean
}

const permissions = ref<Permissions>({
  'list-users': false,
  'view-user': false,
  'create-user': false,
  'update-user': false,
  'delete-user': false,
  'change-role': false,
  'manage-invitations': false,
})

const loaded = ref(false)
const loading = ref(false)

export function usePermissions() {
  async function fetchPermissions() {
    if (loaded.value || loading.value) return
    loading.value = true
    try {
      const { data } = await api.get('/users/permissions')
      Object.assign(permissions.value, data)
      loaded.value = true
    } catch {
      // 权限获取失败时保持默认（全部 false）
    } finally {
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
