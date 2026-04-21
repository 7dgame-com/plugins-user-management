import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import UserForm from '../views/UserForm.vue'

const {
  routeState,
  push,
  back,
  apiGet,
  apiPost,
  listOrganizations,
  verifyCurrentToken,
  messageError,
  messageSuccess,
} = vi.hoisted(() => ({
  routeState: { params: {} as Record<string, string> },
  push: vi.fn(),
  back: vi.fn(),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  listOrganizations: vi.fn(),
  verifyCurrentToken: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => ({ push, back }),
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    error: messageError,
    success: messageSuccess,
  },
}))

vi.mock('../composables/usePermissions', () => ({
  usePermissions: () => ({ can: () => false }),
}))

vi.mock('../api', () => ({
  default: { get: apiGet, post: apiPost },
  listOrganizations: (...args: unknown[]) => listOrganizations(...args),
  verifyCurrentToken: (...args: unknown[]) => verifyCurrentToken(...args),
}))

const ElFormStub = defineComponent({
  emits: ['submit'],
  setup(_, { expose }) {
    expose({
      validate: () => Promise.resolve(true),
    })

    return {}
  },
  template: '<form @submit="$emit(`submit`, $event)"><slot /></form>',
})

const ElFormItemStub = defineComponent({
  template: '<div><slot /></div>',
})

const ElInputStub = defineComponent({
  props: ['modelValue', 'disabled', 'type', 'placeholder'],
  emits: ['update:modelValue'],
  template: '<input :value="modelValue" :disabled="disabled" :type="type || `text`" :placeholder="placeholder" @input="$emit(`update:modelValue`, $event.target.value)" />',
})

const ElSelectStub = defineComponent({
  inheritAttrs: false,
  props: ['modelValue', 'multiple', 'disabled', 'loading'],
  emits: ['update:modelValue'],
  methods: {
    normalizeValue(value: string) {
      const numericValue = Number(value)
      return Number.isNaN(numericValue) ? value : numericValue
    },
  },
  template: `
    <select
      v-bind="$attrs"
      :multiple="multiple"
      :disabled="disabled"
      @change="$emit(
        'update:modelValue',
        multiple
          ? Array.from($event.target.selectedOptions).map((option) => normalizeValue(option.value))
          : normalizeValue($event.target.value)
      )"
    >
      <slot />
    </select>
  `,
})

const ElOptionStub = defineComponent({
  props: ['value', 'label'],
  template: '<option :value="value">{{ label }}</option>',
})

const ElButtonStub = defineComponent({
  props: ['nativeType'],
  emits: ['click'],
  template: '<button :type="nativeType === `submit` ? `submit` : `button`" @click="$emit(`click`)"><slot /></button>',
})

function mountForm() {
  return mount(UserForm, {
    global: {
      components: {
        ElForm: ElFormStub,
        ElFormItem: ElFormItemStub,
        ElInput: ElInputStub,
        ElSelect: ElSelectStub,
        ElOption: ElOptionStub,
        ElButton: ElButtonStub,
      },
    },
  })
}

describe('UserForm', () => {
  beforeEach(() => {
    routeState.params = {}
    push.mockReset()
    back.mockReset()
    apiGet.mockReset()
    apiPost.mockReset()
    listOrganizations.mockReset()
    verifyCurrentToken.mockReset()
    messageError.mockReset()
    messageSuccess.mockReset()

    verifyCurrentToken.mockResolvedValue({ data: { data: { roles: ['root'] } } })
    listOrganizations.mockResolvedValue({
      data: {
        code: 0,
        data: [
          { id: 1, title: 'Acme Studio', name: 'acme' },
          { id: 2, title: 'Global Team', name: 'global' },
        ],
      },
    })
    apiPost.mockResolvedValue({ data: { code: 0 } })
  })

  it('submits selected organization ids when creating a user', async () => {
    const wrapper = mountForm()

    await flushPromises()

    const inputs = wrapper.findAll('input')
    await inputs[0].setValue('alice')
    await inputs[1].setValue('Alice Liddell')
    await inputs[2].setValue('alice@example.com')
    await inputs[3].setValue('secret123')
    expect(wrapper.get('[data-testid="organization-select"]').exists()).toBe(true)
    ;(wrapper.vm as any).form.organization_ids = [1, 2]
    await (wrapper.vm as any).handleSubmit()
    await flushPromises()

    expect(listOrganizations).toHaveBeenCalledTimes(1)
    expect(apiPost).toHaveBeenCalledWith('/create-user', expect.objectContaining({
      username: 'alice',
      nickname: 'Alice Liddell',
      email: 'alice@example.com',
      organization_ids: [1, 2],
    }))
    expect(push).toHaveBeenCalledWith('/users')
  })

  it('loads existing data in edit mode and keeps username read-only', async () => {
    routeState.params = { id: '42' }
    apiGet.mockResolvedValue({
      data: {
        data: {
          username: 'alice',
          nickname: 'Alice Liddell',
          email: 'alice@example.com',
          status: 10,
          roles: ['manager'],
          organizations: [{ id: 1, title: 'Acme Studio', name: 'acme' }],
        },
      },
    })

    const wrapper = mountForm()

    await flushPromises()

    const inputs = wrapper.findAll('input')
    expect(inputs[0].element).toHaveProperty('value', 'alice')
    expect(inputs[0].attributes('disabled')).toBeDefined()
    expect(inputs[1].element).toHaveProperty('value', 'Alice Liddell')
    expect((wrapper.vm as any).form.organization_ids).toEqual([1])
  })

  it('submits nickname and replacement organization ids when editing a user', async () => {
    routeState.params = { id: '42' }
    apiGet.mockResolvedValue({
      data: {
        data: {
          username: 'alice',
          nickname: 'Alice Liddell',
          email: 'alice@example.com',
          status: 10,
          roles: ['manager'],
          organizations: [{ id: 1, title: 'Acme Studio', name: 'acme' }],
        },
      },
    })

    const wrapper = mountForm()

    await flushPromises()

    expect(wrapper.get('[data-testid="organization-select"]').exists()).toBe(true)
    ;(wrapper.vm as any).form.nickname = 'Alice Updated'
    ;(wrapper.vm as any).form.organization_ids = [2]
    await (wrapper.vm as any).handleSubmit()
    await flushPromises()

    expect(apiPost).toHaveBeenCalledWith('/update-user', expect.objectContaining({
      id: '42',
      nickname: 'Alice Updated',
      organization_ids: [2],
    }))
    expect(apiPost).toHaveBeenCalledWith('/update-user', expect.not.objectContaining({
      username: expect.anything(),
    }))
  })

  it('does not send organization ids when organization options fail to load during edit', async () => {
    routeState.params = { id: '42' }
    listOrganizations.mockRejectedValue(new Error('network'))
    apiGet.mockResolvedValue({
      data: {
        data: {
          username: 'alice',
          nickname: 'Alice Liddell',
          email: 'alice@example.com',
          status: 10,
          roles: ['manager'],
          organizations: [{ id: 1, title: 'Acme Studio', name: 'acme' }],
        },
      },
    })

    const wrapper = mountForm()

    await flushPromises()

    expect(messageError).toHaveBeenCalled()
    expect(wrapper.get('[data-testid="organization-select"]').attributes('disabled')).toBeDefined()

    await (wrapper.vm as any).handleSubmit()
    await flushPromises()

    expect(apiPost).toHaveBeenCalledWith('/update-user', expect.not.objectContaining({
      organization_ids: expect.anything(),
    }))
  })
})
