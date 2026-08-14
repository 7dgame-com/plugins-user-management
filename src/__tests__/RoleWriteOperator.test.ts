import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const push = vi.fn()
const apiMocks = vi.hoisted(() => ({
  armNextRoleWriteCanary: vi.fn(),
  clearArmedRoleWriteCanary: vi.fn(),
  getArmedRoleWriteCanary: vi.fn(),
  getLastRoleWriteRequestEvidence: vi.fn(),
  getPendingRoleWriteReplay: vi.fn(),
  getRoleWriteDecisionPreview: vi.fn(),
  isPassingRoleWritePreview: vi.fn(),
  replayLastGuardedRoleWrite: vi.fn(),
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('../api', () => apiMocks)
import RoleWriteOperator from '../views/RoleWriteOperator.vue'

const passingPreview = {
  writePerformed: false,
  sourceOfTruth: 'legacy',
  roleWriteMode: 'dual-write',
  rolloutMode: 'canary',
  selected: true,
  reason: 'canary_actor_selected',
  dualWriteExecutable: true,
  missingCapabilities: [],
  correlationId: 'role-write-test-1234',
  route: 'change-role',
  actorFingerprint: '0123456789abcdef',
  matchedSelectorKind: 'uid',
}

function mountOperator() {
  return mount(RoleWriteOperator, {
    global: {
      stubs: {
        ElAlert: { props: ['title'], template: '<div>{{ title }}<slot /></div>' },
        ElButton: { template: '<button @click="$emit(\'click\')"><slot /></button>' },
        ElTag: { template: '<span><slot /></span>' },
      },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  apiMocks.getArmedRoleWriteCanary.mockReturnValue(null)
  apiMocks.getLastRoleWriteRequestEvidence.mockReturnValue(null)
  apiMocks.getPendingRoleWriteReplay.mockReturnValue(null)
  apiMocks.isPassingRoleWritePreview.mockImplementation((preview) => preview.selected === true)
  apiMocks.armNextRoleWriteCanary.mockResolvedValue({ ...passingPreview, handoffClaimed: false })
})

describe('RoleWriteOperator', () => {
  it('arms only after a complete zero-write preview passes', async () => {
    apiMocks.getRoleWriteDecisionPreview.mockResolvedValue({ data: { data: passingPreview } })
    const wrapper = mountOperator()

    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => expect(apiMocks.armNextRoleWriteCanary).toHaveBeenCalledWith(passingPreview))

    expect(wrapper.text()).toContain('PASS')
    expect(wrapper.text()).toContain('下一次角色写入已进入一次性 guarded handoff')
  })

  it('keeps fail-closed when preview is not selected', async () => {
    apiMocks.getRoleWriteDecisionPreview.mockResolvedValue({
      data: { data: { ...passingPreview, selected: false, reason: 'rollout_off' } },
    })
    const wrapper = mountOperator()

    await wrapper.get('button').trigger('click')
    await vi.waitFor(() => expect(wrapper.text()).toContain('STOP'))

    expect(apiMocks.armNextRoleWriteCanary).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('角色写入保持 fail-closed')
  })
})
