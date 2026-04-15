import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import BatchCreateForm from '../views/BatchCreateForm.vue'

const {
  push,
  batchCreateUsers,
  verifyCurrentToken,
  listOrganizations,
  messageError,
} = vi.hoisted(() => ({
  push: vi.fn(),
  batchCreateUsers: vi.fn(),
  verifyCurrentToken: vi.fn(),
  listOrganizations: vi.fn(),
  messageError: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push }),
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

vi.mock('../api', () => ({
  batchCreateUsers: (...args: unknown[]) => batchCreateUsers(...args),
  verifyCurrentToken: (...args: unknown[]) => verifyCurrentToken(...args),
  listOrganizations: (...args: unknown[]) => listOrganizations(...args),
}))

const ElFormStub = defineComponent({
  setup(_, { expose }) {
    expose({
      validate: () => Promise.resolve(true),
    })

    return {}
  },
  template: '<form><slot /></form>',
})

const ElFormItemStub = defineComponent({ template: '<div><slot /></div>' })

const ElInputStub = defineComponent({
  props: ['modelValue', 'type', 'placeholder'],
  emits: ['update:modelValue'],
  template: '<input :value="modelValue" :type="type || `text`" :placeholder="placeholder" @input="$emit(`update:modelValue`, $event.target.value)" />',
})

const ElInputNumberStub = defineComponent({
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: '<input type="number" :value="modelValue" @input="$emit(`update:modelValue`, Number($event.target.value))" />',
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
  emits: ['click'],
  template: '<button type="button" @click="$emit(`click`)"><slot /></button>',
})

const ElAlertStub = defineComponent({ template: '<div><slot /></div>' })
const ElTableStub = defineComponent({ template: '<div><slot /></div>' })
const ElTableColumnStub = defineComponent({ template: '<div><slot /></div>' })
const ElTagStub = defineComponent({ template: '<span><slot /></span>' })

function mountForm() {
  return mount(BatchCreateForm, {
    global: {
      components: {
        ElForm: ElFormStub,
        ElFormItem: ElFormItemStub,
        ElInput: ElInputStub,
        ElInputNumber: ElInputNumberStub,
        ElSelect: ElSelectStub,
        ElOption: ElOptionStub,
        ElButton: ElButtonStub,
        ElAlert: ElAlertStub,
        ElTable: ElTableStub,
        ElTableColumn: ElTableColumnStub,
        ElTag: ElTagStub,
      },
    },
  })
}

describe('BatchCreateForm', () => {
  beforeEach(() => {
    push.mockReset()
    batchCreateUsers.mockReset()
    verifyCurrentToken.mockReset()
    listOrganizations.mockReset()
    messageError.mockReset()

    verifyCurrentToken.mockResolvedValue({ data: { data: { roles: ['admin'] } } })
    listOrganizations.mockResolvedValue({
      data: {
        code: 0,
        data: [
          { id: 1, title: 'Acme Studio', name: 'acme' },
          { id: 2, title: 'Global Team', name: 'global' },
        ],
      },
    })
    batchCreateUsers.mockResolvedValue({
      data: {
        data: { total: 2, success: 2, failed: 0, results: [] },
      },
    })
  })

  it('submits shared organization ids in the top-level batch payload', async () => {
    const wrapper = mountForm()
    await flushPromises()

    ;(wrapper.vm as any).form.usernameTemplate = 'student_{001}'
    ;(wrapper.vm as any).form.nicknameTemplate = 'Student {001}'
    ;(wrapper.vm as any).form.count = 2
    ;(wrapper.vm as any).form.password = 'secret123'
    ;(wrapper.vm as any).form.role = 'user'
    ;(wrapper.vm as any).form.status = 10
    ;(wrapper.vm as any).form.organization_ids = [1, 2]

    await (wrapper.vm as any).handleSubmit()
    await flushPromises()

    expect(batchCreateUsers).toHaveBeenCalledWith({
      users: [
        { username: 'student_001', nickname: 'Student 001', password: 'secret123', role: 'user', status: 10 },
        { username: 'student_002', nickname: 'Student 002', password: 'secret123', role: 'user', status: 10 },
      ],
      organization_ids: [1, 2],
    })
  })

  it('disables organization selection and shows an error when organizations fail to load', async () => {
    listOrganizations.mockRejectedValueOnce(new Error('network'))

    const wrapper = mountForm()
    await flushPromises()

    expect(messageError).toHaveBeenCalled()
    expect(wrapper.get('[data-testid="organization-select"]').attributes('disabled')).toBeDefined()
  })
})
