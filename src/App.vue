<template>
  <!-- 公开页面（如注册页）不需要 token -->
  <router-view v-if="isPublicRoute" />
  <div v-else-if="waiting" class="iframe-waiting">
    <p>{{ t('layout.waitingAuth') }}</p>
  </div>
  <div v-else-if="!hasToken" class="iframe-waiting">
    <p>{{ t('layout.requireMainSystem') }}</p>
  </div>
  <router-view v-else />

  <!-- 全局版本号 -->
  <span class="global-version">{{ appVersion }}</span>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { isInIframe, getToken, setToken, removeToken } from './utils/token'
import { usePluginMessageBridge } from './composables/usePluginMessageBridge'
import { setThemeFromConfig } from './composables/useTheme'

declare const __APP_VERSION__: string
const appVersion = `v${__APP_VERSION__}`

const { t } = useI18n()

const route = useRoute()
const waiting = ref(false)
const hasToken = ref(!!getToken())

// 公开路由不需要 token 认证
const PUBLIC_ROUTES = ['/register', '/api-diagnostics']
const isPublicRoute = computed(() => PUBLIC_ROUTES.some((p) => route.path.startsWith(p)))

const { isReady } = usePluginMessageBridge({
  onInit: (payload) => {
    if (payload.token) {
      setToken(payload.token)
      hasToken.value = true
      waiting.value = false
    }
    // 从 INIT config 初始化主题
    setThemeFromConfig(payload.config)
  },
  onTokenUpdate: (newToken) => {
    if (newToken) {
      setToken(newToken)
    }
  },
  onDestroy: () => {
    removeToken()
    hasToken.value = false
  }
})

onMounted(() => {
  if (isPublicRoute.value) return

  if (isInIframe()) {
    if (getToken()) {
      hasToken.value = true
      return
    }
    waiting.value = true
    // usePluginMessageBridge handles PLUGIN_READY → INIT automatically
  } else {
    // 独立运行模式：检查是否已有 token（开发调试用）
    hasToken.value = !!getToken()
  }
})
</script>

<style scoped>
.iframe-waiting {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: #999;
  font-size: 14px;
}
.global-version {
  position: fixed;
  right: 12px;
  bottom: 8px;
  font-size: 11px;
  color: #ccc;
  pointer-events: none;
  z-index: 9999;
  user-select: none;
}
</style>
