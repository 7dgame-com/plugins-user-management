import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCan = vi.fn()

vi.mock('../composables/usePermissions', () => ({
  usePermissions: () => ({ can: mockCan }),
}))
vi.mock('element-plus', () => ({ ElMessage: { error: vi.fn() } }))
vi.mock('../utils/token', () => ({ isInIframe: vi.fn().mockReturnValue(true) }))

import { permissionGuard } from '../router/index'

const to = (meta: Record<string, unknown>) => ({ meta })
const from = (name?: string) => ({ name: name ?? null })

describe('Bug Condition Exploration', () => {
  beforeEach(() => { mockCan.mockReturnValue(false) })

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
})
