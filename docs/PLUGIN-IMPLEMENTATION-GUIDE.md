# 插件实现参考文档（基于 user-management 插件）

> 本文档从 user-management 插件的实际实现中提炼，涵盖插件系统的所有可复用模式：认证流程、路由守卫、反向代理、Docker 部署、权限控制、主题/国际化集成等。新插件开发时可直接参照。

---

## 1. 整体架构

```
┌──────────────────────────────────────────────────────────────┐
│  主系统 web/ (Vue 3)                                         │
│                                                              │
│  SidebarLeft.vue ──► /plugins/:pluginId                      │
│       │                    │                                 │
│       │              PluginLayout.vue                        │
│       │                    │                                 │
│       │              ┌─────▼──────┐   postMessage            │
│  PluginSystem.ts ◄──►│  <iframe>  │◄──────────────►  插件App │
│  ├─ PluginRegistry   │  sandbox   │   INIT / READY           │
│  ├─ PluginLoader     └────────────┘   TOKEN_UPDATE           │
│  ├─ MessageBus                        DESTROY                │
│  ├─ AuthService                                              │
│  └─ ConfigService                                            │
│                                                              │
│  Pinia Store: plugin-system.ts                               │
│  ├─ 初始化 PluginSystem                                      │
│  ├─ 管理插件状态 Map<pluginId, PluginInfo>                    │
│  └─ 异步加载各插件权限 (allowed-actions API)                   │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│  插件 (独立 Web 应用，任意框架)                                │
│                                                              │
│  nginx 反向代理                                               │
│  ├─ /api/ → 主后端 API（${API_UPSTREAM}）                     │
│  └─ /     → SPA 静态文件                                      │
│                                                              │
│  前端                                                         │
│  ├─ token.ts                  — Token 存取 + 刷新请求         │
│  ├─ usePluginMessageBridge.ts — iframe ↔ 主系统通信桥         │
│  ├─ useTheme.ts               — 主题同步                      │
│  ├─ usePermissions.ts         — 权限查询                      │
│  ├─ api/index.ts              — axios 双实例 + 拦截器          │
│  └─ router                    — 路由守卫                      │
└──────────────────────────────────────────────────────────────┘
```

## 2. 插件注册（plugins.json）

插件通过 `web/public/config/plugins.json` 静态注册。ConfigService 加载后还会尝试与 domain 信息合并（按 id 覆盖）。

```json
{
  "version": "1.0.0",
  "menuGroups": [
    {
      "id": "tools",
      "name": "实用工具",
      "nameI18n": { "zh-CN": "实用工具", "en-US": "Utilities" },
      "icon": "Tools",
      "order": 2
    }
  ],
  "plugins": [
    {
      "id": "user-management",
      "name": "用户管理",
      "nameI18n": { "zh-CN": "用户管理", "en-US": "User Management" },
      "description": "用户增删改查管理工具",
      "url": "https://user-manager.plugins.xrugc.com/",
      "icon": "User",
      "group": "tools",
      "enabled": true,
      "order": 2,
      "allowedOrigin": "https://user-manager.plugins.xrugc.com",
      "version": "1.0.0"
    }
  ]
}
```

### PluginManifest 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 插件唯一标识，用于路由 `/plugins/{id}` 和权限查询 |
| `name` | string | 默认显示名称 |
| `nameI18n` | Record<string, string> | 多语言名称（可选） |
| `url` | string | 插件入口 URL（生产环境部署地址） |
| `icon` | string | Element Plus 图标名称 |
| `group` | string | 所属菜单分组 id |
| `enabled` | boolean | 是否启用 |
| `order` | number | 排序权重（越小越靠前） |
| `allowedOrigin` | string | 允许的 postMessage origin（安全校验） |
| `version` | string | 插件版本 |
| `sandbox` | string? | iframe sandbox 属性，默认 `allow-scripts allow-same-origin` |
| `extraConfig` | Record? | 额外配置，透传给插件 INIT 消息 |

### 可见性规则

插件在侧边栏中的显示受权限控制：只有当 `allowed-actions` API 返回非空 actions 时才显示。这意味着即使 `enabled: true`，没有权限的用户也看不到该插件。

## 3. 认证流程（Token 传递）

### 3.1 时序图

```
主系统                          iframe (插件)                    主后端
  │                                │                              │
  │  1. 创建 iframe, src=插件URL    │                              │
  │  ──────────────────────────►   │                              │
  │                                │  2. iframe onload             │
  │  3. postMessage: INIT          │                              │
  │     { token, config }          │                              │
  │  ──────────────────────────►   │                              │
  │                                │  4. 存储 token 到 localStorage │
  │                                │                              │
  │  5. postMessage: PLUGIN_READY  │                              │
  │  ◄──────────────────────────   │                              │
  │                                │                              │
  │                                │  6. API 请求 (带 Bearer token) │
  │                                │  ────────────────────────►   │
  │                                │                              │
  │  7. Token 刷新时               │                              │
  │  postMessage: TOKEN_UPDATE     │                              │
  │  ──────────────────────────►   │                              │
  │                                │  8. 更新 localStorage         │
```

### 3.2 主系统侧（PluginLayout.vue）

PluginLayout 在 iframe `@load` 事件中发送 INIT 消息：

```typescript
function handleIframeLoad() {
  const tokenInfo = Token.getToken()
  const jwt = tokenInfo?.accessToken || tokenInfo?.token || ''

  iframeRef.value.contentWindow.postMessage({
    type: 'INIT',
    id: `init-${manifest.id}-${Date.now()}`,
    payload: {
      token: jwt,
      config: manifest.extraConfig ?? {}
    }
  }, manifest.allowedOrigin)
}
```

iframe 的 `src` 会附带 `lang` 和 `theme` 参数：
```
{pluginUrl}?lang=zh-CN&theme=modern-blue
```

iframe sandbox 属性：
```
allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox
```

### 3.3 插件侧（token.ts + usePluginMessageBridge）

`token.ts` 只负责 token 的存取和刷新请求，不再直接监听消息。消息监听统一由 `usePluginMessageBridge` composable 处理（见第 15 节）。

```typescript
const TOKEN_KEY = 'user-mgmt-token'  // 每个插件用独立的 key

export function isInIframe(): boolean {
  try { return window.self !== window.top } catch { return true }
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function removeToken() {
  localStorage.removeItem(TOKEN_KEY)
}
```

`App.vue` 通过 `usePluginMessageBridge` 的回调处理 token 存储：

```typescript
const { isReady } = usePluginMessageBridge({
  onInit: (payload) => {
    if (payload.token) {
      setToken(payload.token)
      hasToken.value = true
    }
    setThemeFromConfig(payload.config)  // 从 INIT config 初始化主题
  },
  onTokenUpdate: (newToken) => {
    if (newToken) setToken(newToken)
  },
  onDestroy: () => {
    removeToken()
    hasToken.value = false
  }
})
```

### 3.4 Token 刷新机制

当插件收到 401 响应时，可通过 postMessage 请求主框架刷新 token：

```typescript
export function requestParentTokenRefresh(): Promise<{ accessToken: string } | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000)

    window.addEventListener('message', (event) => {
      if (event.data?.type === 'TOKEN_UPDATE' && event.data?.payload?.token) {
        clearTimeout(timer)
        resolve({ accessToken: event.data.payload.token })
      }
    })

    window.parent.postMessage({ type: 'TOKEN_REFRESH_REQUEST' }, '*')
  })
}
```

## 4. 路由守卫

### 4.1 App.vue 入口守卫

App.vue 作为第一道防线，区分公开路由和需要认证的路由。认证逻辑通过 `usePluginMessageBridge` 统一处理，不再手动调用 `listenForParentToken`：

```vue
<template>
  <!-- 公开页面（如注册页）不需要 token -->
  <router-view v-if="isPublicRoute" />
  <div v-else-if="waiting">等待主系统授权...</div>
  <div v-else-if="!hasToken">无法打开界面，请从主系统登录后重试</div>
  <router-view v-else />
</template>

<script setup>
const PUBLIC_ROUTES = ['/register', '/api-diagnostics']
const isPublicRoute = computed(() =>
  PUBLIC_ROUTES.some(p => route.path.startsWith(p))
)

const { isReady } = usePluginMessageBridge({
  onInit: (payload) => {
    if (payload.token) {
      setToken(payload.token)
      hasToken.value = true
      waiting.value = false
    }
    setThemeFromConfig(payload.config)
  },
  onTokenUpdate: (newToken) => { if (newToken) setToken(newToken) },
  onDestroy: () => { removeToken(); hasToken.value = false }
})

onMounted(() => {
  if (isPublicRoute.value) return
  if (isInIframe()) {
    if (getToken()) { hasToken.value = true; return }
    waiting.value = true
    // usePluginMessageBridge 自动发送 PLUGIN_READY，等待 INIT 回调
  } else {
    hasToken.value = !!getToken()
  }
})
</script>
```

### 4.2 Router beforeEach 守卫

实际实现中，路由守卫只做公开路由放行，不强制跳转 NotAllowed 页面——非 iframe 访问时由 App.vue 显示提示信息，路由正常放行：

```typescript
router.beforeEach((to) => {
  if (to.meta.public) return true
  // 非 iframe 访问：App.vue 会显示"请从主系统打开此插件"，路由正常放行
  return true
})
```

### 4.3 公开路由声明

在路由定义中通过 `meta.public: true` 标记公开路由：

```typescript
{
  path: '/register',
  name: 'Register',
  component: () => import('../views/Register.vue'),
  meta: { title: '邀请注册', public: true }
}
```

## 5. 反向代理（nginx）

### 5.1 nginx.conf.template

插件使用 nginx 模板文件，通过环境变量 `API_UPSTREAM` 动态配置后端地址。所有 `/api/` 请求统一代理到主后端：

```nginx
server {
    listen 80;
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    # Docker 内置 DNS，使用变量的 proxy_pass 必须指定 resolver
    resolver 127.0.0.11 valid=30s ipv6=off;

    add_header 'Access-Control-Allow-Origin' '*' always;
    add_header 'Access-Control-Allow-Methods' 'GET, POST, PUT, DELETE, OPTIONS' always;
    add_header 'Access-Control-Allow-Headers' 'DNT,User-Agent,X-Requested-With,If-Modified-Since,Cache-Control,Content-Type,Range,Authorization' always;

    # 所有业务 API 统一代理到主后端
    location /api/ {
        set $api_upstream ${API_UPSTREAM};
        proxy_pass $api_upstream/;
        proxy_set_header Host $proxy_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_ssl_server_name on;
    }

    # 健康检查
    location /health {
        access_log off;
        default_type application/json;
        alias /usr/share/nginx/html/health.json;
    }

    # SPA 路由回退
    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 5.2 代理路径规则

| 前端请求路径 | 代理目标 | 说明 |
|-------------|---------|------|
| `/api/*` | `${API_UPSTREAM}/*` | 所有 API 请求（含 `/api/v1/plugin-user/` 和 `/api/v1/plugin/`） |
| `/*` | 本地静态文件 | SPA 页面 |

> 注意：user-management 使用单一 `/api/` 前缀统一代理，与文档中描述的分路径代理模式不同。新插件可根据需要选择单一前缀或分路径代理。

### 5.3 开发环境代理（vite.config.ts）

```typescript
export default defineConfig({
  server: {
    port: 3003,
    proxy: {
      '/api': {
        target: 'http://localhost:8081',  // 主后端 API
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  }
})
```

## 6. Docker 部署

### 6.1 Dockerfile（多阶段构建）

```dockerfile
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY docker-entrypoint.sh /docker-entrypoint-custom.sh
RUN chmod +x /docker-entrypoint-custom.sh

# 构建时生成健康检查 JSON
RUN echo "{\"status\":\"ok\",\"buildTime\":\"$(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')\"}" \
    > /usr/share/nginx/html/health.json

ENV API_UPSTREAM=http://localhost
ENV NGINX_ENVSUBST_FILTER=API_UPSTREAM
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint-custom.sh"]
```

### 6.2 docker-entrypoint.sh

```bash
#!/bin/sh
# 生成调试信息
cat > /usr/share/nginx/html/debug-env.json <<EOF
{
  "API_UPSTREAM": "${API_UPSTREAM}",
  "buildTime": "$(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')",
  "hostname": "$(hostname)"
}
EOF

# 调用 nginx 官方 entrypoint（处理 templates 中的环境变量替换）
exec /docker-entrypoint.sh nginx -g 'daemon off;'
```

### 6.3 关键环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `API_UPSTREAM` | 主后端 API 地址 | `http://xrugc-api:80`（Docker 内部）或 `https://api.xrugc.com`（生产） |
| `NGINX_ENVSUBST_FILTER` | nginx 模板变量过滤 | `API_UPSTREAM` |

### 6.4 docker-compose 服务定义示例

```yaml
xrugc-user-management:
  build: ../plugins/user-management
  container_name: xrugc-user-management
  ports:
    - "3003:80"
  environment:
    - API_UPSTREAM=http://xrugc-api:80
  networks:
    - xrugc-network
  depends_on:
    - xrugc-api
```

## 7. 权限系统

### 7.1 后端权限表

权限配置存储在 `plugin_permission_config` 表中，由管理员在主后端管理后台维护。

### 7.2 通用 API（所有插件共用）

> 完整参数和响应格式参见权威来源：[`web/docs/plugin-auth-api-reference.md`](../../../web/docs/plugin-auth-api-reference.md)

| 端点 | 说明 |
|------|------|
| `GET /v1/plugin/verify-token` | 验证 JWT，返回用户信息和角色 |
| `GET /v1/plugin/check-permission?plugin_name=xxx&action=yyy` | 检查单个操作权限 |
| `GET /v1/plugin/allowed-actions?plugin_name=xxx` | 批量获取允许的操作列表 |

### 7.3 前端权限 composable（usePermissions）

```typescript
import { ref, readonly } from 'vue'
import { pluginApi } from '../api'

// 定义插件支持的所有操作
interface Permissions {
  'list-users': boolean
  'create-user': boolean
  // ...
}

export function usePermissions() {
  const permissions = ref<Permissions>({ /* 全部默认 false */ })

  async function fetchPermissions() {
    const { data } = await pluginApi.get('/allowed-actions', {
      params: { plugin_name: 'user-management' }  // 替换为你的插件名
    })
    if (data.code === 0) {
      const actions = data.data?.actions || []
      // 支持通配符 '*'
      const hasWildcard = actions.includes('*')
      Object.keys(permissions.value).forEach(a => {
        permissions.value[a] = hasWildcard || actions.includes(a)
      })
    }
  }

  function can(action: keyof Permissions): boolean {
    return permissions.value[action]
  }

  function hasAny(): boolean {
    return Object.values(permissions.value).some(Boolean)
  }

  return { permissions: readonly(permissions), fetchPermissions, can, hasAny }
}
```

### 7.4 后端权限检查（Controller 层）

```php
// 合并认证 + 权限检查的通用方法
protected function resolveUserWithPermission($action): array
{
    $result = $this->resolveUser();
    if (isset($result['error'])) return $result;

    $allowed = PluginPermissionConfig::checkPermission(
        $result['roles'],
        self::PLUGIN_NAME,  // 'user-management'
        $action
    );
    if (!$allowed) {
        Yii::$app->response->statusCode = 403;
        return ['error' => ['code' => 2003, 'message' => '没有权限执行此操作']];
    }
    return $result;
}
```

## 8. API 层（axios 实例）

### 8.1 双实例模式

```typescript
// 插件专属业务 API（指向主后端 /api/v1/plugin-user）
const userApi = axios.create({
  baseURL: '/api/v1/plugin-user',
  timeout: 10000
})

// 通用插件 API（verify-token、allowed-actions 等，指向主后端 /api/v1/plugin）
const pluginApi = axios.create({
  baseURL: '/api/v1/plugin',
  timeout: 10000
})
```

### 8.2 请求拦截器（注入 Token）

```typescript
instance.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})
```

### 8.3 响应拦截器（401 自动刷新）

```typescript
instance.interceptors.response.use(
  (response) => response,
  async (error) => {
    if (error.response?.status === 401 && isInIframe()) {
      // 通过 postMessage 请求主框架刷新 token
      const result = await requestParentTokenRefresh()
      if (result?.accessToken) {
        setToken(result.accessToken)
        error.config.headers.Authorization = `Bearer ${result.accessToken}`
        return instance(error.config)  // 重试原请求
      }
    }
    return Promise.reject(error)
  }
)
```

## 9. 主题集成（useTheme）

### 9.1 初始化

从 URL 参数读取初始主题（主系统在 iframe src 中附带 `?theme=xxx`）：

```typescript
const DARK_THEMES = ['deep-space', 'cyber-tech']

function initFromUrl() {
  const params = new URLSearchParams(window.location.search)
  const theme = params.get('theme')
  if (theme) {
    themeName.value = theme
    isDark.value = DARK_THEMES.includes(theme)
  }
}
```

### 9.2 运行时同步

监听主框架的 `THEME_CHANGE` 消息：

```typescript
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return
  if (event.data?.type === 'THEME_CHANGE') {
    themeName.value = event.data.payload.theme
    isDark.value = DARK_THEMES.includes(event.data.payload.theme)
  }
})
```

### 9.3 DOM 同步

```typescript
watchEffect(() => {
  document.documentElement.setAttribute('data-theme', isDark.value ? 'dark' : 'light')
  document.documentElement.classList.toggle('dark', isDark.value)
})
```

## 10. 国际化（i18n）

从 URL 参数 `?lang=zh-CN` 读取语言：

```typescript
function getLanguageFromURL(): string {
  const params = new URLSearchParams(window.location.search)
  const lang = params.get('lang')
  if (lang && ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'th-TH'].includes(lang)) {
    return lang
  }
  return 'zh-CN'
}

const i18n = createI18n({
  legacy: false,
  locale: getLanguageFromURL(),
  fallbackLocale: 'zh-CN',
  messages: { 'zh-CN': zhCN, 'en-US': enUS, /* ... */ }
})
```

## 11. 主系统侧边栏集成

插件菜单在 `SidebarLeft.vue` 中自动渲染，无需手动添加。流程：

1. `pluginStore.init()` → 加载 plugins.json → 注册插件
2. `fetchAllPluginPermissions()` → 对每个插件调用 `allowed-actions` API
3. 只有返回非空 actions 的插件才会出现在侧边栏
4. 点击菜单项 → 路由到 `/plugins/{pluginId}` → PluginLayout 加载 iframe

路由定义：
```typescript
{
  path: '/plugins/:pluginId?',
  component: () => import('@/plugin-system/views/PluginLayout.vue'),
  name: 'Plugins'
}
```

## 12. 消息协议完整参考

| 消息类型 | 方向 | payload | 说明 |
|---------|------|---------|------|
| `INIT` | 主→插件 | `{ token, config }` | 初始化，携带 JWT 和配置 |
| `PLUGIN_READY` | 插件→主 | 无 | 插件就绪通知 |
| `TOKEN_UPDATE` | 主→插件 | `{ token }` | Token 刷新 |
| `TOKEN_REFRESH_REQUEST` | 插件→主 | 无 | 请求刷新 Token |
| `THEME_CHANGE` | 主→插件 | `{ theme }` | 主题切换 |
| `DESTROY` | 主→插件 | 无 | 即将销毁，做清理 |
| `REQUEST` | 插件→主 | 自定义 | 通用请求 |
| `RESPONSE` | 主→插件 | 自定义 | 通用响应 |
| `EVENT` | 双向 | 自定义 | 事件通知 |

## 13. 新插件开发 Checklist

- [ ] 创建 `plugins/{plugin-name}/` 目录
- [ ] 前端：Vue 3 + Element Plus + vue-router + vue-i18n + pinia
- [ ] 实现 `src/utils/token.ts`（复制 user-management 的即可）
- [ ] 实现 `src/composables/usePluginMessageBridge.ts`（复制即可，见第 15 节）
- [ ] 实现 `src/composables/useTheme.ts`（复制即可）
- [ ] 实现 `src/composables/usePermissions.ts`（修改 Permissions 接口和 plugin_name）
- [ ] 实现 `src/api/index.ts`（双实例 + 拦截器，修改 baseURL）
- [ ] 实现 `src/i18n/index.ts`（从 URL 读取语言）
- [ ] App.vue 入口守卫（使用 usePluginMessageBridge 处理 INIT/TOKEN_UPDATE/DESTROY）
- [ ] Router beforeEach 守卫（公开路由放行）
- [ ] 创建 `nginx.conf.template`（配置 `/api/` 代理路径）
- [ ] 创建 `Dockerfile`（多阶段构建）
- [ ] 创建 `docker-entrypoint.sh`
- [ ] 在 `web/public/config/plugins.json` 中注册插件
- [ ] 在主后端 `plugin_permission_config` 表中配置权限
- [ ] 在 `driver/docker-compose.yml` 中添加服务定义
- [ ] 后端 Controller 继承 `\yii\rest\Controller`，使用 JWT 认证 + `resolveUserWithPermission()`

## 14. 目录结构参考

```
plugins/user-management/
├── Dockerfile
├── docker-entrypoint.sh
├── nginx.conf.template
├── package.json
├── vite.config.ts
├── src/
│   ├── main.ts                    # 入口
│   ├── App.vue                    # 根组件（入口守卫，使用 usePluginMessageBridge）
│   ├── api/
│   │   └── index.ts               # axios 双实例 + 拦截器
│   ├── composables/
│   │   ├── usePermissions.ts      # 权限查询
│   │   ├── usePluginMessageBridge.ts  # iframe ↔ 主系统通信桥（见第 15 节）
│   │   └── useTheme.ts            # 主题同步
│   ├── i18n/
│   │   ├── index.ts               # i18n 初始化
│   │   └── locales/               # 语言包（zh-CN、zh-TW、en-US、ja-JP、th-TH）
│   ├── layout/
│   │   └── AppLayout.vue          # 插件内部布局（抽屉式侧边栏）
│   ├── router/
│   │   └── index.ts               # 路由定义（/register、/api-diagnostics 为公开路由）
│   ├── styles/
│   │   └── index.css              # 主题 CSS 变量
│   ├── utils/
│   │   └── token.ts               # Token 存取 + requestParentTokenRefresh
│   └── views/                     # 页面组件
│       ├── UserList.vue           # 用户列表
│       ├── UserForm.vue           # 创建/编辑用户
│       ├── BatchCreateForm.vue    # 批量创建用户
│       ├── InvitationList.vue     # 邀请码管理
│       ├── Register.vue           # 邀请注册（公开路由）
│       ├── ApiDiagnostics.vue     # API 诊断（公开路由）
│       └── NotAllowed.vue         # 无权限提示
└── docs/
```

## 15. usePluginMessageBridge：与 plugin-template-sample 的关系

### 15.1 两个文件的现状

`usePluginMessageBridge.ts` 以**文件复制**方式存在于两个仓库：

| 文件 | 路径 |
|------|------|
| 原始实现 | `plugins/user-management/src/composables/usePluginMessageBridge.ts` |
| 模板副本 | `plugins/plugin-template-sample/frontend/src/composables/usePluginMessageBridge.ts` |

目前两个文件**内容完全相同**，均实现了统一的 iframe ↔ 主系统通信桥：

- 管理 `isReady`、`token`、`config` 响应式状态
- 内置处理 `INIT`、`TOKEN_UPDATE`、`DESTROY` 协议消息
- 提供 `postMessage`、`postResponse`、`onMessage` 三个对外接口
- `onMounted` 时自动注册监听并发送 `PLUGIN_READY`
- `onBeforeUnmount` 时自动清理监听器

### 15.2 差异原因

**user-management 是原始实现**。在插件系统早期，通信逻辑分散在 `token.ts`（`listenForParentToken`）和各组件中。随着插件数量增加，将通信逻辑统一封装为 `usePluginMessageBridge` composable，并在 `App.vue` 中通过回调处理 token 存储和主题初始化。

**plugin-template-sample 是从中提炼的通用版本**。模板创建时直接复制了 user-management 中已稳定的实现，作为新插件的起点。两者保持同步，没有功能差异。

### 15.3 未来计划

考虑将 `usePluginMessageBridge` 发布为独立 npm 包，供所有插件通过依赖安装，避免多处维护同一份代码。在此之前，修改通信协议时需同步更新两个仓库中的文件。

> 参见 `.kiro/steering/project-config.md`：「`usePluginMessageBridge` 以文件复制方式存在于 `plugin-template-sample` 和 `user-management`，未来考虑 npm 包化」
