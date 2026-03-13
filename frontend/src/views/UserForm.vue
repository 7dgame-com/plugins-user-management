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
import api from '../api'
import { usePermissions } from '../composables/usePermissions'

const { t } = useI18n()

const ROLE_PRIORITY: Record<string, number> = { root: 4, admin: 3, manager: 2, user: 1 }

const { can } = usePermissions()

const route = useRoute()
const router = useRouter()
const formRef = ref<FormInstance>()
const loading = ref(false)

const isEdit = computed(() => !!route.params.id)

const currentUserRoles = ref<string[]>([])
const originalRole = ref('')

const form = reactive({
  username: '',
  email: '',
  password: '',
  status: 10,
  role: '',
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
    .filter(([, level]) => level <= myLevel)
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
    const { data } = await api.get('/users/me')
    currentUserRoles.value = data.roles || []
  } catch {
    // silent
  }
}

async function loadUser() {
  if (!isEdit.value) return
  try {
    const { data } = await api.get(`/users/${route.params.id}`)
    form.username = data.username
    form.email = data.email || ''
    form.status = data.status
    const highest = getHighestRole(data.roles)
    form.role = highest
    originalRole.value = highest
  } catch {
    ElMessage.error(t('user.messages.loadFailed'))
    router.back()
  }
}

async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return
  loading.value = true
  try {
    const payload: any = {
      username: form.username,
      email: form.email,
      status: form.status
    }
    if (form.password) payload.password = form.password

    if (isEdit.value) {
      await api.put(`/users/${route.params.id}`, payload)
      // If role changed, update separately
      if (canEditRole.value && form.role && form.role !== originalRole.value) {
        await api.put(`/users/${route.params.id}/role`, { role: form.role })
      }
      ElMessage.success(t('user.messages.updateSuccess'))
    } else {
      await api.post('/users', payload)
      ElMessage.success(t('user.messages.createSuccess'))
    }
    router.push('/users')
  } catch (err: any) {
    ElMessage.error(err.response?.data?.error || t('user.messages.operationFailed'))
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  fetchCurrentUser()
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
</style>
