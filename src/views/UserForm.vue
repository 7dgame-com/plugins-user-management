<template>
  <div class="user-form">
    <div class="form-card">
      <div class="form-header">
        <h3>{{ isEdit ? t('user.editUser') : t('user.addUser') }}</h3>
      </div>
      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        style="max-width: 500px; padding: var(--spacing-lg)"
        @submit.prevent="handleSubmit"
      >
        <el-form-item :label="t('user.username')" prop="username">
          <el-input v-model="form.username" :placeholder="t('user.usernamePlaceholder')" />
        </el-form-item>
        <el-form-item :label="t('user.email')" prop="email">
          <el-input v-model="form.email" :placeholder="t('user.emailPlaceholder')" />
        </el-form-item>
        <el-form-item :label="isEdit ? t('user.passwordEmptyHint') : t('user.password')" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            :placeholder="isEdit ? t('user.passwordHint') : t('user.passwordPlaceholder')"
            show-password
          />
        </el-form-item>
        <el-form-item :label="t('common.status')" prop="status">
          <el-select v-model="form.status" style="width: 100%">
            <el-option :label="t('user.status.active')" :value="10" />
            <el-option :label="t('user.status.disabled')" :value="0" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="canEditRole" :label="t('user.role')" prop="role">
          <el-select v-model="form.role" style="width: 100%">
            <el-option
              v-for="opt in availableRoleOptions"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('organization.userOrganizations')">
          <el-select
            v-model="form.organization_ids"
            multiple
            filterable
            clearable
            style="width: 100%"
            :loading="organizationsLoading"
            :disabled="organizationsLoading || !!organizationsError"
            data-testid="organization-select"
          >
            <el-option
              v-for="organization in organizations"
              :key="organization.id"
              :label="organization.title"
              :value="organization.id"
            />
          </el-select>
          <div v-if="organizationsError" class="form-hint form-hint-error">
            {{ organizationsError }}
          </div>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" native-type="submit">
            {{ isEdit ? t('user.saveChanges') : t('user.createUser') }}
          </el-button>
          <el-button @click="$router.back()">{{ t('common.cancel') }}</el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, type FormInstance } from 'element-plus'
import { useI18n } from 'vue-i18n'
import api, { pluginApi, listOrganizations, type OrganizationItem } from '../api'
import { usePermissions } from '../composables/usePermissions'

const { t } = useI18n()

const ROLE_PRIORITY: Record<string, number> = { root: 4, admin: 3, manager: 2, user: 1 }

const { can } = usePermissions()

const route = useRoute()
const router = useRouter()
const formRef = ref<FormInstance>()
const loading = ref(false)
const organizations = ref<OrganizationItem[]>([])
const organizationsLoading = ref(false)
const organizationsError = ref('')

const isEdit = computed(() => !!route.params.id)

const currentUserRoles = ref<string[]>([])
const originalRole = ref('')

const form = reactive({
  username: '',
  email: '',
  password: '',
  status: 10,
  role: '',
  organization_ids: [] as number[],
})

function getRoleLevel(roles?: string[]): number {
  if (!roles || roles.length === 0) return 0
  return Math.max(...roles.map(r => ROLE_PRIORITY[r] || 0))
}

function getHighestRole(roles?: string[]): string {
  if (!roles || roles.length === 0) return 'user'
  return roles.reduce((highest, r) => (ROLE_PRIORITY[r] || 0) > (ROLE_PRIORITY[highest] || 0) ? r : highest, roles[0])
}

const availableRoleOptions = computed(() => {
  const myLevel = getRoleLevel(currentUserRoles.value)
  return Object.entries(ROLE_PRIORITY)
    .filter(([role, level]) => level <= myLevel && role !== 'root')
    .sort(([, a], [, b]) => b - a)
    .map(([role]) => ({ value: role, label: t(`user.roles.${role}`) }))
})

const canEditRole = computed(() => {
  if (!can('change-role')) return false
  if (!isEdit.value) return false
  const myLevel = getRoleLevel(currentUserRoles.value)
  const targetLevel = ROLE_PRIORITY[originalRole.value] || 0
  return targetLevel <= myLevel
})

const rules = computed(() => ({
  username: [{ required: true, message: t('user.messages.usernameRequired'), trigger: 'blur' }],
  password: isEdit.value
    ? []
    : [{ required: true, message: t('user.messages.passwordRequired'), trigger: 'blur' }]
}))

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

async function loadUser() {
  if (!isEdit.value) return
  try {
    const { data } = await api.get('/users', { params: { id: route.params.id } })
    const user = data.data
    // 根用户不允许编辑
    if (Array.isArray(user.roles) && user.roles.includes('root')) {
      ElMessage.error(t('user.messages.rootUserProtected', '根用户不允许修改'))
      router.replace('/users')
      return
    }
    form.username = user.username
    form.email = user.email || ''
    form.status = user.status
    const highest = getHighestRole(user.roles)
    form.role = highest
    originalRole.value = highest
    form.organization_ids = Array.isArray(user.organizations)
      ? user.organizations.map((organization: { id: number }) => organization.id)
      : []
  } catch {
    ElMessage.error(t('user.messages.loadFailed'))
    router.back()
  }
}

async function loadOrganizations() {
  organizationsLoading.value = true
  organizationsError.value = ''
  try {
    const { data } = await listOrganizations()
    if (data.code === 0 && Array.isArray(data.data)) {
      organizations.value = data.data
      return
    }

    organizations.value = []
    organizationsError.value = t('organization.messages.selectorLoadFailed')
    ElMessage.error(organizationsError.value)
  } catch {
    organizations.value = []
    organizationsError.value = t('organization.messages.selectorLoadFailed')
    ElMessage.error(organizationsError.value)
  } finally {
    organizationsLoading.value = false
  }
}

async function handleSubmit() {
  if (formRef.value) {
    const valid = await formRef.value.validate().catch(() => false)
    if (!valid) return
  }
  loading.value = true
  try {
    const payload: any = {
      username: form.username,
      email: form.email,
      status: form.status
    }
    if (form.password) payload.password = form.password
    if (!isEdit.value || !organizationsError.value) {
      payload.organization_ids = [...form.organization_ids]
    }

    if (isEdit.value) {
      await api.post('/update-user', { id: route.params.id, ...payload })
      // If role changed, update separately
      if (canEditRole.value && form.role && form.role !== originalRole.value) {
        if (form.role === 'root') {
          ElMessage.error(t('user.messages.rootRoleNotAllowed', '不允许将用户设置为 root 角色'))
          return
        }
        await api.post('/change-role', { id: route.params.id, role: form.role })
      }
      ElMessage.success(t('user.messages.updateSuccess'))
    } else {
      await api.post('/create-user', payload)
      ElMessage.success(t('user.messages.createSuccess'))
    }
    router.push('/users')
  } catch (err: any) {
    ElMessage.error(err.response?.data?.error || err.response?.data?.message || t('user.messages.operationFailed'))
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchCurrentUser()
  loadOrganizations()
  loadUser()
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
  margin-top: var(--spacing-xs);
  font-size: var(--font-size-sm);
}

.form-hint-error {
  color: var(--danger-color, #f56c6c);
}
</style>
