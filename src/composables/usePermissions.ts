import { computed, readonly } from 'vue'
import { useAuthSession } from './useAuthSession'

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

export function usePermissions() {
  const { user, loaded, loading, hasRootAccess, fetchSession } = useAuthSession()

  const permissions = computed<Permissions>(() => {
    const allowed = loaded.value && hasRootAccess.value

    return ALL_ACTIONS.reduce((result, action) => {
      result[action] = allowed
      return result
    }, {} as Permissions)
  })

  async function fetchPermissions(force = false) {
    await fetchSession(force)
  }

  function can(action: keyof Permissions): boolean {
    return permissions.value[action]
  }

  function hasAny(): boolean {
    return Object.values(permissions.value).some(Boolean)
  }

  return {
    user: readonly(user),
    permissions: readonly(permissions),
    loaded: readonly(loaded),
    loading: readonly(loading),
    fetchPermissions,
    can,
    hasAny,
  }
}
