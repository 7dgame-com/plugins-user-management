import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import AppLayout from '../layout/AppLayout.vue'

const { fetchPermissions, fetchSession } = vi.hoisted(() => ({
  fetchPermissions: vi.fn(),
  fetchSession: vi.fn(),
}))

vi.mock('../composables/usePermissions', () => ({
  usePermissions: () => ({
    loaded: ref(true),
    fetchPermissions,
    hasAny: () => true,
    can: (action: string) => action === 'manage-organizations' || action === 'list-users',
  }),
}))

vi.mock('../composables/useAuthSession', () => ({
  useAuthSession: () => ({
    user: ref({ id: 1, username: 'root', nickname: 'Root', roles: ['root'] }),
    fetchSession,
  }),
}))

describe('AppLayout', () => {
  beforeEach(() => {
    fetchPermissions.mockReset()
    fetchSession.mockReset()
  })

  it('renders the organizations navigation entry when local access is granted', async () => {
    const wrapper = mount(AppLayout, {
      global: {
        plugins: [i18n],
        mocks: {
          $route: { path: '/organizations', meta: { title: '组织管理' } },
        },
        stubs: {
          RouterLink: {
            props: ['to'],
            template: '<a :data-to="to"><slot /></a>',
          },
          RouterView: { template: '<div />' },
          ElIcon: { template: '<i><slot /></i>' },
          ElTag: { template: '<span><slot /></span>' },
          ElEmpty: { template: '<div />' },
          Close: true,
          User: true,
          Plus: true,
          Fold: true,
          Link: true,
          DocumentCopy: true,
          Loading: true,
          OfficeBuilding: true,
          Expand: true,
        },
      },
    })

    await flushPromises()

    expect(fetchPermissions).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-to="/organizations"]').exists()).toBe(true)
    expect(wrapper.find('[data-to="/organizations"]').text()).toContain('组织管理')
  })

  it('shows a navbar toggle button that can manually expand the sidebar', async () => {
    const wrapper = mount(AppLayout, {
      global: {
        plugins: [i18n],
        mocks: {
          $route: { path: '/users', meta: { title: '用户管理' } },
        },
        stubs: {
          RouterLink: {
            props: ['to'],
            template: '<a :data-to="to"><slot /></a>',
          },
          RouterView: { template: '<div />' },
          ElIcon: { template: '<i><slot /></i>' },
          ElTag: { template: '<span><slot /></span>' },
          ElEmpty: { template: '<div />' },
          Close: true,
          User: true,
          Plus: true,
          Fold: true,
          Link: true,
          DocumentCopy: true,
          Loading: true,
          OfficeBuilding: true,
          Expand: true,
        },
      },
    })

    await flushPromises()

    expect(wrapper.find('.sidebar').classes()).not.toContain('open')
    expect(wrapper.find('.menu-btn').attributes('aria-label')).toBe('展开侧边栏')

    await wrapper.find('.menu-btn').trigger('click')

    expect(wrapper.find('.sidebar').classes()).toContain('open')
  })

  it('keeps the sidebar collapsed by default on desktop layouts', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/layout/AppLayout.vue'), 'utf8')

    expect(source).toContain('@media (min-width: 1024px)')
    expect(source).not.toContain('transform: none;')
    expect(source).not.toContain('.main-area.with-sidebar')
    expect(source).not.toContain('margin-left: 260px;')
  })
})
