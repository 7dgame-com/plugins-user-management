import { beforeEach, describe, expect, it, vi } from 'vitest'

const verifyCurrentToken = vi.fn()

vi.mock('../api/index', () => ({
  verifyCurrentToken,
}))

describe('useAuthSession', () => {
  beforeEach(() => {
    vi.resetModules()
    verifyCurrentToken.mockReset()
  })

  it('marks the session as root-capable only when verify-token returns the root role', async () => {
    verifyCurrentToken.mockResolvedValue({
      data: {
        data: {
          id: 7,
          username: 'root-user',
          nickname: 'Root',
          roles: ['root'],
        },
      },
    })

    const { useAuthSession } = await import('../composables/useAuthSession')
    const session = useAuthSession()

    await session.fetchSession(true)

    expect(session.user.value).toEqual({
      id: 7,
      username: 'root-user',
      nickname: 'Root',
      roles: ['root'],
    })
    expect(session.isRootUser.value).toBe(true)
    expect(session.isAdminUser.value).toBe(false)
    expect(session.hasRootAccess.value).toBe(true)
  })

  it('keeps admin users outside the local root-only matrix', async () => {
    verifyCurrentToken.mockResolvedValue({
      data: {
        data: {
          id: 8,
          username: 'admin-user',
          nickname: 'Admin',
          roles: ['admin'],
        },
      },
    })

    const { useAuthSession } = await import('../composables/useAuthSession')
    const session = useAuthSession()

    await session.fetchSession(true)

    expect(session.user.value).toEqual({
      id: 8,
      username: 'admin-user',
      nickname: 'Admin',
      roles: ['admin'],
    })
    expect(session.isRootUser.value).toBe(false)
    expect(session.isAdminUser.value).toBe(true)
    expect(session.hasRootAccess.value).toBe(false)
  })

  it('keeps non-admin users outside the local management matrix', async () => {
    verifyCurrentToken.mockResolvedValue({
      data: {
        data: {
          id: 11,
          username: 'manager-user',
          roles: ['manager', 'user'],
        },
      },
    })

    const { useAuthSession } = await import('../composables/useAuthSession')
    const session = useAuthSession()

    await session.fetchSession(true)

    expect(session.user.value).toEqual({
      id: 11,
      username: 'manager-user',
      roles: ['manager', 'user'],
    })
    expect(session.isRootUser.value).toBe(false)
    expect(session.isAdminUser.value).toBe(false)
    expect(session.hasRootAccess.value).toBe(false)
  })
})
