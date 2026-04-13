import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pluginGet } = vi.hoisted(() => ({
  pluginGet: vi.fn(),
}))

vi.mock('../api', () => ({
  default: {},
  pluginApi: {
    get: pluginGet,
  },
}))

async function loadComposable() {
  vi.resetModules()
  return import('../composables/usePermissions')
}

describe('usePermissions', () => {
  beforeEach(() => {
    pluginGet.mockReset()
  })

  it('marks loaded and grants returned actions when allowed-actions succeeds', async () => {
    pluginGet.mockResolvedValue({
      data: {
        code: 0,
        data: {
          actions: ['list-users', 'manage-organizations'],
        },
      },
    })

    const { usePermissions } = await loadComposable()
    const permissions = usePermissions()

    await permissions.fetchPermissions()

    expect(permissions.loaded.value).toBe(true)
    expect(permissions.can('list-users')).toBe(true)
    expect(permissions.can('manage-organizations')).toBe(true)
    expect(permissions.can('manage-invitations')).toBe(false)
  })

  it('fails open when the permission API is unavailable with 404', async () => {
    pluginGet.mockRejectedValue({
      response: {
        status: 404,
      },
    })

    const { usePermissions } = await loadComposable()
    const permissions = usePermissions()

    await permissions.fetchPermissions()

    expect(permissions.loaded.value).toBe(true)
    expect(permissions.hasAny()).toBe(true)
    expect(permissions.can('list-users')).toBe(true)
    expect(permissions.can('manage-invitations')).toBe(true)
    expect(permissions.can('manage-organizations')).toBe(true)
  })
})
