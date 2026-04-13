<template>
  <div class="diagnostics">
    <div class="diag-header">
      <h2>API 诊断面板</h2>
      <el-button type="primary" :loading="runningAll" @click="runAll">全部测试</el-button>
    </div>

    <!-- 环境信息 -->
    <div class="section">
      <h3>环境信息</h3>
      <div class="info-grid">
        <div class="info-item">
          <span class="label">当前页面地址</span>
          <code>{{ envInfo.location }}</code>
        </div>
        <div class="info-item">
          <span class="label">Origin</span>
          <code>{{ envInfo.origin }}</code>
        </div>
        <div class="info-item">
          <span class="label">userApi baseURL</span>
          <code>{{ envInfo.userApiBase }}</code>
        </div>
        <div class="info-item">
          <span class="label">pluginApi baseURL</span>
          <code>{{ envInfo.pluginApiBase }}</code>
        </div>
        <div class="info-item">
          <span class="label">mainApi baseURL</span>
          <code>{{ envInfo.mainApiBase }}</code>
        </div>
        <div class="info-item">
          <span class="label">实际请求 userApi 完整地址</span>
          <code>{{ envInfo.origin }}{{ envInfo.userApiBase }}</code>
        </div>
        <div class="info-item">
          <span class="label">实际请求 pluginApi 完整地址</span>
          <code>{{ envInfo.origin }}{{ envInfo.pluginApiBase }}</code>
        </div>
        <div class="info-item">
          <span class="label">实际请求 mainApi 完整地址</span>
          <code>{{ envInfo.origin }}{{ envInfo.mainApiBase }}</code>
        </div>
        <div class="info-item">
          <span class="label">Token 状态</span>
          <code :class="envInfo.hasToken ? 'ok' : 'warn'">{{ envInfo.hasToken ? '已设置' : '未设置' }}</code>
        </div>
        <div class="info-item">
          <span class="label">是否在 iframe 中</span>
          <code>{{ envInfo.isIframe ? '是' : '否' }}</code>
        </div>
        <div class="info-item">
          <span class="label">Nginx 上游配置</span>
          <code :class="envInfo.upstreams === '加载中...' ? '' : envInfo.upstreams.startsWith('http') ? 'ok' : 'warn'">{{ envInfo.upstreams }}</code>
        </div>
        <div class="info-item">
          <span class="label">容器 hostname</span>
          <code>{{ envInfo.hostname || '-' }}</code>
        </div>
        <div class="info-item">
          <span class="label">容器启动时间</span>
          <code>{{ envInfo.serverBuildTime || '-' }}</code>
        </div>
      </div>
    </div>

    <!-- 反向代理检测 -->
    <div class="section">
      <h3>反向代理连通性检测</h3>
      <p class="hint">直接用 fetch 探测各 Nginx proxy_pass location，检测代理是否正确配置并能到达后端</p>
      <el-button type="primary" :loading="runningProxy" @click="runAllProxy" style="margin-bottom: 12px">全部检测</el-button>
      <el-table :data="proxyTests" stripe border>
        <el-table-column prop="name" label="代理路径" width="220" />
        <el-table-column label="请求 URL" min-width="300">
          <template #default="{ row }">
            <code class="url">{{ row.url }}</code>
          </template>
        </el-table-column>
        <el-table-column label="预期后端" width="240">
          <template #default="{ row }">
            <code class="url">{{ row.expectedBackend }}</code>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="140">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'pending'" type="info" size="small">待检测</el-tag>
            <el-tag v-else-if="row.status === 'loading'" type="warning" size="small">
              <el-icon class="is-loading"><Loading /></el-icon> 检测中
            </el-tag>
            <el-tag v-else-if="row.status === 'success'" type="success" size="small">
              {{ row.httpStatus }} 可达
            </el-tag>
            <el-tag v-else-if="row.status === 'proxy-error'" type="danger" size="small">
              {{ row.httpStatus }} 代理异常
            </el-tag>
            <el-tag v-else type="danger" size="small">
              {{ row.httpStatus || '不可达' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="诊断结果" min-width="380">
          <template #default="{ row }">
            <div v-if="row.status !== 'pending' && row.status !== 'loading'" class="resp-detail">
              <div class="diag-verdict" :class="row.verdict">
                {{ row.verdictIcon }} {{ row.verdictText }}
              </div>
              <div v-if="row.upstreamAddr" class="upstream-addr">
                📡 Nginx 实际连接的后端: <code>{{ row.upstreamAddr }}</code>
              </div>
              <div v-if="row.finalUrl && row.finalUrl !== row.url" class="redirect-warn">
                ⚠️ 重定向到: <code>{{ row.finalUrl }}</code>
              </div>
              <div v-if="row.responseHeaders" class="resp-headers">
                <span class="label">关键响应头:</span>
                <code>{{ row.responseHeaders }}</code>
              </div>
              <div class="resp-body">
                <span class="label">响应体 (前300字):</span>
                <pre>{{ row.responseBody }}</pre>
              </div>
              <div v-if="row.latency" class="latency">
                ⏱ 响应耗时: {{ row.latency }}ms
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="runProxyTest(row)">检测</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- API 测试结果 -->
    <div class="section">
      <h3>API 端点测试</h3>
      <el-table :data="tests" stripe border>
        <el-table-column prop="name" label="接口名称" width="200" />
        <el-table-column prop="method" label="方法" width="80" />
        <el-table-column label="请求地址" min-width="320">
          <template #default="{ row }">
            <code class="url">{{ row.fullUrl }}</code>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'pending'" type="info" size="small">待测试</el-tag>
            <el-tag v-else-if="row.status === 'loading'" type="warning" size="small">
              <el-icon class="is-loading"><Loading /></el-icon> 测试中
            </el-tag>
            <el-tag v-else-if="row.status === 'success'" type="success" size="small">
              {{ row.httpStatus }} OK
            </el-tag>
            <el-tag v-else type="danger" size="small">
              {{ row.httpStatus || '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="响应详情" min-width="360">
          <template #default="{ row }">
            <div v-if="row.status === 'success' || row.status === 'error'" class="resp-detail">
              <div v-if="row.redirectedUrl" class="redirect-warn">
                ⚠️ 重定向到: <code>{{ row.redirectedUrl }}</code>
              </div>
              <div class="resp-headers" v-if="row.responseHeaders">
                <span class="label">响应头:</span>
                <code>{{ row.responseHeaders }}</code>
              </div>
              <div class="resp-body">
                <span class="label">响应体:</span>
                <pre>{{ row.responseBody }}</pre>
              </div>
              <div v-if="row.errorMessage" class="error-msg">
                ❌ {{ row.errorMessage }}
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="runSingle(row)">测试</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 原始 fetch 测试 -->
    <div class="section">
      <h3>原始 Fetch 测试（绕过 Axios）</h3>
      <p class="hint">直接用 fetch 请求，排除 Axios 拦截器的影响</p>
      <el-table :data="rawTests" stripe border>
        <el-table-column prop="name" label="接口" width="200" />
        <el-table-column label="请求地址" min-width="320">
          <template #default="{ row }">
            <code class="url">{{ row.url }}</code>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'pending'" type="info" size="small">待测试</el-tag>
            <el-tag v-else-if="row.status === 'loading'" type="warning" size="small">测试中</el-tag>
            <el-tag v-else-if="row.status === 'success'" type="success" size="small">{{ row.httpStatus }}</el-tag>
            <el-tag v-else type="danger" size="small">{{ row.httpStatus || '失败' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="响应" min-width="360">
          <template #default="{ row }">
            <div v-if="row.responseBody">
              <div v-if="row.finalUrl && row.finalUrl !== row.url" class="redirect-warn">
                ⚠️ 最终地址: <code>{{ row.finalUrl }}</code>
              </div>
              <pre>{{ row.responseBody }}</pre>
            </div>
            <div v-if="row.errorMessage" class="error-msg">❌ {{ row.errorMessage }}</div>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="runRawTest(row)">测试</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-button style="margin-top: 12px" @click="runAllRaw" :loading="runningAllRaw">全部测试</el-button>
    </div>

    <!-- 自定义 URL 测试 -->
    <div class="section">
      <h3>自定义 URL 测试</h3>
      <div class="custom-test">
        <el-input v-model="customUrl" placeholder="输入完整或相对 URL，如 /v1/plugin-user/users?page=1" style="flex:1" />
        <el-select v-model="customMethod" style="width: 120px">
          <el-option label="GET" value="GET" />
          <el-option label="POST" value="POST" />
        </el-select>
        <el-button type="primary" @click="runCustom" :loading="customLoading">发送</el-button>
      </div>
      <div v-if="customResult" class="custom-result">
        <div>HTTP {{ customResult.status }} {{ customResult.statusText }}</div>
        <div v-if="customResult.finalUrl" class="redirect-warn">最终地址: <code>{{ customResult.finalUrl }}</code></div>
        <pre>{{ customResult.body }}</pre>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { Loading } from '@element-plus/icons-vue'
import api, { mainApi, pluginApi } from '../api'
import { getToken, isInIframe } from '../utils/token'

// ---- 环境信息 ----
const envInfo = reactive({
  location: window.location.href,
  origin: window.location.origin,
  userApiBase: api.defaults.baseURL || '/api/v1/plugin-user',
  pluginApiBase: pluginApi.defaults.baseURL || '/api-config/api/v1/plugin',
  mainApiBase: mainApi.defaults.baseURL || '/api/v1',
  hasToken: !!getToken(),
  isIframe: isInIframe(),
  upstreams: '加载中...',
  hostname: '',
  serverBuildTime: '',
})

// ---- API 端点定义 ----
interface TestItem {
  name: string
  method: string
  instance: 'userApi' | 'pluginApi' | 'mainApi'
  path: string
  params?: Record<string, any>
  fullUrl: string
  status: 'pending' | 'loading' | 'success' | 'error'
  httpStatus: number | string
  responseHeaders: string
  responseBody: string
  redirectedUrl: string
  errorMessage: string
}

function makeTest(name: string, method: string, instance: 'userApi' | 'pluginApi' | 'mainApi', path: string, params?: Record<string, any>): TestItem {
  const base = instance === 'userApi'
    ? (api.defaults.baseURL || '/api/v1/plugin-user')
    : instance === 'pluginApi'
      ? (pluginApi.defaults.baseURL || '/api-config/api/v1/plugin')
      : (mainApi.defaults.baseURL || '/api/v1')
  const qs = params ? '?' + new URLSearchParams(params as any).toString() : ''
  return {
    name, method, instance, path, params,
    fullUrl: `${window.location.origin}${base}${path}${qs}`,
    status: 'pending', httpStatus: '', responseHeaders: '', responseBody: '', redirectedUrl: '', errorMessage: '',
  }
}

const tests = ref<TestItem[]>([
  makeTest('获取用户列表', 'GET', 'userApi', '/users', { page: '1', pageSize: '20' }),
  makeTest('获取单个用户', 'GET', 'userApi', '/users', { id: '1' }),
  makeTest('验证 Token', 'GET', 'mainApi', '/plugin/verify-token'),
  makeTest('获取权限列表', 'GET', 'pluginApi', '/allowed-actions', { plugin_name: 'user-management' }),
  makeTest('获取邀请列表', 'GET', 'userApi', '/invitations'),
  makeTest('Health Check', 'GET', 'userApi', '/../health'),
])

async function runSingle(item: TestItem) {
  item.status = 'loading'
  item.responseBody = ''
  item.responseHeaders = ''
  item.redirectedUrl = ''
  item.errorMessage = ''
  item.httpStatus = ''

  const inst = item.instance === 'userApi' ? api : item.instance === 'pluginApi' ? pluginApi : mainApi
  try {
    const resp = await inst.request({
      method: item.method,
      url: item.path,
      params: item.params,
      validateStatus: () => true, // 不抛异常，拿到所有状态码
    })
    item.httpStatus = resp.status
    item.status = resp.status >= 200 && resp.status < 400 ? 'success' : 'error'
    item.responseHeaders = `content-type: ${resp.headers['content-type'] || 'N/A'}`
    item.responseBody = typeof resp.data === 'string' ? resp.data.slice(0, 500) : JSON.stringify(resp.data, null, 2).slice(0, 500)
    // Axios 不暴露重定向 URL，但可以检查 request.responseURL
    if (resp.request?.responseURL && !resp.request.responseURL.includes(window.location.host)) {
      item.redirectedUrl = resp.request.responseURL
    }
  } catch (err: any) {
    item.status = 'error'
    item.httpStatus = err.response?.status || 'N/A'
    item.errorMessage = err.message || String(err)
    if (err.response) {
      item.responseBody = typeof err.response.data === 'string' ? err.response.data.slice(0, 500) : JSON.stringify(err.response.data, null, 2).slice(0, 500)
    }
  }
}

const runningAll = ref(false)
async function runAll() {
  runningAll.value = true
  for (const t of tests.value) {
    await runSingle(t)
  }
  runningAll.value = false
}

// ---- 原始 Fetch 测试 ----
interface RawTestItem {
  name: string
  url: string
  status: 'pending' | 'loading' | 'success' | 'error'
  httpStatus: number | string
  responseBody: string
  finalUrl: string
  errorMessage: string
}

const rawTests = ref<RawTestItem[]>([
  { name: 'userApi /users', url: '/api/v1/plugin-user/users?page=1&pageSize=20', status: 'pending', httpStatus: '', responseBody: '', finalUrl: '', errorMessage: '' },
  { name: 'mainApi /plugin/verify-token', url: '/api/v1/plugin/verify-token', status: 'pending', httpStatus: '', responseBody: '', finalUrl: '', errorMessage: '' },
  { name: 'pluginApi /allowed-actions', url: '/api-config/api/v1/plugin/allowed-actions?plugin_name=user-management', status: 'pending', httpStatus: '', responseBody: '', finalUrl: '', errorMessage: '' },
  { name: 'Health Check', url: '/health', status: 'pending', httpStatus: '', responseBody: '', finalUrl: '', errorMessage: '' },
  { name: 'Debug Env', url: '/debug-env', status: 'pending', httpStatus: '', responseBody: '', finalUrl: '', errorMessage: '' },
])

async function runRawTest(item: RawTestItem) {
  item.status = 'loading'
  item.responseBody = ''
  item.finalUrl = ''
  item.errorMessage = ''
  try {
    const token = getToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const resp = await fetch(item.url, { headers })
    item.httpStatus = resp.status
    item.finalUrl = resp.url
    item.status = resp.ok ? 'success' : 'error'
    const text = await resp.text()
    item.responseBody = text.slice(0, 500)
  } catch (err: any) {
    item.status = 'error'
    item.errorMessage = err.message || String(err)
  }
}

const runningAllRaw = ref(false)
async function runAllRaw() {
  runningAllRaw.value = true
  for (const t of rawTests.value) {
    await runRawTest(t)
  }
  runningAllRaw.value = false
}

// ---- 自定义 URL 测试 ----
const customUrl = ref('')
const customMethod = ref('GET')
const customLoading = ref(false)
const customResult = ref<{ status: number; statusText: string; body: string; finalUrl: string } | null>(null)

async function runCustom() {
  if (!customUrl.value) return
  customLoading.value = true
  customResult.value = null
  try {
    const token = getToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const resp = await fetch(customUrl.value, { method: customMethod.value, headers })
    const text = await resp.text()
    customResult.value = {
      status: resp.status,
      statusText: resp.statusText,
      body: text.slice(0, 1000),
      finalUrl: resp.url !== customUrl.value ? resp.url : '',
    }
  } catch (err: any) {
    customResult.value = { status: 0, statusText: 'Error', body: err.message, finalUrl: '' }
  } finally {
    customLoading.value = false
  }
}

// ---- 反向代理连通性检测 ----
interface ProxyTestItem {
  name: string
  url: string
  expectedBackend: string
  status: 'pending' | 'loading' | 'success' | 'proxy-error' | 'error'
  httpStatus: number | string
  responseHeaders: string
  responseBody: string
  finalUrl: string
  upstreamAddr: string
  latency: number | null
  verdict: 'ok' | 'warn' | 'fail'
  verdictIcon: string
  verdictText: string
}

function makeProxyTest(name: string, url: string, expectedBackend: string): ProxyTestItem {
  return {
    name, url, expectedBackend,
    status: 'pending', httpStatus: '', responseHeaders: '', responseBody: '',
    finalUrl: '', upstreamAddr: '', latency: null, verdict: 'ok', verdictIcon: '', verdictText: '',
  }
}

const proxyTests = ref<ProxyTestItem[]>([
  makeProxyTest('/api/ → 后端 API', '/api/v1/plugin-user/users?page=1&pageSize=1', 'proxy_pass → API 后端'),
  makeProxyTest('/api-config/ → 配置接口', '/api-config/api/v1/plugin/allowed-actions?plugin_name=user-management', 'proxy_pass → system-admin 配置后端'),
  makeProxyTest('/health → 健康检查', '/health', '本地 Nginx 直接返回'),
  makeProxyTest('/debug-env → 调试环境', '/debug-env', '本地 Nginx 静态文件'),
  makeProxyTest('/ → 前端静态文件', '/', '本地 Nginx try_files'),
])

async function runProxyTest(item: ProxyTestItem) {
  item.status = 'loading'
  item.responseBody = ''
  item.responseHeaders = ''
  item.finalUrl = ''
  item.latency = null
  item.verdict = 'ok'
  item.verdictIcon = ''
  item.verdictText = ''

  const start = performance.now()
  try {
    const token = getToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`
    const resp = await fetch(item.url, { headers })
    item.latency = Math.round(performance.now() - start)
    item.httpStatus = resp.status
    // 只有真正发生了跨路径重定向才显示（排除 relative→absolute 的正常差异）
    const expectedAbsolute = new URL(item.url, window.location.href).href
    item.finalUrl = resp.url !== expectedAbsolute ? resp.url : ''

    // 收集关键响应头
    const headerNames = ['content-type', 'server', 'x-powered-by', 'x-request-id']
    const headerParts: string[] = []
    headerNames.forEach(h => {
      const v = resp.headers.get(h)
      if (v) headerParts.push(`${h}: ${v}`)
    })
    item.upstreamAddr = resp.headers.get('x-upstream-addr') || ''
    item.responseHeaders = headerParts.join(' | ')

    const text = await resp.text()
    item.responseBody = text.slice(0, 300)

    // 诊断判定
    if (resp.status === 502 || resp.status === 503 || resp.status === 504) {
      item.status = 'proxy-error'
      item.verdict = 'fail'
      item.verdictIcon = '❌'
      item.verdictText = `代理目标不可达 (${resp.status})，Nginx 无法连接后端服务`
    } else if (resp.status === 404 && text.includes('<html')) {
      // Nginx 返回了自己的 404 页面，说明没有匹配到 proxy location
      item.status = 'error'
      item.verdict = 'warn'
      item.verdictIcon = '⚠️'
      item.verdictText = 'Nginx 未匹配到代理规则，返回了静态 404'
    } else if (resp.ok) {
      item.status = 'success'
      item.verdict = 'ok'
      item.verdictIcon = '✅'
      item.verdictText = '代理正常，后端已响应'
    } else {
      // 4xx 来自后端（说明代理本身是通的）
      item.status = 'success'
      item.verdict = 'ok'
      item.verdictIcon = '✅'
      item.verdictText = `代理连通（后端返回 ${resp.status}，可能需要认证或参数）`
    }
  } catch (err: any) {
    item.latency = Math.round(performance.now() - start)
    item.status = 'error'
    item.httpStatus = 'N/A'
    item.verdict = 'fail'
    item.verdictIcon = '❌'
    item.verdictText = `请求失败: ${err.message}`
  }
}

const runningProxy = ref(false)
async function runAllProxy() {
  runningProxy.value = true
  for (const t of proxyTests.value) {
    await runProxyTest(t)
  }
  runningProxy.value = false
}

onMounted(async () => {
  envInfo.hasToken = !!getToken()
  try {
    const resp = await fetch('/debug-env')
    const text = await resp.text()
    if (!resp.ok) {
      envInfo.upstreams = `请求失败 (${resp.status})`
    } else {
      let data: Record<string, string> = {}
      try {
        data = JSON.parse(text)
      } catch {
        envInfo.upstreams = `/debug-env 返回了非 JSON 内容（可能未配置该 location）`
        return
      }
      const upstreams: string[] = []
      const apiUrls: string[] = []
      const configUrls: string[] = []
      let i = 1
      while (data[`APP_API_${i}_URL`]) {
        apiUrls.push(data[`APP_API_${i}_URL`])
        upstreams.push(`APP_API_${i}_URL=${data[`APP_API_${i}_URL`]}`)
        i++
      }
      i = 1
      while (data[`APP_CONFIG_${i}_URL`]) {
        configUrls.push(data[`APP_CONFIG_${i}_URL`])
        upstreams.push(`APP_CONFIG_${i}_URL=${data[`APP_CONFIG_${i}_URL`]}`)
        i++
      }
      // 兜底：无序号变量
      if (!apiUrls.length && data.API_UPSTREAM) {
        apiUrls.push(data.API_UPSTREAM)
        upstreams.push(`API_UPSTREAM=${data.API_UPSTREAM}`)
      }
      envInfo.upstreams = upstreams.length ? upstreams.join(' | ') : '未设置'
      envInfo.hostname = data.hostname || ''
      envInfo.serverBuildTime = data.buildTime || ''

      proxyTests.value.forEach(t => {
        const targetUrls = t.url.startsWith('/api-config/') ? configUrls : apiUrls
        const matcher = t.url.startsWith('/api-config/') ? /^\/api-config/ : /^\/api/
        if (!targetUrls.length || (!t.url.startsWith('/api/') && !t.url.startsWith('/api-config/'))) return
        const backendPath = t.url.replace(matcher, '')
        t.expectedBackend = targetUrls.length === 1
          ? targetUrls[0].replace(/\/$/, '') + backendPath
          : targetUrls.map((u, idx) => `[${idx + 1}] ${u.replace(/\/$/, '') + backendPath}`).join(' → ')
      })
    }
  } catch (e: any) {
    envInfo.upstreams = `请求异常: ${e.message}`
  }
})
</script>

<style scoped>
.diagnostics {
  padding: 20px;
  max-width: 1400px;
  margin: 0 auto;
}
.diag-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
}
.diag-header h2 { margin: 0; }
.section {
  margin-bottom: 32px;
}
.section h3 {
  margin: 0 0 12px;
  font-size: 16px;
  border-bottom: 1px solid var(--border-color, #eee);
  padding-bottom: 8px;
}
.info-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 24px;
}
.info-item {
  display: flex;
  gap: 8px;
  align-items: baseline;
  padding: 4px 0;
}
.info-item .label {
  color: #666;
  min-width: 200px;
  flex-shrink: 0;
}
.info-item code {
  background: #f5f5f5;
  padding: 2px 6px;
  border-radius: 3px;
  word-break: break-all;
  font-size: 13px;
}
code.ok { color: #67c23a; }
code.warn { color: #e6a23c; }
code.url { font-size: 12px; word-break: break-all; }
.resp-detail { font-size: 12px; }
.resp-detail pre {
  margin: 4px 0;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 150px;
  overflow: auto;
  background: #f9f9f9;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
}
.redirect-warn {
  color: #e6a23c;
  font-weight: 600;
  margin: 4px 0;
}
.error-msg { color: #f56c6c; margin: 4px 0; }
.hint { color: #999; font-size: 13px; margin: 0 0 8px; }
.custom-test {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.custom-result {
  background: #f9f9f9;
  padding: 12px;
  border-radius: 6px;
  font-size: 13px;
}
.custom-result pre {
  margin: 8px 0 0;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow: auto;
}
.diag-verdict {
  font-weight: 600;
  margin-bottom: 4px;
  font-size: 13px;
}
.diag-verdict.ok { color: #67c23a; }
.diag-verdict.warn { color: #e6a23c; }
.diag-verdict.fail { color: #f56c6c; }
.upstream-addr {
  margin: 4px 0;
  font-size: 13px;
  font-weight: 600;
  color: #409eff;
}
.upstream-addr code {
  background: #ecf5ff;
  padding: 2px 6px;
  border-radius: 3px;
}
.latency {
  color: #909399;
  font-size: 12px;
  margin-top: 4px;
}
</style>
