<template>
  <div class="invitation-list">
    <!-- 工具栏 -->
    <div class="toolbar">
      <el-button type="primary" @click="showCreateDialog = true">
        <el-icon><Plus /></el-icon>
        {{ t('invitation.generate') }}
      </el-button>
    </div>

    <!-- 邀请列表表格 -->
    <div class="table-card">
      <el-table :data="invitations" v-loading="loading" stripe>
        <el-table-column prop="code" :label="t('invitation.code')" width="120" />
        <el-table-column :label="t('invitation.quota')" width="100">
          <template #default="{ row }">
            {{ row.remaining }}/{{ row.quota }}
          </template>
        </el-table-column>
        <el-table-column :label="t('invitation.expiresAt')" width="180">
          <template #default="{ row }">
            {{ formatTime(row.expiresAt) }}
          </template>
        </el-table-column>
        <el-table-column prop="creatorName" :label="t('invitation.creator')" width="120" />
        <el-table-column prop="note" :label="t('common.note')" min-width="140" show-overflow-tooltip />
        <el-table-column :label="t('common.status')" width="100">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="t('common.actions')" width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="copyLink(row.code)">{{ t('invitation.copyLink') }}</el-button>
            <el-button link type="primary" @click="viewRecords(row)">{{ t('invitation.viewRecords') }}</el-button>
            <el-popconfirm
              v-if="row.status === 'active'"
              :title="t('invitation.revokeConfirm')"
              @confirm="revokeInvitation(row.code)"
            >
              <template #reference>
                <el-button link type="danger">{{ t('common.revoke') }}</el-button>
              </template>
            </el-popconfirm>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 生成邀请 Dialog -->
    <el-dialog v-model="showCreateDialog" :title="t('invitation.generate')" width="460px" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="formRules" label-width="100px">
        <el-form-item :label="t('invitation.quotaLabel')" prop="quota">
          <el-input-number v-model="form.quota" :min="1" :step="1" style="width: 100%" />
        </el-form-item>
        <el-form-item :label="t('invitation.expiresIn')" prop="expiresIn">
          <el-select v-model="form.expiresIn" style="width: 100%">
            <el-option :label="t('invitation.expiresOptions.day1')" :value="86400" />
            <el-option :label="t('invitation.expiresOptions.day3')" :value="259200" />
            <el-option :label="t('invitation.expiresOptions.day7')" :value="604800" />
            <el-option :label="t('invitation.expiresOptions.day14')" :value="1209600" />
            <el-option :label="t('invitation.expiresOptions.day30')" :value="2592000" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('common.note')" prop="note">
          <el-input v-model="form.note" :placeholder="t('common.optional')" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="creating" @click="createInvitation">{{ t('common.create') }}</el-button>
      </template>
    </el-dialog>

    <!-- 注册记录 Dialog -->
    <el-dialog v-model="showRecordsDialog" :title="`${t('invitation.registrationRecords')} — ${recordsCode}`" width="560px">
      <el-table :data="records" v-loading="loadingRecords" stripe>
        <el-table-column prop="username" :label="t('user.username')" />
        <el-table-column prop="email" :label="t('user.email')" />
        <el-table-column :label="t('user.createdAt')" width="180">
          <template #default="{ row }">
            {{ formatTime(row.created_at) }}
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!loadingRecords && records.length === 0" :description="t('invitation.noRecords')" />
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { Plus } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import api from '../api'

const { t } = useI18n()

interface Invitation {
  code: string
  quota: number
  remaining: number
  expiresAt: number
  creatorName: string
  note: string
  status: 'active' | 'expired' | 'used_up'
}

interface Record {
  id: number
  username: string
  email: string
  created_at: number
}

const invitations = ref<Invitation[]>([])
const loading = ref(false)

// 生成邀请表单
const showCreateDialog = ref(false)
const creating = ref(false)
const formRef = ref<FormInstance>()
const form = ref({ quota: 5, expiresIn: 604800, note: '' })
const formRules: FormRules = {
  quota: [{ required: true, message: t('invitation.messages.quotaRequired'), trigger: 'blur' }],
}

// 注册记录
const showRecordsDialog = ref(false)
const loadingRecords = ref(false)
const recordsCode = ref('')
const records = ref<Record[]>([])

function statusTagType(status: string) {
  if (status === 'active') return 'success'
  if (status === 'expired') return 'info'
  return 'warning'
}

function statusLabel(status: string) {
  return t(`invitation.status.${status === 'active' ? 'active' : status === 'expired' ? 'expired' : 'usedUp'}`)
}

function formatTime(ts: number) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN')
}

async function fetchInvitations() {
  loading.value = true
  try {
    const { data } = await api.get('/invitations')
    invitations.value = data
  } catch (err: any) {
    ElMessage.error(err.response?.data?.error || err.response?.data?.message || t('invitation.messages.fetchFailed'))
  } finally {
    loading.value = false
  }
}

async function createInvitation() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  creating.value = true
  try {
    const { data } = await api.post('/create-invitation', {
      quota: form.value.quota,
      expiresIn: form.value.expiresIn,
      note: form.value.note,
    })
    ElMessage.success(t('invitation.messages.generateSuccess'))
    showCreateDialog.value = false
    // 自动复制链接
    await copyLink(data.data.code)
    fetchInvitations()
  } catch (err: any) {
    ElMessage.error(err.response?.data?.error || err.response?.data?.message || t('invitation.messages.generateFailed'))
  } finally {
    creating.value = false
  }
}

function resetForm() {
  form.value = { quota: 5, expiresIn: 604800, note: '' }
  formRef.value?.resetFields()
}

async function copyLink(code: string) {
  const url = `${window.location.origin}/register?invite=${code}`
  try {
    await navigator.clipboard.writeText(url)
    ElMessage.success(t('invitation.messages.copySuccess'))
  } catch {
    ElMessage.warning(t('invitation.messages.copyFailed') + url)
  }
}

async function revokeInvitation(code: string) {
  try {
    await api.post('/delete-invitation', { code })
    ElMessage.success(t('invitation.messages.revokeSuccess'))
    fetchInvitations()
  } catch (err: any) {
    ElMessage.error(err.response?.data?.error || err.response?.data?.message || t('invitation.messages.revokeFailed'))
  }
}

async function viewRecords(row: Invitation) {
  recordsCode.value = row.code
  records.value = []
  showRecordsDialog.value = true
  loadingRecords.value = true
  try {
    const { data } = await api.get('/invitation-records', { params: { code: row.code } })
    records.value = data
  } catch (err: any) {
    ElMessage.error(err.response?.data?.error || err.response?.data?.message || t('invitation.messages.recordsFailed'))
  } finally {
    loadingRecords.value = false
  }
}

onMounted(() => {
  fetchInvitations()
})
</script>

<style scoped>
.toolbar {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
  margin-bottom: var(--spacing-md);
}

.table-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}
</style>
