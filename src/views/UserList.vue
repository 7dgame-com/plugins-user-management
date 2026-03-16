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
    </div>

    <!-- 用户表格 -->
    <div class="table-card">
      <el-table :data="users" v-loading="loading" stripe @sort-change="handleSortChange">
        <el-table-column prop="id" label="ID" width="80" sortable="custom" />
        <el-table-column prop="username" :label="t('user.username')" min-width="140" sortable="custom" />
        <el-table-column prop="nickname" :label="t('user.nickname')" min-width="140" sortable="custom" />
        <el-table-column prop="email" :label="t('user.email')" min-width="200" sortable="custom" />
        <el-table-column prop="roles" :label="t('user.role')" width="160" sortable="custom">
          <template #default="{ row }">
            <el-select
              v-if="can('change-role') && canChangeRole(row)"
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
        <el-table-column v-if="can('update-user') || can('delete-user')" :label="t('common.actions')" width="160" fixed="right">
          <template #default="{ row }">
            <el-button v-if="can('update-user')" link type="primary" @click="$router.push(`/users/${row.id}/edit`)">
              {{ t('common.edit') }}
            </el-button>
            <el-popconfirm v-if="can('delete-user')" :title="t('user.deleteConfirm')" @confirm="handleDelete(row.id)">
              <template #reference>
                <el-button link type="danger">{{ t('common.delete') }}</el-button>
              </template>
            </el-popconfirm>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { Search, Plus } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useI18n } from 'vue-i18n'
import api, { pluginApi } from '../api'
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

const availableRoleOptions = computed(() => {
  const myLevel = getRoleLevel(currentUserRoles.value)
  return Object.entries(ROLE_PRIORITY)
    .filter(([, level]) => level <= myLevel)
    .sort(([, a], [, b]) => b - a)
    .map(([role]) => ({ value: role, label: t(`user.roles.${role}`) }))
})

async function fetchCurrentUser() {
  try {
    const { data } = await pluginApi.get('/verify-token', {
      params: { plugin_name: 'user-management' }
    })
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
    const { data } = await api.get('/users', { params })
    users.value = data.data
    total.value = data.pagination.total
  } catch (err: any) {
    ElMessage.error(err.response?.data?.error || err.response?.data?.message || t('user.messages.fetchFailed'))
  } finally {
    loading.value = false
  }
}

async function handleRoleChange(row: any, newRole: string) {
  try {
    await api.post('/change-role', { id: row.id, role: newRole })
    ElMessage.success(t('user.messages.roleChangeSuccess'))
    fetchUsers()
  } catch (err: any) {
    ElMessage.error(err.response?.data?.error || err.response?.data?.message || t('user.messages.roleChangeFailed'))
  }
}

async function handleDelete(id: number) {
  try {
    await api.post('/delete-user', { id })
    ElMessage.success(t('user.messages.deleteSuccess'))
    fetchUsers()
  } catch (err: any) {
    ElMessage.error(err.response?.data?.error || err.response?.data?.message || t('user.messages.deleteFailed'))
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
</style>
