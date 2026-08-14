<template>
  <section class="role-write-operator" aria-labelledby="role-write-operator-title">
    <header class="operator-header">
      <div>
        <h2 id="role-write-operator-title">角色写入受控窗口</h2>
        <p>
          先用当前 iframe 登录态执行零写入预检。只有全部门禁通过，才会向宿主申请一次性、
          五分钟有效的 guarded handoff；预检本身不会写入角色、candidate 或 ledger。
        </p>
      </div>
      <el-tag type="warning" effect="plain">操作员专用</el-tag>
    </header>

    <el-alert
      title="此页面不会绕过 Identity 的 default-off、selector、policy checksum 或 guarded handoff 门禁。"
      type="warning"
      :closable="false"
      show-icon
    />

    <div class="operator-actions">
      <el-button type="primary" :loading="previewLoading" @click="runPreview">
        执行零写入预检
      </el-button>
      <el-button @click="refreshEvidence">刷新最近写入证据</el-button>
      <el-button
        v-if="replayAvailable"
        type="warning"
        :loading="replayLoading"
        @click="runReplay"
      >
        执行一次性幂等重放
      </el-button>
    </div>

    <el-alert
      v-if="previewError"
      :title="previewError"
      type="error"
      :closable="false"
      show-icon
    />
    <el-alert
      v-if="replayError"
      :title="replayError"
      type="error"
      :closable="false"
      show-icon
    />

    <dl v-if="preview" class="evidence-grid" aria-label="零写入预检结果">
      <div><dt>门禁</dt><dd><el-tag :type="previewPassed ? 'success' : 'danger'">{{ previewPassed ? 'PASS' : 'STOP' }}</el-tag></dd></div>
      <div><dt>writePerformed</dt><dd>{{ preview.writePerformed }}</dd></div>
      <div><dt>sourceOfTruth</dt><dd>{{ preview.sourceOfTruth }}</dd></div>
      <div><dt>roleWriteMode</dt><dd>{{ preview.roleWriteMode }}</dd></div>
      <div><dt>rolloutMode</dt><dd>{{ preview.rolloutMode }}</dd></div>
      <div><dt>selected</dt><dd>{{ preview.selected }}</dd></div>
      <div><dt>decision</dt><dd>{{ preview.reason }}</dd></div>
      <div><dt>dualWriteExecutable</dt><dd>{{ preview.dualWriteExecutable === true }}</dd></div>
      <div><dt>selectorKind</dt><dd>{{ preview.matchedSelectorKind || '-' }}</dd></div>
      <div><dt>missingCapabilities</dt><dd>{{ preview.missingCapabilities?.join(', ') || 'none' }}</dd></div>
    </dl>

    <el-alert
      v-if="canaryArmed"
      title="预检已通过；下一次角色写入已进入一次性 guarded handoff，五分钟后自动失效。"
      type="success"
      :closable="false"
      show-icon
    />
    <el-button
      v-if="canaryArmed"
      type="warning"
      class="continue-button"
      @click="continueToUsers"
    >
      进入用户列表并领取 handoff
    </el-button>

    <dl v-if="lastEvidence" class="evidence-grid" aria-label="最近角色写入证据">
      <div><dt>证据门禁</dt><dd><el-tag :type="lastEvidence.evidenceComplete ? 'success' : 'danger'">{{ lastEvidence.evidenceComplete ? 'PASS' : 'STOP' }}</el-tag></dd></div>
      <div><dt>guarded</dt><dd>{{ lastEvidence.guarded }}</dd></div>
      <div><dt>handoffClaimed</dt><dd>{{ lastEvidence.armHandoffClaimed }}</dd></div>
      <div><dt>idempotencyKeyPresent</dt><dd>{{ lastEvidence.idempotencyKeyPresent }}</dd></div>
      <div><dt>idempotencyReplay</dt><dd>{{ lastEvidence.idempotencyReplay }}</dd></div>
      <div><dt>fallbackUsed</dt><dd>{{ lastEvidence.fallbackUsed }}</dd></div>
      <div><dt>mode</dt><dd>{{ lastEvidence.mode || '-' }}</dd></div>
      <div><dt>decision</dt><dd>{{ lastEvidence.decision || '-' }}</dd></div>
      <div><dt>entry</dt><dd>{{ lastEvidence.entry || '-' }}</dd></div>
      <div><dt>route</dt><dd>{{ lastEvidence.route || '-' }}</dd></div>
      <div><dt>Identity status</dt><dd>{{ lastEvidence.identityStatus ?? '-' }}</dd></div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  armNextRoleWriteCanary,
  clearArmedRoleWriteCanary,
  getArmedRoleWriteCanary,
  getLastRoleWriteRequestEvidence,
  getPendingRoleWriteReplay,
  getRoleWriteDecisionPreview,
  isPassingRoleWritePreview,
  replayLastGuardedRoleWrite,
  type RoleWriteDecisionPreview,
  type RoleWriteRequestEvidence,
} from '../api'

const router = useRouter()
const previewLoading = ref(false)
const preview = ref<RoleWriteDecisionPreview | null>(null)
const previewPassed = ref(false)
const previewError = ref('')
const canaryArmed = ref(Boolean(getArmedRoleWriteCanary()))
const lastEvidence = ref<RoleWriteRequestEvidence | null>(getLastRoleWriteRequestEvidence())
const replayAvailable = ref(Boolean(getPendingRoleWriteReplay()))
const replayLoading = ref(false)
const replayError = ref('')

function refreshEvidence(): void {
  lastEvidence.value = getLastRoleWriteRequestEvidence()
  canaryArmed.value = Boolean(getArmedRoleWriteCanary())
  replayAvailable.value = Boolean(getPendingRoleWriteReplay())
}

async function runPreview(): Promise<void> {
  previewLoading.value = true
  preview.value = null
  previewPassed.value = false
  previewError.value = ''
  clearArmedRoleWriteCanary()
  canaryArmed.value = false

  try {
    const response = await getRoleWriteDecisionPreview()
    const result = response.data.data
    preview.value = result
    previewPassed.value = isPassingRoleWritePreview(result)
    if (!previewPassed.value) {
      previewError.value = '零写入预检未通过；角色写入保持 fail-closed。'
      return
    }
    await armNextRoleWriteCanary(result)
    canaryArmed.value = true
  } catch (error: any) {
    const status = error.response?.status
    const message = error.response?.data?.message || error.message || String(error)
    previewError.value = status ? `HTTP ${status}: ${message}` : message
  } finally {
    previewLoading.value = false
  }
}

function continueToUsers(): void {
  if (!getArmedRoleWriteCanary()) {
    canaryArmed.value = false
    previewError.value = '角色写入预检已失效，请重新执行零写入预检。'
    return
  }
  void router.push('/users')
}

async function runReplay(): Promise<void> {
  replayLoading.value = true
  replayError.value = ''
  try {
    const result = await replayLastGuardedRoleWrite()
    lastEvidence.value = result.evidence
  } catch (error: any) {
    const status = error.response?.status
    const message = error.response?.data?.message || error.message || String(error)
    replayError.value = status ? `HTTP ${status}: ${message}` : message
  } finally {
    replayAvailable.value = Boolean(getPendingRoleWriteReplay())
    replayLoading.value = false
  }
}
</script>

<style scoped>
.role-write-operator {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 960px;
  margin: 0 auto;
}

.operator-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.operator-header h2,
.operator-header p {
  margin: 0;
}

.operator-header p {
  margin-top: 8px;
  color: var(--text-secondary);
  line-height: 1.6;
}

.operator-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.evidence-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
  margin: 0;
  padding: 16px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-card);
}

.evidence-grid div {
  min-width: 0;
}

.evidence-grid dt {
  color: var(--text-secondary);
  font-size: 12px;
}

.evidence-grid dd {
  margin: 4px 0 0;
  overflow-wrap: anywhere;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}

.continue-button {
  align-self: flex-start;
}

@media (max-width: 640px) {
  .operator-header {
    flex-direction: column;
  }
}
</style>
