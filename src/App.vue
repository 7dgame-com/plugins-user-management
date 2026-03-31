<template>
  <!-- 公开页面（如注册页）不需要 token -->
  <router-view v-if="isPublicRoute" />
  <template v-else>
    <router-view v-if="hasToken" />

    <!-- 握手状态模态窗（半透明遮罩） -->
    <Transition name="handshake-fade">
      <div v-if="showHandshake" class="handshake-overlay">
        <div class="handshake-card">
          <!-- 非 iframe 警告 -->
          <template v-if="!inIframe">
            <div class="handshake-icon warn">⚠️</div>
            <h3 class="handshake-title">未在 iframe 中运行</h3>
            <p class="handshake-desc">此插件需要嵌入主系统中使用，直接访问无法完成握手授权。</p>
            <div class="handshake-steps">
              <div class="step done">✅ 页面加载完成</div>
              <div class="step done">✅ 发送 PLUGIN_READY</div>
              <div class="step warn">⚠️ 等待 INIT — 无父窗口，永不到达</div>
            </div>
            <a href="/api-diagnostics" class="diag-link">前往 API 诊断页面 →</a>
          </template>

          <!-- iframe 内握手进度 -->
          <template v-else>
            <div class="handshake-icon spin">⚙️</div>
            <h3 class="handshake-title">正在与主系统握手…</h3>
            <p class="handshake-desc">插件需要从主系统获取授权 token 后才能显示内容。</p>
            <div class="handshake-steps">
              <div class="step done">✅ 页面加载完成</div>
              <div class="step done">✅ 发送 PLUGIN_READY</div>
              <div class="step" :class="isReady ? 'done' : 'waiting'">
                {{ isReady ? '✅' : '⏳' }} 等待主系统回复 INIT
              </div>
              <div class="step" :class="hasToken ? 'done' : 'waiting'">
                {{ hasToken ? '✅' : '⏳' }} 获取 JWT Token
              </div>
            </div>
          </template>
        </div>
      </div>
    </Transition>
  </template>

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
const hasToken = ref(!!getToken())
const inIframe = ref(false)

// 公开路由不需要 token 认证
const PUBLIC_ROUTES = ['/register', '/api-diagnostics']
const isPublicRoute = computed(() => PUBLIC_ROUTES.some((p) => route.path.startsWith(p)))

// 显示握手模态窗：非公开页面 且 (不在iframe 或 还没有token)
const showHandshake = computed(() => !isPublicRoute.value && (!inIframe.value || !hasToken.value))

const { isReady } = usePluginMessageBridge({
  onInit: (payload) => {
    if (payload.token) {
      setToken(payload.token)
      hasToken.value = true
    }
    setThemeFromConfig(payload.config)
  },
  onTokenUpdate: (newToken) => {
    if (newToken) {
      setToken(newToken)
      hasToken.value = true
    }
  },
  onDestroy: () => {
    removeToken()
    hasToken.value = false
  }
})

onMounted(() => {
  if (isPublicRoute.value) return
  inIframe.value = isInIframe()

  if (!inIframe.value) {
    // 非 iframe 环境：清除所有缓存 token，不允许复用
    removeToken()
    hasToken.value = false
  } else {
    // iframe 环境：可复用已有 token（避免重载时重新握手）
    hasToken.value = !!getToken()
  }
})
</script>

<style scoped>
.handshake-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.handshake-card {
  background: #fff;
  border-radius: 16px;
  padding: 36px 40px;
  min-width: 360px;
  max-width: 480px;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.25);
  text-align: center;
}

.handshake-icon {
  font-size: 40px;
  margin-bottom: 12px;
  line-height: 1;
}

.handshake-icon.spin {
  display: inline-block;
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.handshake-title {
  margin: 0 0 8px;
  font-size: 18px;
  color: #303133;
}

.handshake-desc {
  margin: 0 0 20px;
  font-size: 13px;
  color: #909399;
  line-height: 1.6;
}

.handshake-steps {
  text-align: left;
  background: #f5f7fa;
  border-radius: 8px;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 20px;
}

.step {
  font-size: 13px;
  color: #606266;
}

.step.done { color: #67c23a; }
.step.waiting { color: #909399; }
.step.warn { color: #e6a23c; }

.diag-link {
  font-size: 13px;
  color: #409eff;
  text-decoration: none;
}
.diag-link:hover { text-decoration: underline; }

/* 淡入淡出动画 */
.handshake-fade-enter-active,
.handshake-fade-leave-active {
  transition: opacity 0.4s ease;
}
.handshake-fade-enter-from,
.handshake-fade-leave-to {
  opacity: 0;
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

