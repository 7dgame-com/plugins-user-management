<template>
  <div class="user-list">
    <!-- 搜索栏 -->
    <div class="toolbar">
      <el-input
        v-model="search"
        :placeholder="t('user.searchPlaceholder')"
        clearable
        style="width: 260px"
        @clear="fetchUsers"
        @keyup.enter="fetchUsers"
      >
        <template #prefix>
          <el-icon><Search /></el-icon>
        </template>
      </el-input>
      <el-button v-if="can('create-user')" type="primary" @click="$router.push('/users/create')">
        <el-icon><Plus /></el-icon>
        {{ t('user.addUser') }}
      </el-button>
      <el-button v-if="can('create-user')" @click="$router.push('/users/batch-create')">
        {{ t('user.batch.title') }}
      </el-button>
    </div>

    <!-- 用户表格 -->
    <div class="table-card">
      <el-table :data="users" v-loading="loading" stripe @sort-change="handleSortChange">
        <el-table-column prop="id" label="ID" width="80" sortable="custom" />
        <el-table-column prop="username" :label="t('user.username')" min-width="140" sortable="custom" />
        <el-table-column prop="nickname" :label="t('user.nickname')" min-width="140" sortable="custom" />
        <el-table-column prop="email" :label="t('user.email')" min-width="200" sortable="custom" />
        <el-table-column prop="organizations" :label="t('organization.userOrganizations')" min-width="220">
          <template #default="{ row }">
            <div
              v-if="Array.isArray(row.organizations) && row.organizations.length > 0"
              class="organization-list"
            >
              <span
                v-for="organization in row.organizations"
                :key="organization.id"
                class="organization-chip"
              >
                {{ organization.title }}
              </span>
            </div>
            <span v-else class="organization-empty">-</span>
          </template>
        </el-table-column>
        <el-table-column prop="roles" :label="t('user.role')" width="160" sortable="custom">
          <template #default="{ row }">
            <el-select
              v-if="can('change-role') && canChangeRole(row) && !isRootUser(row)"
              :model-value="getHighestRole(row.roles)"
              size="small"
              @change="(val: string) => handleRoleChange(row, val)"
            >
              <el-option
                v-for="opt in availableRoleOptions"
                :key="opt.value"
                :label="opt.label"
                :value="opt.value"
              />
            </el-select>
            <span v-else>{{ getRoleLabel(row.roles) }}</span>
          </template>
        </el-table-column>

        <el-table-column prop="created_at" :label="t('user.createdAt')" width="180" sortable="custom">
          <template #default="{ row }">
            {{ formatTime(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column v-if="can('list-users') || can('update-user') || can('delete-user')" :label="t('common.actions')" width="240" fixed="right">
          <template #default="{ row }">
            <el-button v-if="can('list-users')" link type="primary" @click="openLoginAudit(row)">
              <el-icon><Clock /></el-icon>
              {{ t('user.loginAudit.action') }}
            </el-button>
            <template v-if="isRootUser(row)">
              <el-tooltip content="根用户不可操作" placement="top">
                <span style="color: #c0c4cc; font-size: 13px; cursor: not-allowed">受保护</span>
              </el-tooltip>
            </template>
            <template v-else>
              <el-button v-if="can('update-user')" link type="primary" @click="$router.push(`/users/${row.id}/edit`)">
                {{ t('common.edit') }}
              </el-button>
              <el-popconfirm v-if="can('delete-user')" :title="t('user.deleteConfirm')" @confirm="handleDelete(row.id)">
                <template #reference>
                  <el-button link type="danger">{{ t('common.delete') }}</el-button>
                </template>
              </el-popconfirm>
            </template>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :total="total"
          :page-sizes="[10, 20, 50]"
          layout="total, sizes, prev, pager, next"
          @current-change="fetchUsers"
          @size-change="fetchUsers"
        />
      </div>
    </div>

    <el-dialog
      v-model="loginAuditDialogVisible"
      :title="loginAuditDialogTitle"
      width="min(720px, 92vw)"
      class="login-audit-dialog"
    >
      <div v-loading="loginAuditLoading" class="login-audit-content">
        <template v-if="!loginAuditLoading">
          <div v-if="loginAuditStats" class="audit-summary">
            <div class="audit-metric">
              <span>{{ t('user.loginAudit.loginCount') }}</span>
              <strong>{{ loginAuditStats.loginCount }}</strong>
            </div>
            <div class="audit-metric">
              <span>{{ t('user.loginAudit.failedLoginCount') }}</span>
              <strong>{{ loginAuditStats.failedLoginCount }}</strong>
            </div>
            <div class="audit-metric wide">
              <span>{{ t('user.loginAudit.lastLoginAt') }}</span>
              <strong>{{ formatDateTime(loginAuditStats.lastLoginAt) }}</strong>
            </div>
            <div class="audit-metric wide">
              <span>{{ t('user.loginAudit.lastFailedLoginAt') }}</span>
              <strong>{{ formatDateTime(loginAuditStats.lastFailedLoginAt) }}</strong>
            </div>
          </div>

          <el-empty v-else :description="t('user.loginAudit.noRecords')" />

          <el-table
            v-if="loginAuditEvents.length > 0"
            :data="loginAuditEvents"
            size="small"
            border
            class="audit-events-table"
          >
            <el-table-column prop="occurredAt" :label="t('user.loginAudit.occurredAt')" min-width="180">
              <template #default="{ row }">
                {{ formatDateTime(row.occurredAt) }}
              </template>
            </el-table-column>
            <el-table-column prop="eventType" :label="t('user.loginAudit.eventType')" min-width="110" />
            <el-table-column prop="success" :label="t('user.loginAudit.result')" width="110">
              <template #default="{ row }">
                <el-tag size="small" :type="row.success ? 'success' : 'danger'">
                  {{ t(row.success ? 'user.loginAudit.success' : 'user.loginAudit.failed') }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="source" :label="t('user.loginAudit.source')" min-width="140" />
            <el-table-column prop="traceId" :label="t('user.loginAudit.traceId')" min-width="140">
              <template #default="{ row }">
                {{ row.traceId || '-' }}
              </template>
            </el-table-column>
          </el-table>
        </template>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Search, Plus, Clock } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import {
  changePluginUserRole,
  deletePluginUser,
  getPluginUserLoginAudit,
  getPluginUsers,
  verifyCurrentToken,
  type LoginAuditRecentEvent,
  type LoginAuditStats,
} from '../api'
import { usePermissions } from '../composables/usePermissions'

const { t } = useI18n()

const ROLE_PRIORITY: Record<string, number> = { root: 4, admin: 3, manager: 2, user: 1 }

const { can } = usePermissions()

const users = ref<any[]>([])
const loading = ref(false)
const search = ref('')
const statusFilter = ref<number | undefined>()
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const sortField = ref('')
const sortOrder = ref('')
const currentUserRoles = ref<string[]>([])
const loginAuditDialogVisible = ref(false)
const loginAuditLoading = ref(false)
const selectedAuditUser = ref<any | null>(null)
const loginAuditStats = ref<LoginAuditStats | null>(null)
const loginAuditEvents = ref<LoginAuditRecentEvent[]>([])

const loginAuditDialogTitle = computed(() => {
  const username = selectedAuditUser.value?.username
  return username ? `${t('user.loginAudit.title')} - ${username}` : t('user.loginAudit.title')
})

function getRoleLevel(roles?: string[]): number {
  if (!roles || roles.length === 0) return 0
  return Math.max(...roles.map(r => ROLE_PRIORITY[r] || 0))
}

function getHighestRole(roles?: string[]): string {
  if (!roles || roles.length === 0) return 'user'
  return roles.reduce((highest, r) => (ROLE_PRIORITY[r] || 0) > (ROLE_PRIORITY[highest] || 0) ? r : highest, roles[0])
}

function getRoleLabel(roles?: string[]): string {
  const role = getHighestRole(roles)
  return t(`user.roles.${role}`)
}

function canChangeRole(row: any): boolean {
  const myLevel = getRoleLevel(currentUserRoles.value)
  const targetLevel = getRoleLevel(row.roles)
  return targetLevel <= myLevel
}

function isRootUser(row: any): boolean {
  return Array.isArray(row.roles) && row.roles.includes('root')
}

const availableRoleOptions = computed(() => {
  const myLevel = getRoleLevel(currentUserRoles.value)
  return Object.entries(ROLE_PRIORITY)
    .filter(([role, level]) => level <= myLevel && role !== 'root')
    .sort(([, a], [, b]) => b - a)
    .map(([role]) => ({ value: role, label: t(`user.roles.${role}`) }))
})

async function fetchCurrentUser() {
  try {
    const { data } = await verifyCurrentToken()
    currentUserRoles.value = data.data?.roles || []
  } catch {
    // silent
  }
}

async function fetchUsers() {
  loading.value = true
  try {
    const params: any = { page: page.value, pageSize: pageSize.value }
    if (search.value) params.search = search.value
    if (statusFilter.value !== undefined && statusFilter.value !== null) params.status = statusFilter.value
    if (sortField.value) {
      params.sort = sortField.value
      params.order = sortOrder.value
    }
    const { data } = await getPluginUsers(params)
    users.value = data.data
    total.value = data.pagination.total
  } catch (err: any) {
    ElMessage.error(err.response?.data?.error || err.response?.data?.message || t('user.messages.fetchFailed'))
  } finally {
    loading.value = false
  }
}

async function handleRoleChange(row: any, newRole: string) {
  if (newRole === 'root') {
    ElMessage.error(t('user.messages.rootRoleNotAllowed', '不允许将用户设置为 root 角色'))
    return
  }
  try {
    await changePluginUserRole(row.id, newRole)
    ElMessage.success(t('user.messages.roleChangeSuccess'))
    fetchUsers()
  } catch (err: any) {
    ElMessage.error(err.response?.data?.error || err.response?.data?.message || t('user.messages.roleChangeFailed'))
  }
}

async function handleDelete(id: number) {
  try {
    await deletePluginUser(id)
    ElMessage.success(t('user.messages.deleteSuccess'))
    fetchUsers()
  } catch (err: any) {
    ElMessage.error(err.response?.data?.error || err.response?.data?.message || t('user.messages.deleteFailed'))
  }
}

async function openLoginAudit(row: any) {
  selectedAuditUser.value = row
  loginAuditDialogVisible.value = true
  loginAuditLoading.value = true
  loginAuditStats.value = null
  loginAuditEvents.value = []

  try {
    const { data } = await getPluginUserLoginAudit(row.id)
    loginAuditStats.value = data.data?.stats ?? null
    loginAuditEvents.value = data.data?.recentEvents ?? []
  } catch (err: any) {
    ElMessage.error(err.response?.data?.error || err.response?.data?.message || t('user.loginAudit.messages.fetchFailed'))
  } finally {
    loginAuditLoading.value = false
  }
}

function handleSortChange({ prop, order }: { prop: string; order: string | null }) {
  sortField.value = order ? prop : ''
  sortOrder.value = order === 'ascending' ? 'asc' : order === 'descending' ? 'desc' : ''
  fetchUsers()
}

function formatTime(ts: number) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN')
}

function formatDateTime(value?: string | null) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN')
}

onMounted(() => {
  fetchCurrentUser()
  fetchUsers()
})
</script>

<style scoped>
.toolbar {
  display: flex;
  gap: var(--spacing-sm);
  align-items: center;
  margin-bottom: var(--spacing-md);
  flex-wrap: wrap;
}

.table-card {
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
  overflow: hidden;
}

.pagination {
  padding: var(--spacing-md);
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid var(--border-color);
}

.login-audit-content {
  min-height: 180px;
}

.audit-summary {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-md);
}

.audit-metric {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--bg-page);
  min-width: 0;
}

.audit-metric.wide {
  grid-column: span 1;
}

.audit-metric span {
  display: block;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  margin-bottom: 4px;
}

.audit-metric strong {
  color: var(--text-primary);
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-bold);
  overflow-wrap: anywhere;
}

.audit-events-table {
  margin-top: var(--spacing-sm);
}

@media (max-width: 640px) {
  .audit-summary {
    grid-template-columns: 1fr;
  }
}

.organization-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.organization-chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-subtle, #f4f7fb);
  color: var(--text-secondary, #606266);
  font-size: 12px;
  line-height: 18px;
}

.organization-empty {
  color: var(--text-muted, #909399);
}
</style>
