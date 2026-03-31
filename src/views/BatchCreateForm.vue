<template>
  <div class="batch-create">
    <!-- 表单阶段 -->
    <div v-if="phase === 'form' || phase === 'submitting'" class="form-card">
      <div class="form-header">
        <h3>{{ t('user.batch.title') }}</h3>
      </div>
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        style="max-width: 560px; padding: var(--spacing-lg)"
      >
        <el-form-item :label="t('user.batch.usernameTemplate')" prop="usernameTemplate">
          <el-input v-model="form.usernameTemplate" :placeholder="t('user.batch.usernameTemplatePlaceholder')" />
          <div class="form-hint">{{ t('user.batch.usernameTemplateHint') }}</div>
        </el-form-item>
        <el-form-item :label="t('user.batch.nicknameTemplate')" prop="nicknameTemplate">
          <el-input v-model="form.nicknameTemplate" :placeholder="t('user.batch.nicknameTemplatePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('user.batch.startNumber')" prop="startNumber">
          <el-input-number v-model="form.startNumber" :min="1" />
        </el-form-item>
        <el-form-item :label="t('user.batch.count')" prop="count">
          <el-input-number v-model="form.count" :min="1" :max="100" />
        </el-form-item>
        <el-form-item :label="t('user.batch.password')" prop="password">
          <el-input v-model="form.password" type="password" show-password :placeholder="t('user.batch.passwordPlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('user.batch.role')" prop="role">
          <el-select v-model="form.role" style="width: 100%">
            <el-option v-for="opt in availableRoleOptions" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('user.batch.status')">
          <el-select v-model="form.status" style="width: 100%">
            <el-option :label="t('user.status.active')" :value="10" />
            <el-option :label="t('user.status.disabled')" :value="0" />
          </el-select>
        </el-form-item>
      </el-form>

      <!-- 预览表格 -->
      <div class="preview-section">
        <h4>{{ t('user.batch.preview') }}</h4>
        <el-alert v-if="!usernameHasPlaceholder || !nicknameHasPlaceholder" type="warning" :closable="false" show-icon style="margin-bottom: 12px">
          {{ t('user.batch.previewNoPlaceholderWarning') }}
        </el-alert>
        <el-table :data="previewRows" border size="small">
          <el-table-column prop="index" :label="t('user.batch.previewIndex')" width="60" />
          <el-table-column prop="username" :label="t('user.batch.previewUsername')" />
          <el-table-column prop="nickname" :label="t('user.batch.previewNickname')" />
        </el-table>
        <div v-if="form.count > 10" class="preview-more">
          {{ t('user.batch.previewMore', { n: form.count - 10 }) }}
        </div>
      </div>

      <div style="padding: 0 var(--spacing-lg) var(--spacing-lg)">
        <el-button type="primary" :loading="phase === 'submitting'" @click="handleSubmit">
          {{ phase === 'submitting' ? t('user.batch.submitting') : t('user.batch.submit') }}
        </el-button>
        <el-button @click="$router.push('/users')">{{ t('common.cancel') }}</el-button>
      </div>
    </div>

    <!-- 结果阶段 -->
    <div v-if="phase === 'result'" class="form-card">
      <div class="form-header">
        <h3>{{ t('user.batch.resultTitle') }}</h3>
      </div>
      <div class="result-section">
        <el-alert v-if="resultData && resultData.failed === 0" type="success" :closable="false" show-icon>
          {{ t('user.batch.resultAllSuccess') }}
        </el-alert>
        <div v-if="resultData" class="result-summary">
          <el-tag type="success">{{ t('user.batch.resultSuccess', { n: resultData.success }) }}</el-tag>
          <el-tag v-if="resultData.failed > 0" type="danger">{{ t('user.batch.resultFailed', { n: resultData.failed }) }}</el-tag>
        </div>
        <div v-if="failedItems.length > 0" class="failed-details">
          <h4>{{ t('user.batch.failedDetails') }}</h4>
          <el-table :data="failedItems" border size="small">
            <el-table-column prop="username" :label="t('user.batch.failedUsername')" />
            <el-table-column prop="error" :label="t('user.batch.failedReason')" />
          </el-table>
        </div>
        <div class="result-actions">
          <el-button type="primary" @click="$router.push('/users')">{{ t('user.batch.backToList') }}</el-button>
          <el-button @click="handleCreateAnother">{{ t('user.batch.createAnother') }}</el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import type { FormInstance } from 'element-plus'
import { ElMessage } from 'element-plus'
import { pluginApi } from '../api'
import { batchCreateUsers } from '../api'
import type { BatchCreateResultItem } from '../api'

const { t } = useI18n()
const router = useRouter()

const ROLE_PRIORITY: Record<string, number> = { root: 4, admin: 3, manager: 2, user: 1 }

type PagePhase = 'form' | 'submitting' | 'result'

const phase = ref<PagePhase>('form')
const formRef = ref<FormInstance>()
const currentUserRoles = ref<string[]>([])
const resultData = ref<{ total: number; success: number; failed: number; results: BatchCreateResultItem[] } | null>(null)

const form = reactive({
  usernameTemplate: '',
  nicknameTemplate: '',
  startNumber: 1,
  count: 10,
  password: '',
  role: 'user',
  status: 10,
})

// --- Template parsing ---

interface TemplateParseResult {
  prefix: string
  suffix: string
  padLength: number
  hasPlaceholder: boolean
}

function parseTemplate(template: string): TemplateParseResult {
  const match = template.match(/\{(\d+)\}/)
  if (!match) {
    return { prefix: template, suffix: '', padLength: 0, hasPlaceholder: false }
  }
  const idx = match.index!
  const digits = match[1]
  const padLength = digits.length > 1 || digits === '0' ? digits.length : 0
  return {
    prefix: template.substring(0, idx),
    suffix: template.substring(idx + match[0].length),
    padLength,
    hasPlaceholder: true,
  }
}

function generateNames(parsed: TemplateParseResult, startNumber: number, count: number): string[] {
  if (!parsed.hasPlaceholder) {
    return new Array(count).fill(parsed.prefix) as string[]
  }
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const num = startNumber + i
    const numStr = parsed.padLength > 0 ? String(num).padStart(parsed.padLength, '0') : String(num)
    names.push(parsed.prefix + numStr + parsed.suffix)
  }
  return names
}

// --- Computed ---

const usernameParsed = computed(() => parseTemplate(form.usernameTemplate))
const nicknameParsed = computed(() => parseTemplate(form.nicknameTemplate))
const usernameHasPlaceholder = computed(() => usernameParsed.value.hasPlaceholder)
const nicknameHasPlaceholder = computed(() => nicknameParsed.value.hasPlaceholder)

const previewRows = computed(() => {
  const count = Math.min(form.count, 10)
  const usernames = generateNames(usernameParsed.value, form.startNumber, count)
  const nicknames = generateNames(nicknameParsed.value, form.startNumber, count)
  return usernames.map((u, i) => ({
    index: i + 1,
    username: u,
    nickname: nicknames[i],
  }))
})

function getRoleLevel(roles?: string[]): number {
  if (!roles || roles.length === 0) return 0
  return Math.max(...roles.map((r: string) => ROLE_PRIORITY[r] || 0))
}

const availableRoleOptions = computed(() => {
  const myLevel = getRoleLevel(currentUserRoles.value)
  return Object.entries(ROLE_PRIORITY)
    .filter(([role, level]: [string, number]) => level <= myLevel && role !== 'root')
    .sort(([, a]: [string, number], [, b]: [string, number]) => b - a)
    .map(([role]: [string, number]) => ({ value: role, label: t(`user.roles.${role}`) }))
})

const failedItems = computed(() => {
  if (!resultData.value) return []
  return resultData.value.results.filter((r: BatchCreateResultItem) => !r.success)
})

const rules = computed(() => ({
  usernameTemplate: [{ required: true, message: t('user.batch.validation.usernameTemplateRequired'), trigger: 'blur' }],
  nicknameTemplate: [{ required: true, message: t('user.batch.validation.nicknameTemplateRequired'), trigger: 'blur' }],
  password: [
    { required: true, message: t('user.batch.validation.passwordRequired'), trigger: 'blur' },
    { min: 6, message: t('user.batch.validation.passwordMinLength'), trigger: 'blur' },
  ],
  role: [{ required: true, message: t('user.batch.validation.roleRequired'), trigger: 'change' }],
}))

// --- Actions ---

async function fetchCurrentUser() {
  try {
    const { data } = await pluginApi.get('/verify-token', { params: { plugin_name: 'user-management' } })
    currentUserRoles.value = data.data?.roles || []
  } catch { /* silent */ }
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  if (form.role === 'root') {
    ElMessage.error(t('user.messages.rootRoleNotAllowed', '不允许将用户设置为 root 角色'))
    return
  }
  phase.value = 'submitting'
  const usernames = generateNames(usernameParsed.value, form.startNumber, form.count)
  const nicknames = generateNames(nicknameParsed.value, form.startNumber, form.count)

  const users = usernames.map((username, i) => ({
    username,
    nickname: nicknames[i],
    password: form.password,
    role: form.role,
    status: form.status,
  }))

  try {
    const { data } = await batchCreateUsers({ users })
    resultData.value = data.data
    phase.value = 'result'
  } catch (err: any) {
    phase.value = 'form'
    const msg = err.response?.data?.message || t('user.messages.operationFailed')
    ElMessage.error(msg)
  }
}

function handleCreateAnother() {
  // If there were failures, keep form params; otherwise reset
  if (resultData.value && resultData.value.failed === 0) {
    form.usernameTemplate = ''
    form.nicknameTemplate = ''
    form.password = ''
    form.startNumber = 1
    form.count = 10
  }
  resultData.value = null
  phase.value = 'form'
}

onMounted(() => {
  fetchCurrentUser()
})
</script>

<style scoped>
.form-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}
.form-header {
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--border-color);
}
.form-header h3 {
  margin: 0;
  font-size: var(--font-size-lg);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
}
.form-hint {
  font-size: var(--font-size-sm);
  color: var(--text-muted);
  margin-top: 4px;
}
.preview-section {
  padding: 0 var(--spacing-lg) var(--spacing-lg);
}
.preview-section h4 {
  margin: 0 0 8px;
  color: var(--text-primary);
}
.preview-more {
  text-align: center;
  padding: 8px;
  color: var(--text-muted);
  font-size: var(--font-size-sm);
}
.result-section {
  padding: var(--spacing-lg);
}
.result-summary {
  display: flex;
  gap: 8px;
  margin: 12px 0;
}
.failed-details {
  margin: 16px 0;
}
.failed-details h4 {
  margin: 0 0 8px;
  color: var(--text-primary);
}
.result-actions {
  margin-top: 16px;
  display: flex;
  gap: 8px;
}
</style>
