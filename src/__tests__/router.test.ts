import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCan = vi.fn()

vi.mock('../composables/usePermissions', () => ({
  usePermissions: () => ({ can: mockCan }),
}))
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }))
vi.mock('../utils/token', () => ({ isInIframe: vi.fn().mockReturnValue(true) }))

import router, { permissionGuard } from '../router/index'
import { isInIframe } from '../utils/token'
import { requestPendingRoleWriteHostHandoff } from '../utils/hostEvents'

const to = (meta: Record<string, unknown>) => ({ meta })
const from = (name?: string) => ({ name: name ?? null })

beforeEach(() => {
  vi.restoreAllMocks()
  vi.mocked(isInIframe).mockReturnValue(true)
  mockCan.mockReturnValue(false)
})

describe('Bug Condition Exploration', () => {
  it('Bug 4: guard returns false when permission is denied', () => {
    const result = permissionGuard(
      to({ requiresPermission: 'list-users' }),
      from('Home')
    )
    expect(result).toBe(false) // FAILS on unfixed code (returns true)
  })
})

describe('Preservation', () => {
  it('meta.public routes pass through regardless of permissions', () => {
    mockCan.mockReturnValue(false)
    expect(permissionGuard(to({ public: true }), from())).toBe(true)
  })

  it('routes without requiresPermission pass through', () => {
    mockCan.mockReturnValue(false)
    expect(permissionGuard(to({}), from())).toBe(true)
  })

  it('routes with permission granted pass through', () => {
    mockCan.mockReturnValue(true)
    expect(permissionGuard(to({ requiresPermission: 'list-users' }), from('Home'))).toBe(true)
  })

  it('organization management route is protected by manage-organizations', () => {
    mockCan.mockImplementation((permission: string) => permission === 'manage-organizations')
    const result = permissionGuard(
      to({ requiresPermission: 'manage-organizations' }),
      from('Home')
    )
    expect(result).toBe(true)
  })

  it('invitation management route is protected by manage-invitations', () => {
    const invitationRoute = router.getRoutes().find((route) => route.name === 'InvitationList')

    expect(invitationRoute?.meta.requiresPermission).toBe('manage-invitations')
  })

  it('sends plugin-url-changed events after route changes', async () => {
    mockCan.mockReturnValue(true)
    const postMessageSpy = vi
      .spyOn(window.parent, 'postMessage')
      .mockImplementation(() => undefined)

    await router.push('/organizations?tab=members#top')

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'EVENT',
        payload: {
          event: 'plugin-url-changed',
          pluginUrl: '/organizations?tab=members#top',
        },
      }),
      '*'
    )
  })

  it('requests a pending host handoff after entering the user list in the same iframe', async () => {
    mockCan.mockReturnValue(true)
    const postMessageSpy = vi
      .spyOn(window.parent, 'postMessage')
      .mockImplementation(() => undefined)

    await router.push('/users')

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ROLE_WRITE_CANARY_HANDOFF_REQUEST',
        payload: { targetPath: '/users' },
      }),
      '*'
    )
  })

  it('does not request a role-write handoff for another plugin route', async () => {
    mockCan.mockReturnValue(true)
    const postMessageSpy = vi
      .spyOn(window.parent, 'postMessage')
      .mockImplementation(() => undefined)

    await router.push('/organizations')

    expect(postMessageSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'ROLE_WRITE_CANARY_HANDOFF_REQUEST' }),
      '*'
    )
  })

  it('does not request a role-write handoff outside the authenticated plugin host', () => {
    vi.mocked(isInIframe).mockReturnValue(false)
    const postMessageSpy = vi
      .spyOn(window.parent, 'postMessage')
      .mockImplementation(() => undefined)

    expect(requestPendingRoleWriteHostHandoff('/users')).toBe(false)
    expect(postMessageSpy).not.toHaveBeenCalled()
  })
})
