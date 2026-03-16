<template>
  <div class="register-page">
    <div class="register-card">
      <h2 class="register-title">{{ t('register.title') }}</h2>

      <!-- 邀请码验证中 -->
      <div v-if="checking" class="register-loading">
        <el-icon class="is-loading" :size="32"><Loading /></el-icon>
        <p>{{ t('common.loading') }}</p>
      </div>

      <!-- 邀请码无效 -->
      <div v-else-if="inviteError" class="register-error">
        <el-result icon="error" :sub-title="inviteError">
          <template #extra>
            <p class="register-hint">{{ t('register.messages.failed') }}</p>
          </template>
        </el-result>
      </div>

      <!-- 注册成功 -->
      <div v-else-if="registered" class="register-success">
        <el-result icon="success" :title="t('register.messages.success')" :sub-title="t('register.messages.success')" />
      </div>

      <!-- 注册表单 -->
      <el-form
        v-else
        ref="formRef"
        :model="form"
        :rules="formRules"
        label-position="top"
        class="register-form"
        @submit.prevent="handleSubmit"
      >
        <el-form-item :label="t('register.username')" prop="username">
          <el-input v-model="form.username" :placeholder="t('register.usernamePlaceholder')" />
        </el-form-item>

        <el-form-item :label="t('register.email')" prop="email">
          <el-input v-model="form.email" :placeholder="t('register.emailPlaceholder')">
            <template #append>
              <el-button :disabled="!isEmailValid || countdown > 0" :loading="sendingCode" @click="sendCode">
                {{ countdown > 0 ? `${countdown}s` : t('common.send') }}
              </el-button>
            </template>
          </el-input>
        </el-form-item>

        <el-form-item label="Verification Code" prop="verificationCode">
          <el-input v-model="form.verificationCode" placeholder="Enter verification code" />
        </el-form-item>

        <el-form-item :label="t('register.password')" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            :placeholder="t('register.passwordPlaceholder')"
            show-password
          />
        </el-form-item>

        <!-- 密码强度指示 -->
        <div v-if="form.password" class="password-rules">
          <div v-for="rule in passwordRules" :key="rule.label" class="rule-item" :class="{ pass: rule.pass }">
            <el-icon :size="14">
              <CircleCheckFilled v-if="rule.pass" />
              <CircleCloseFilled v-else />
            </el-icon>
            <span>{{ rule.label }}</span>
          </div>
        </div>

        <el-form-item :label="t('register.confirmPassword')" prop="confirmPassword">
          <el-input
            v-model="form.confirmPassword"
            type="password"
            :placeholder="t('register.confirmPasswordPlaceholder')"
            show-password
          />
        </el-form-item>

        <el-form-item>
          <el-button
            type="primary"
            native-type="submit"
            :loading="submitting"
            style="width: 100%"
          >
            {{ t('register.submitButton') }}
          </el-button>
        </el-form-item>
      </el-form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useRoute } from 'vue-router'
import type { FormInstance, FormRules } from 'element-plus'
import { ElMessage } from 'element-plus'
import { Loading, CircleCheckFilled, CircleCloseFilled } from '@element-plus/icons-vue'
import { useI18n } from 'vue-i18n'
import api from '../api'

const { t } = useI18n()
const route = useRoute()
const formRef = ref<FormInstance>()

// State
const checking = ref(true)
const inviteError = ref('')
const registered = ref(false)
const submitting = ref(false)
const sendingCode = ref(false)
const countdown = ref(0)
let countdownTimer: ReturnType<typeof setInterval> | null = null

const inviteCode = computed(() => (route.query.invite as string) || '')

const form = ref({
  username: '',
  email: '',
  verificationCode: '',
  password: '',
  confirmPassword: '',
})

// Email validation for enabling send-code button
const isEmailValid = computed(() => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.value.email))

// Password strength rules (real-time)
const passwordRules = computed(() => {
  const p = form.value.password
  return [
    { label: '至少 12 个字符', pass: p.length >= 12 },
    { label: '包含大写字母', pass: /[A-Z]/.test(p) },
    { label: '包含小写字母', pass: /[a-z]/.test(p) },
    { label: '包含数字', pass: /[0-9]/.test(p) },
    { label: '包含特殊字符', pass: /[^A-Za-z0-9]/.test(p) },
  ]
})

const isPasswordStrong = computed(() => passwordRules.value.every((r) => r.pass))

// Form validation rules
const validatePassword = (_rule: any, value: string, callback: (err?: Error) => void) => {
  if (!value) return callback(new Error(t('register.messages.passwordRequired')))
  if (!isPasswordStrong.value) return callback(new Error(t('register.messages.passwordMinLength')))
  // Trigger re-validation of confirmPassword if it has value
  if (form.value.confirmPassword) {
    formRef.value?.validateField('confirmPassword')
  }
  callback()
}

const validateConfirmPassword = (_rule: any, value: string, callback: (err?: Error) => void) => {
  if (!value) return callback(new Error(t('register.messages.confirmPasswordRequired')))
  if (value !== form.value.password) return callback(new Error(t('register.messages.passwordMismatch')))
  callback()
}

const formRules: FormRules = {
  username: [{ required: true, message: t('register.messages.usernameRequired'), trigger: 'blur' }],
  email: [
    { required: true, message: t('register.messages.emailRequired'), trigger: 'blur' },
    { type: 'email', message: t('register.messages.emailInvalid'), trigger: 'blur' },
  ],
  verificationCode: [{ required: true, message: t('register.messages.inviteCodeRequired'), trigger: 'blur' }],
  password: [{ required: true, validator: validatePassword, trigger: 'blur' }],
  confirmPassword: [{ required: true, validator: validateConfirmPassword, trigger: 'blur' }],
}

// Check invitation code on mount
async function checkInviteCode() {
  if (!inviteCode.value) {
    inviteError.value = t('register.messages.inviteCodeRequired')
    checking.value = false
    return
  }
  try {
    const { data } = await api.get('/check-invitation', { params: { code: inviteCode.value } })
    if (!data.valid) {
      inviteError.value = data.reason || t('register.messages.failed')
    }
  } catch (err: any) {
    inviteError.value = err.response?.data?.error || err.response?.data?.message || t('register.messages.failed')
  } finally {
    checking.value = false
  }
}

// Send email verification code
async function sendCode() {
  if (!isEmailValid.value || countdown.value > 0) return
  sendingCode.value = true
  try {
    await api.post('/register-send-code', {
      inviteCode: inviteCode.value,
      email: form.value.email,
    })
    ElMessage.success(t('register.messages.success'))
    startCountdown()
  } catch (err: any) {
    ElMessage.error(err.response?.data?.error || err.response?.data?.message || t('register.messages.failed'))
  } finally {
    sendingCode.value = false
  }
}

function startCountdown() {
  countdown.value = 60
  countdownTimer = setInterval(() => {
    countdown.value--
    if (countdown.value <= 0) {
      clearInterval(countdownTimer!)
      countdownTimer = null
    }
  }, 1000)
}

// Submit registration
async function handleSubmit() {
  const valid = await formRef.value?.validate().catch(() => false)
  if (!valid) return

  submitting.value = true
  try {
    await api.post('/register', {
      inviteCode: inviteCode.value,
      username: form.value.username,
      password: form.value.password,
      email: form.value.email,
      verificationCode: form.value.verificationCode,
    })
    registered.value = true
  } catch (err: any) {
    ElMessage.error(err.response?.data?.error || err.response?.data?.message || t('register.messages.failed'))
  } finally {
    submitting.value = false
  }
}

onMounted(() => {
  checkInviteCode()
})

onUnmounted(() => {
  if (countdownTimer) clearInterval(countdownTimer)
})
</script>

<style scoped>
.register-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-page);
  padding: var(--spacing-lg);
}

.register-card {
  width: 100%;
  max-width: 460px;
  background: var(--bg-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
  padding: var(--spacing-xl);
}

.register-title {
  text-align: center;
  font-size: var(--font-size-xl);
  font-weight: var(--font-weight-bold);
  color: var(--text-primary);
  margin-bottom: var(--spacing-lg);
}

.register-loading {
  text-align: center;
  padding: var(--spacing-xl) 0;
  color: var(--text-muted);
}

.register-loading p {
  margin-top: var(--spacing-md);
}

.register-error {
  padding: var(--spacing-md) 0;
}

.register-hint {
  color: var(--text-muted);
  font-size: var(--font-size-sm);
}

.register-success {
  padding: var(--spacing-md) 0;
}

.register-form {
  margin-top: var(--spacing-sm);
}

.password-rules {
  margin: -8px 0 var(--spacing-md);
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs) var(--spacing-md);
}

.rule-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  color: var(--danger-color);
  transition: color var(--transition-fast);
}

.rule-item.pass {
  color: var(--success-color);
}
</style>
