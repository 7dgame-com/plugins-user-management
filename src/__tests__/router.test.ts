import { describe, it, expect } from 'vitest'
import router from '../router'

describe('router', () => {
  it('has /register route', () => {
    const routes = router.getRoutes()
    const register = routes.find(r => r.path === '/register')
    expect(register).toBeDefined()
    expect(register?.name).toBe('Register')
  })

  it('has /users route', () => {
    const routes = router.getRoutes()
    const users = routes.find(r => r.path === '/users')
    expect(users).toBeDefined()
    expect(users?.name).toBe('UserList')
  })

  it('has /users/create route', () => {
    const routes = router.getRoutes()
    const create = routes.find(r => r.path === '/users/create')
    expect(create).toBeDefined()
    expect(create?.name).toBe('UserCreate')
  })

  it('has /invitations route', () => {
    const routes = router.getRoutes()
    const invitations = routes.find(r => r.path === '/invitations')
    expect(invitations).toBeDefined()
    expect(invitations?.name).toBe('InvitationList')
  })
})
