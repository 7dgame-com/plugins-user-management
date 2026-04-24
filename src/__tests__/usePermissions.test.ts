import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fetchSession, sessionState } = vi.hoisted(() => ({
  fetchSession: vi.fn(),
  sessionState: {
    loaded: { value: false },
    loading: { value: false },
    user: { value: null as null | { roles?: string[] } },
    isRootUser: { value: false },
    isAdminUser: { value: false },
    hasRootAccess: { value: false },
  },
}))

vi.mock('../composables/useAuthSession', () => ({
  useAuthSession: () => ({
    user: sessionState.user,
    loaded: sessionState.loaded,
    loading: sessionState.loading,
    isRootUser: sessionState.isRootUser,
    isAdminUser: sessionState.isAdminUser,
    hasRootAccess: sessionState.hasRootAccess,
    fetchSession,
  }),
}))

async function loadComposable() {
  vi.resetModules()
  return import('../composables/usePermissions')
}

describe('usePermissions', () => {
  beforeEach(() => {
    fetchSession.mockReset()
    sessionState.loaded.value = false
    sessionState.loading.value = false
    sessionState.user.value = null
    sessionState.isRootUser.value = false
    sessionState.isAdminUser.value = false
    sessionState.hasRootAccess.value = false
  })

  it('delegates loading to auth-session and grants all actions only to root users', async () => {
    sessionState.loaded.value = true
    sessionState.user.value = { roles: ['root'] }
    sessionState.isRootUser.value = true
    sessionState.hasRootAccess.value = true

    const { usePermissions } = await loadComposable()
    const permissions = usePermissions()

    await permissions.fetchPermissions()

    expect(fetchSession).toHaveBeenCalledTimes(1)
    expect(permissions.loaded.value).toBe(true)
    expect(permissions.hasAny()).toBe(true)
    expect(permissions.can('list-users')).toBe(true)
    expect(permissions.can('manage-invitations')).toBe(true)
    expect(permissions.can('manage-organizations')).toBe(true)
  })

  it('denies management actions for admin users because the plugin is now root-only', async () => {
    sessionState.loaded.value = true
    sessionState.user.value = { roles: ['admin'] }
    sessionState.isAdminUser.value = true

    const { usePermissions } = await loadComposable()
    const permissions = usePermissions()

    await permissions.fetchPermissions()

    expect(permissions.loaded.value).toBe(true)
    expect(permissions.hasAny()).toBe(false)
    expect(permissions.can('list-users')).toBe(false)
    expect(permissions.can('manage-invitations')).toBe(false)
    expect(permissions.can('manage-organizations')).toBe(false)
  })

  it('denies management actions for authenticated users without root roles', async () => {
    sessionState.loaded.value = true
    sessionState.user.value = { roles: ['manager', 'user'] }

    const { usePermissions } = await loadComposable()
    const permissions = usePermissions()

    await permissions.fetchPermissions()

    expect(permissions.loaded.value).toBe(true)
    expect(permissions.hasAny()).toBe(false)
    expect(permissions.can('list-users')).toBe(false)
    expect(permissions.can('manage-invitations')).toBe(false)
    expect(permissions.can('manage-organizations')).toBe(false)
  })
})
