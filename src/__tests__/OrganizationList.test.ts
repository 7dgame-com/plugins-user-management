import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import OrganizationList from '../views/OrganizationList.vue'

const { listOrganizations, createOrganization, updateOrganization, messageError, messageSuccess } = vi.hoisted(() => ({
  listOrganizations: vi.fn(),
  createOrganization: vi.fn(),
  updateOrganization: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
}))

vi.mock('../api', () => ({
  listOrganizations: (...args: unknown[]) => listOrganizations(...args),
  createOrganization: (...args: unknown[]) => createOrganization(...args),
  updateOrganization: (...args: unknown[]) => updateOrganization(...args),
}))

vi.mock('element-plus', () => ({
  ElMessage: {
    error: messageError,
    success: messageSuccess,
  },
}))

const ElButtonStub = defineComponent({
  emits: ['click'],
  template: '<button @click="$emit(`click`)"><slot /></button>',
})

const ElInputStub = defineComponent({
  props: ['modelValue', 'disabled'],
  emits: ['update:modelValue'],
  template: '<input :value="modelValue" :disabled="disabled" @input="$emit(`update:modelValue`, $event.target.value)" />',
})

const ElTableStub = defineComponent({
  props: ['data'],
  template: '<div><slot /><div v-for="row in data" :key="row.id">{{ row.title }} {{ row.name }}</div></div>',
})

const passthroughStub = defineComponent({
  template: '<div><slot /><slot name="footer" /></div>',
})

describe('OrganizationList', () => {
  beforeEach(() => {
    listOrganizations.mockReset()
    createOrganization.mockReset()
    updateOrganization.mockReset()
    messageError.mockReset()
    messageSuccess.mockReset()

    listOrganizations.mockResolvedValue({
      data: {
        code: 0,
        data: [{ id: 1, title: 'Acme Studio', name: 'acme' }],
      },
    })
    createOrganization.mockResolvedValue({
      data: {
        code: 0,
        data: { id: 2, title: 'Global Team', name: 'global' },
      },
    })
    updateOrganization.mockResolvedValue({
      data: {
        code: 0,
        data: { id: 1, title: 'Acme Updated', name: 'acme' },
      },
    })
  })

  function mountPage() {
    return mount(OrganizationList, {
      global: {
        plugins: [i18n],
        directives: {
          loading: () => {},
        },
        stubs: {
          ElTable: ElTableStub,
          ElTableColumn: passthroughStub,
          ElCard: passthroughStub,
          ElForm: passthroughStub,
          ElFormItem: passthroughStub,
          ElDialog: passthroughStub,
          ElButton: ElButtonStub,
          ElInput: ElInputStub,
        },
      },
    })
  }

  it('loads organizations on mount and renders the returned organization payload', async () => {
    const wrapper = mountPage()
    await flushPromises()

    expect(listOrganizations).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Acme Studio')
    expect(wrapper.text()).toContain('acme')
  })

  it('creates a new organization from the dialog form', async () => {
    const wrapper = mountPage()
    await flushPromises()

    ;(wrapper.vm as any).openCreateDialog()
    ;(wrapper.vm as any).form.title = 'Global Team'
    ;(wrapper.vm as any).form.name = 'global'

    await (wrapper.vm as any).handleSubmit()
    await flushPromises()

    expect(createOrganization).toHaveBeenCalledWith({
      title: 'Global Team',
      name: 'global',
    })
    expect(messageSuccess).toHaveBeenCalled()
  })

  it('updates an existing organization title without changing its machine name', async () => {
    const wrapper = mountPage()
    await flushPromises()

    ;(wrapper.vm as any).openEditDialog({ id: 1, title: 'Acme Studio', name: 'acme' })
    ;(wrapper.vm as any).form.title = 'Acme Updated'

    await (wrapper.vm as any).handleSubmit()
    await flushPromises()

    expect(updateOrganization).toHaveBeenCalledWith({
      id: 1,
      title: 'Acme Updated',
    })
    expect(createOrganization).not.toHaveBeenCalled()
    expect(messageSuccess).toHaveBeenCalled()
  })
})
