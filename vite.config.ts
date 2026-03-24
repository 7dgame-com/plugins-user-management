import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// 生成北京时间版本号，格式：2026.03.25-0200
function buildVersion(): string {
  const now = new Date()
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  const y = beijing.getUTCFullYear()
  const M = String(beijing.getUTCMonth() + 1).padStart(2, '0')
  const d = String(beijing.getUTCDate()).padStart(2, '0')
  const h = String(beijing.getUTCHours()).padStart(2, '0')
  const m = String(beijing.getUTCMinutes()).padStart(2, '0')
  return `${y}.${M}.${d}-${h}${m}`
}

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion()),
  },
  server: {
    port: 3003,
    proxy: {
      '/v1': {
        target: 'http://localhost:8081',
        changeOrigin: true
      }
    }
  },
  test: {
    environment: 'jsdom',
    globals: true
  }
})
