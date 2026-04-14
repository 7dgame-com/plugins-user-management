import { flushPromises, mount } from '@vue/test-utils'
import { computed, defineComponent, h, inject, provide, type ComputedRef } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UserList from '../views/UserList.vue'

const TABLE_ROWS_KEY = Symbol('tableRows')

const { apiGet, verifyCurrentToken, messageError } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  verifyCurrentToken: vi.fn(),
  messageError: vi.fn(),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    error: messageError,
  },
}))

vi.mock('../composables/usePermissions', () => ({
  usePermissions: () => ({
    can: (action: string) => action === 'list-users',
  }),
}))

vi.mock('../api', () => ({
  default: { get: apiGet },
  verifyCurrentToken: (...args: unknown[]) => verifyCurrentToken(...args),
}))

const ElTableStub = defineComponent({
  props: ['data'],
  setup(props, { slots }) {
    provide(TABLE_ROWS_KEY, computed(() => props.data ?? []))
    return () => h('div', { class: 'el-table-stub' }, slots.default?.())
  },
})

const ElTableColumnStub = defineComponent({
  props: ['prop'],
  setup(props, { slots }) {
    const rows = inject<ComputedRef<any[]>>(TABLE_ROWS_KEY, computed(() => []))

    return () =>
      h(
        'div',
        { class: 'el-table-column-stub', 'data-prop': props.prop || '' },
        rows.value.map((row, index) =>
          h(
            'div',
            { key: `${props.prop || 'column'}-${index}` },
            slots.default ? slots.default({ row }) : String(row[props.prop as string] ?? '')
          )
        )
      )
  },
})

const ElInputStub = defineComponent({
  props: ['modelValue'],
  emits: ['update:modelValue', 'clear', 'keyup'],
  template: '<input :value="modelValue" @input="$emit(`update:modelValue`, $event.target.value)" />',
})

const ElPaginationStub = defineComponent({
  template: '<div class="pagination-stub" />',
})

const ElButtonStub = defineComponent({
  emits: ['click'],
  template: '<button @click="$emit(`click`)"><slot /></button>',
})

const passthroughStub = defineComponent({
  template: '<div><slot /></div>',
})

function buildListResponse(organizations: Array<{ id: number; title: string; name: string }>) {
  return {
    data: {
      data: [
        {
          id: 1,
          username: 'alice',
          nickname: 'Alice',
          email: 'alice@example.com',
          roles: ['manager'],
          created_at: 1710000000,
          organizations,
        },
      ],
      pagination: {
        total: 1,
      },
    },
  }
}

function mountPage() {
  return mount(UserList, {
    global: {
      directives: {
        loading: () => {},
      },
      stubs: {
        ElTable: ElTableStub,
        ElTableColumn: ElTableColumnStub,
        ElInput: ElInputStub,
        ElButton: ElButtonStub,
        ElPagination: ElPaginationStub,
        ElIcon: passthroughStub,
        ElSelect: passthroughStub,
        ElOption: passthroughStub,
        ElPopconfirm: passthroughStub,
        ElTooltip: passthroughStub,
        Search: true,
        Plus: true,
      },
    },
  })
}

describe('UserList', () => {
  beforeEach(() => {
    apiGet.mockReset()
    verifyCurrentToken.mockReset()
    messageError.mockReset()

    verifyCurrentToken.mockResolvedValue({ data: { data: { roles: ['admin'] } } })
  })

  it('renders organization titles from the user list payload', async () => {
    apiGet.mockResolvedValue(buildListResponse([
      { id: 1, title: 'Acme Studio', name: 'acme' },
      { id: 2, title: 'Global Team', name: 'global' },
    ]))

    const wrapper = mountPage()
    await flushPromises()

    const organizationColumn = wrapper.find('[data-prop="organizations"]')
    expect(organizationColumn.exists()).toBe(true)
    expect(organizationColumn.text()).toContain('Acme Studio')
    expect(organizationColumn.text()).toContain('Global Team')
  })

  it('renders a placeholder when the user has no organizations', async () => {
    apiGet.mockResolvedValue(buildListResponse([]))

    const wrapper = mountPage()
    await flushPromises()

    const organizationColumn = wrapper.find('[data-prop="organizations"]')
    expect(organizationColumn.exists()).toBe(true)
    expect(organizationColumn.text()).toContain('-')
  })
})
