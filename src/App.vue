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
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { isInIframe, listenForParentToken, getToken } from './utils/token'

const { t } = useI18n()

const route = useRoute()
const waiting = ref(false)
const hasToken = ref(!!getToken())

// 公开路由不需要 token 认证
const PUBLIC_ROUTES = ['/register']
const isPublicRoute = computed(() => PUBLIC_ROUTES.some((p) => route.path.startsWith(p)))

onMounted(() => {
  if (isPublicRoute.value) return

  if (isInIframe()) {
    if (getToken()) {
      hasToken.value = true
      return
    }
    waiting.value = true
    listenForParentToken((token) => {
      if (token) {
        waiting.value = false
        hasToken.value = true
      }
    })
  } else {
    // 独立运行模式：检查是否已有 token（开发调试用）
    hasToken.value = !!getToken()
  }
})
</script>

<style scoped>
.iframe-waiting {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  color: #999;
  font-size: 14px;
}
</style>
