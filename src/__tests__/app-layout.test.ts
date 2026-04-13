import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { flushPromises, mount } from '@vue/test-utils'
import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import AppLayout from '../layout/AppLayout.vue'

const { apiGet, fetchPermissions } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  fetchPermissions: vi.fn(),
}))

vi.mock('../api', () => ({
  default: { get: apiGet },
}))

vi.mock('../composables/usePermissions', () => ({
  usePermissions: () => ({
    loaded: ref(true),
    fetchPermissions,
    hasAny: () => true,
    can: (action: string) => action === 'manage-organizations' || action === 'list-users',
  }),
}))

describe('AppLayout', () => {
  beforeEach(() => {
    apiGet.mockReset()
    fetchPermissions.mockReset()
    apiGet.mockResolvedValue({
      data: { id: 1, username: 'root', nickname: 'Root', roles: ['admin'] },
    })
  })

  it('renders the organizations navigation entry when permission is granted', async () => {
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
        },
      },
    })

    await flushPromises()

    expect(fetchPermissions).toHaveBeenCalledTimes(1)
    expect(wrapper.find('[data-to="/organizations"]').exists()).toBe(true)
    expect(wrapper.find('[data-to="/organizations"]').text()).toContain('组织管理')
  })

  it('keeps the sidebar visible on desktop layouts', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/layout/AppLayout.vue'), 'utf8')

    expect(source).toContain(":class=\"{ 'with-sidebar': hasAny() }\"")
    expect(source).toContain('@media (min-width: 1024px)')
    expect(source).toContain('transform: none;')
    expect(source).toContain('.main-area.with-sidebar')
    expect(source).toContain('margin-left: 260px;')
  })
})
