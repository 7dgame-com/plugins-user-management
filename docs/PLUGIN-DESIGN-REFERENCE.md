# 插件设计参考文档（基于 user-management 插件）

> 本文档从 user-management 插件的实际代码中提炼，作为其他插件设计的参考模板。
> 涵盖：认证握手、路由守卫、API 层、权限系统、主题/国际化、nginx 反向代理、Docker 部署。

---

## 1. 整体架构

```
浏览器
  └── 主系统 web/ (Vue 3)
        └── PluginLayout.vue
              └── <iframe src="插件URL?lang=zh-CN&theme=modern-blue">
                    └── 插件 SPA (Vue 3 + nginx)
                          ├── /api/* → nginx → 主后端 API
                          └── /*     → 静态文件
```

插件是一个独立的 Web 应用，通过 iframe 嵌入主系统。无独立后端，所有业务 API 通过 nginx 反向代理到主后端。

---

## 2. 目录结构

```
plugins/user-management/
├── Dockerfile
├── docker-entrypoint.sh        # 动态生成 nginx failover 配置
├── nginx.conf.template         # nginx 模板（含 __API_LOCATIONS__ 占位符）
├── vite.config.ts
├── package.json
└── src/
    ├── main.ts
    ├── App.vue                 # 入口守卫 + 握手状态 UI
    ├── api/
    │   └── index.ts            # axios 双实例 + 拦截器 + 两段式 token 刷新
    ├── composables/
    │   ├── usePluginMessageBridge.ts  # iframe ↔ 主系统通信桥
    │   ├── usePermissions.ts          # 权限查询（单例 + 懒加载）
    │   └── useTheme.ts                # 主题同步（URL 参数 + THEME_CHANGE 消息）
    ├── i18n/
    │   ├── index.ts            # 从 URL ?lang= 读取语言
    │   └── locales/            # zh-CN、zh-TW、en-US、ja-JP、th-TH
    ├── layout/
    │   └── AppLayout.vue       # 插件内部布局（抽屉式侧边栏）
    ├── router/
    │   └── index.ts            # 路由定义 + 权限守卫
    ├── styles/
    │   └── index.css           # 主题 CSS 变量
    ├── utils/
    │   └── token.ts            # Token 存取 + requestParentTokenRefresh
    └── views/
        ├── UserList.vue
        ├── UserForm.vue
        ├── BatchCreateForm.vue
        ├── InvitationList.vue
        ├── Register.vue        # 公开路由
        ├── ApiDiagnostics.vue  # 公开路由（调试用）
        └── NotAllowed.vue
```

---

## 3. 认证握手协议

握手遵循「先 PLUGIN_READY 后 INIT」协议：

```
主系统 PluginLayout.vue          插件 App.vue
        │                              │
        │  1. 创建 iframe               │
        │ ─────────────────────────►   │
        │                              │  2. onMounted
        │                              │     注册 message 监听
        │  3. PLUGIN_READY             │
        │ ◄─────────────────────────   │
        │                              │
        │  4. INIT { token, config }   │
        │ ─────────────────────────►   │
        │                              │  5. setToken()
        │                              │     hasToken = true
        │                              │     setThemeFromConfig()
```

消息信封格式：
```typescript
{ type: string, id: string, payload?: Record<string, unknown> }
```

### 3.1 usePluginMessageBridge

统一通信桥 composable，在 `App.vue` 中调用一次：

```typescript
const { isReady } = usePluginMessageBridge({
  onInit: (payload) => {
    if (payload.token) {
      setToken(payload.token)
      hasToken.value = true
    }
    setThemeFromConfig(payload.config)
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

内部行为：
- `onMounted`：注册 `message` 监听器，发送 `PLUGIN_READY`
- `onBeforeUnmount`：移除监听器
- 内置处理 `INIT`、`TOKEN_UPDATE`、`DESTROY`
- 暴露 `postMessage`、`postResponse`、`onMessage` 供扩展

### 3.2 token.ts

每个插件使用独立的 localStorage key，避免多插件冲突：

```typescript
const TOKEN_KEY = 'user-mgmt-token'       // 按插件名命名
const REFRESH_TOKEN_KEY = 'user-mgmt-refresh-token'
```

关键函数：
- `isInIframe()` — 检测是否在 iframe 中运行
- `getToken() / setToken() / removeToken()` — token 存取
- `requestParentTokenRefresh()` — 通过 postMessage 请求主框架刷新 token（3s 超时）

---

## 4. App.vue 入口守卫

App.vue 是第一道防线，处理握手状态展示：

```
isPublicRoute?
  ├── 是 → 直接渲染 <router-view>（不需要 token）
  └── 否 → hasToken?
            ├── 是 → 渲染 <router-view>
            └── 否 → 显示握手状态模态窗
                      ├── 非 iframe → 显示"未在 iframe 中运行"警告
                      └── iframe 内 → 显示握手进度（PLUGIN_READY → INIT → 获取 token）
```

公开路由列表（`PUBLIC_ROUTES`）：
- `/register` — 邀请注册（无需 token）
- `/api-diagnostics` — API 诊断（调试用）

非 iframe 环境下，强制清除缓存 token，不允许复用：
```typescript
if (!inIframe.value) {
  removeToken()
  hasToken.value = false
}
```

---

## 5. 路由守卫

### 5.1 路由定义

```typescript
// 公开路由：meta.public = true
{ path: '/register', meta: { public: true } }

// 需要权限的路由：meta.requiresPermission
{ path: '/users', meta: { requiresPermission: 'list-users' } }
{ path: '/users/create', meta: { requiresPermission: 'create-user' } }
{ path: '/invitations', meta: { requiresPermission: 'manage-invitations' } }
```

### 5.2 beforeEach 守卫逻辑

```
to.meta.public?
  ├── 是 → 放行
  └── 否 → 有 requiresPermission?
            ├── 否 → 放行
            └── 是 → can(permission)?
                      ├── 是 → 放行
                      └── 否 → from.name 为空（首次导航）?
                                ├── 是 → 放行（避免重定向循环，App.vue 层处理展示）
                                └── 否 → ElMessage.error + 返回 false
```

---

## 6. API 层

### 6.1 双实例模式

```typescript
// 业务 API（插件专属）
const userApi = axios.create({ baseURL: '/api/v1/plugin-user', timeout: 10000 })

// 通用插件 API（verify-token、allowed-actions 等）
const pluginApi = axios.create({ baseURL: '/api/v1/plugin', timeout: 10000 })
```

### 6.2 请求拦截器

自动注入 `Authorization: Bearer {token}` 头。

### 6.3 两段式 Token 刷新（401 处理）

```
收到 401
  └── isRefreshing?
        ├── 是 → 加入 failedQueue，等待刷新完成后重试
        └── 否 → isRefreshing = true
                  └── tryRefreshToken()
                        ├── 1. isInIframe() → requestParentTokenRefresh()（3s 超时）
                        │     成功 → 更新 token，重试原请求
                        │     超时 → 进入第 2 步
                        └── 2. 本地 refresh token → POST /api/auth/refresh
                              成功 → 更新 token，重试原请求
                              失败 → removeAllTokens()
                                     postMessage('TOKEN_EXPIRED') 通知主框架
                                     processQueue(error)
```

响应拦截器还会提取 `x-refresh-token` 响应头，自动更新本地 refresh token。

---

## 7. 权限系统

### 7.1 usePermissions（单例 + 懒加载）

```typescript
// 模块级单例，避免重复请求
const permissions = ref<Permissions>({ 'list-users': false, ... })
const loaded = ref(false)
const loading = ref(false)

export function usePermissions() {
  async function fetchPermissions() {
    if (loaded.value || loading.value) return  // 防重复
    // GET /api/v1/plugin/allowed-actions?plugin_name=user-management
    // 支持通配符 '*'（全部权限）
  }
  function can(action): boolean { return permissions.value[action] }
  function hasAny(): boolean { return Object.values(permissions.value).some(Boolean) }
  return { permissions, loaded, loading, fetchPermissions, can, hasAny }
}
```

### 7.2 支持的 action 列表

| action | 说明 |
|--------|------|
| `list-users` | 查看用户列表 |
| `view-user` | 查看用户详情 |
| `create-user` | 创建用户（含批量） |
| `update-user` | 编辑用户 |
| `delete-user` | 删除用户 |
| `change-role` | 修改用户角色 |
| `manage-invitations` | 管理邀请码 |

### 7.3 后端权限检查（PHP Controller）

```php
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

---

## 8. 主题系统（useTheme）

### 8.1 初始化优先级

1. URL 参数 `?theme=xxx`（最高优先级，主系统在 iframe src 中附带）
2. INIT 消息的 `config.theme` 字段（`setThemeFromConfig`，URL 参数存在时跳过）
3. 默认值 `modern-blue`

### 8.2 运行时同步

监听主框架的 `THEME_CHANGE` 消息（仅接受来自 `window.parent` 的消息）：

```typescript
window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return
  if (event.data?.type === 'THEME_CHANGE') {
    themeName.value = event.data.payload.theme
    isDark.value = DARK_THEMES.includes(event.data.payload.theme)
  }
})
```

### 8.3 DOM 同步

```typescript
watchEffect(() => {
  document.documentElement.setAttribute('data-theme', isDark.value ? 'dark' : 'light')
  document.documentElement.classList.toggle('dark', isDark.value)
})
```

暗色主题列表：`['deep-space', 'cyber-tech']`

---

## 9. 国际化（i18n）

从 URL 参数 `?lang=` 读取语言，主系统在 iframe src 中附带：

```typescript
function getLanguageFromURL(): string {
  const params = new URLSearchParams(window.location.search)
  const lang = params.get('lang')
  const supported = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'th-TH']
  return supported.includes(lang ?? '') ? lang! : 'zh-CN'
}
```

语言包中的 `pluginMeta` 字段（`name`、`description`、`groupName`）会在构建时被 Vite 插件提取，生成 `plugin-manifest.json`，供主系统读取插件元信息。

---

## 10. nginx 反向代理

### 10.1 nginx.conf.template

使用 `__API_LOCATIONS__` 占位符，由 `docker-entrypoint.sh` 动态注入：

```nginx
server {
    listen 80;
    resolver 127.0.0.11 valid=30s ipv6=off;  # Docker 内置 DNS

    # __API_LOCATIONS__  ← 动态注入 /api/ 代理块

    location /health { ... }
    location /debug-env { ... }
    location / { try_files $uri $uri/ /index.html; }
}
```

### 10.2 Failover 代理链

`docker-entrypoint.sh` 读取 `APP_API_N_URL` 环境变量，生成带 failover 的 nginx location 块：

```
APP_API_1_URL=http://xrugc-api:80        # 主后端（Docker 内部）
APP_API_2_URL=https://api.xrugc.com      # 备用（可选）
```

单个后端时生成普通 `location /api/`；多个后端时生成 `proxy_intercept_errors + error_page` 链式 failover。

### 10.3 开发环境代理（vite.config.ts）

```typescript
server: {
  port: 3003,
  proxy: {
    '/api': {
      target: 'http://localhost:8081',
      changeOrigin: true,
      rewrite: (path) => path.replace(/^\/api/, '')
    }
  }
}
```

---

## 11. Docker 部署

### 11.1 Dockerfile（多阶段构建）

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
RUN echo "{\"status\":\"ok\",\"buildTime\":\"...\"}" > /usr/share/nginx/html/health.json
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint-custom.sh"]
```

### 11.2 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `APP_API_1_URL` | 主后端地址（必填） | `http://xrugc-api:80` |
| `APP_API_2_URL` | 备用后端地址（可选） | `https://api.xrugc.com` |
| `APP_API_N_HOST` | 覆盖对应后端的 Host 头（可选） | `api.xrugc.com` |

> 旧版使用 `API_UPSTREAM` 单变量，新版改为 `APP_API_N_URL` 支持 failover。

### 11.3 docker-compose 服务定义

```yaml
xrugc-user-management:
  build: ../plugins/user-management
  ports:
    - "3003:80"
  environment:
    - APP_API_1_URL=http://xrugc-api:80
  networks:
    - xrugc-network
  depends_on:
    - xrugc-api
```

---

## 12. 插件注册（plugins.json）

在 `web/public/config/plugins.json` 中注册：

```json
{
  "id": "user-management",
  "name": "用户管理",
  "url": "https://user-manager.plugins.xrugc.com/",
  "icon": "User",
  "group": "tools",
  "enabled": true,
  "order": 2,
  "allowedOrigin": "https://user-manager.plugins.xrugc.com",
  "version": "1.0.0"
}
```

可见性规则：只有 `allowed-actions` API 返回非空 actions 时，插件才出现在侧边栏。

---

## 13. 消息协议完整参考

| 消息类型 | 方向 | payload | 说明 |
|---------|------|---------|------|
| `PLUGIN_READY` | 插件→主 | 无 | 插件就绪，请求 INIT |
| `INIT` | 主→插件 | `{ token, config }` | 初始化，携带 JWT 和配置 |
| `TOKEN_UPDATE` | 主→插件 | `{ token }` | Token 刷新推送 |
| `TOKEN_REFRESH_REQUEST` | 插件→主 | 无 | 请求主框架刷新 token |
| `TOKEN_EXPIRED` | 插件→主 | 无 | token 刷新彻底失败 |
| `THEME_CHANGE` | 主→插件 | `{ theme }` | 主题切换 |
| `LANG_CHANGE` | 主→插件 | `{ lang }` | 语言切换（运行时，无需刷新） |
| `DESTROY` | 主→插件 | 无 | 即将销毁，做清理 |
| `REQUEST` | 主→插件 | 自定义 | 通用请求 |
| `RESPONSE` | 插件→主 | 自定义 | 通用响应（附 requestId） |
| `EVENT` | 双向 | 自定义 | 事件通知 |

---

## 14. 新插件开发 Checklist

- [ ] 复制 `token.ts`，修改 `TOKEN_KEY` 为插件专属名称
- [ ] 复制 `usePluginMessageBridge.ts`（无需修改）
- [ ] 复制 `useTheme.ts`（无需修改）
- [ ] 复制 `usePermissions.ts`，修改 `Permissions` 接口和 `plugin_name`
- [ ] 复制 `api/index.ts`，修改 `baseURL`（`/api/v1/plugin-{name}`）
- [ ] 复制 `i18n/index.ts`，按需调整语言包，加入 `LANG_CHANGE` 消息监听实现运行时切换
- [ ] `App.vue`：使用 `usePluginMessageBridge` 处理 INIT/TOKEN_UPDATE/DESTROY
- [ ] `router/index.ts`：公开路由加 `meta.public: true`，权限路由加 `meta.requiresPermission`
- [ ] `nginx.conf.template`：保留 `__API_LOCATIONS__` 占位符
- [ ] `docker-entrypoint.sh`：复制 failover 生成逻辑
- [ ] `Dockerfile`：多阶段构建，ENTRYPOINT 指向自定义 entrypoint
- [ ] 在 `web/public/config/plugins.json` 中注册插件
- [ ] 在主后端 `plugin_permission_config` 表中配置权限
- [ ] 在 `driver/docker-compose.yml` 中添加服务定义

---

## 15. 日/夜模式

### 15.1 CSS 变量双主题

主题通过 `[data-theme="dark"]` 选择器切换，所有颜色/阴影均用 CSS 变量定义，组件无需感知主题：

```css
/* styles/index.css */
:root {
  --primary-color: #00BAFF;
  --bg-page: #f5f7fa;
  --bg-card: #ffffff;
  --text-primary: #1a1a2e;
  /* ... */
}

[data-theme="dark"] {
  --primary-color: #409EFF;
  --bg-page: #141414;
  --bg-card: #1d1e1f;
  --text-primary: #e5eaf3;
  /* ... */
}
```

Element Plus 暗色模式通过 `html.dark` 类激活，需同时设置：

```typescript
// useTheme.ts
watchEffect(() => {
  document.documentElement.setAttribute('data-theme', isDark.value ? 'dark' : 'light')
  document.documentElement.classList.toggle('dark', isDark.value)
})
```

### 15.2 暗色主题列表

```typescript
const DARK_THEMES = ['deep-space', 'cyber-tech']
```

主系统通过 `?theme=deep-space` URL 参数或 `THEME_CHANGE` 消息传递主题名，插件根据是否在暗色列表中决定 `isDark`。

### 15.3 Element Plus 变量覆盖

在 `:root` 和 `[data-theme="dark"]` 中同步覆盖 Element Plus 的 CSS 变量，确保组件库跟随主题：

```css
--el-color-primary: var(--primary-color);
--el-bg-color: var(--bg-card);
--el-text-color-primary: var(--text-primary);
--el-border-color: var(--border-color);
/* 暗色额外需要 */
--el-fill-color-blank: var(--bg-card);
--el-mask-color: rgba(0, 0, 0, 0.6);
```

---

## 16. 多语言实现

### 16.1 语言初始化

从 URL 参数 `?lang=` 读取，主系统在 iframe src 中附带，不依赖 localStorage：

```typescript
// i18n/index.ts
function getLanguageFromURL(): string {
  const params = new URLSearchParams(window.location.search)
  const lang = params.get('lang')
  const supported = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'th-TH']
  return supported.includes(lang ?? '') ? lang! : 'zh-CN'
}

const i18n = createI18n({
  legacy: false,
  locale: getLanguageFromURL(),
  fallbackLocale: 'zh-CN',
  messages: { 'zh-CN': zhCN, 'zh-TW': zhTW, 'en-US': enUS, 'ja-JP': jaJP, 'th-TH': thTH }
})
```

### 16.2 语言包结构

每个语言包包含 `pluginMeta` 字段，构建时被 Vite 插件提取生成 `plugin-manifest.json`：

```typescript
// locales/zh-CN.ts
export default {
  pluginMeta: {
    name: '用户管理',          // 插件显示名（供主系统读取）
    description: '用户增删改查管理工具',
    groupName: '实用工具',
  },
  common: { ... },
  // 按功能模块分组
}
```

### 16.3 运行时语言切换（LANG_CHANGE）

监听主框架的 `LANG_CHANGE` 消息，无需刷新 iframe 即可切换语言：

```typescript
// i18n/index.ts
const SUPPORTED_LOCALES = ['zh-CN', 'zh-TW', 'en-US', 'ja-JP', 'th-TH'] as const
type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return
  const { type, payload } = (event.data || {}) as { type?: string; payload?: { lang?: string } }
  if (type === 'LANG_CHANGE' && payload?.lang) {
    const lang = payload.lang
    if ((SUPPORTED_LOCALES as readonly string[]).includes(lang)) {
      i18n.global.locale.value = lang as SupportedLocale
    }
  }
})
```

注意：`i18n` 必须以 `legacy: false` 模式创建，`locale` 才是响应式 ref，赋值后 vue-i18n 自动更新所有 `t()` 调用。

### 16.4 plugin-manifest.json 自动生成

`vite.config.ts` 中的 `pluginManifestPlugin` 在构建时扫描所有语言包，提取 `pluginMeta` 字段，生成 `public/plugin-manifest.json`，供主系统读取插件元信息（名称、描述、分组）：

```typescript
// vite.config.ts（构建时自动执行，无需手动维护）
{
  id: 'user-management',
  schemaVersion: '1',
  nameI18n: { 'zh-CN': '用户管理', 'en-US': 'User Management', ... },
  descriptionI18n: { ... },
  group: { id: 'tools', nameI18n: { ... } }
}
```

---

## 17. 顶栏显示用户名和权限

### 17.1 实现位置

在 `AppLayout.vue` 的 navbar 区域，`onMounted` 时并发请求用户信息和权限：

```typescript
// AppLayout.vue
const userInfo = ref<{ id: number; username: string; nickname: string; roles: string[] } | null>(null)

onMounted(async () => {
  const [{ data }] = await Promise.all([
    api.get('/me'),          // GET /api/v1/plugin-user/me
    fetchPermissions(),      // GET /api/v1/plugin/allowed-actions
  ])
  userInfo.value = data
})
```

### 17.2 模板展示

```html
<div v-if="userInfo" class="user-info">
  <el-icon><User /></el-icon>
  <span>{{ userInfo.nickname || userInfo.username }}</span>
  <el-tag size="small" v-for="role in userInfo.roles" :key="role">{{ role }}</el-tag>
</div>
```

优先显示 `nickname`，无昵称时回退到 `username`。角色用 `el-tag` 逐个展示。

### 17.3 /me 接口

```
GET /api/v1/plugin-user/me
Authorization: Bearer {token}

Response: { id, username, nickname, email, roles: string[] }
```

---

## 18. 版本号显示

### 18.1 版本号格式

北京时间格式：`v2026.03.25-0200`（年.月.日-时分），在 `vite.config.ts` 构建时生成：

```typescript
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

// vite.config.ts
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(buildVersion()),
  }
})
```

### 18.2 TypeScript 声明

```typescript
// App.vue 或 env.d.ts
declare const __APP_VERSION__: string
const appVersion = `v${__APP_VERSION__}`
```

### 18.3 页面展示

固定在右下角，低调显示，不影响操作：

```html
<span class="global-version">{{ appVersion }}</span>
```

```css
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
```

---

## 19. nginx 反向代理配置详解

### 19.1 模板文件结构

`nginx.conf.template` 使用 `__API_LOCATIONS__` 占位符，由 `docker-entrypoint.sh` 在容器启动时动态注入：

```nginx
server {
    listen 80;
    resolver 127.0.0.11 valid=30s ipv6=off;  # Docker 内置 DNS（必须，否则变量 proxy_pass 启动报错）

    # __API_LOCATIONS__  ← 动态注入，替换为实际 location 块

    location /health { ... }
    location /debug-env { ... }
    location / { try_files $uri $uri/ /index.html; }
}
```

### 19.2 Failover 代理链生成

`docker-entrypoint.sh` 读取 `APP_API_N_URL` 环境变量，生成带 failover 的 nginx location 块：

单后端（无 failover）：
```nginx
location /api/ {
    proxy_pass http://xrugc-api:80/;
    proxy_set_header Host $proxy_host;
    proxy_connect_timeout 5s;
    proxy_read_timeout 120s;
}
```

多后端（自动 failover）：
```nginx
location /api/ {
    proxy_pass http://primary-api:80/;
    proxy_intercept_errors on;
    error_page 502 503 504 = @api_backup_2;  # 主后端不可达时自动切换
}
location @api_backup_2 {
    rewrite ^/api/(.*) /$1 break;
    proxy_pass https://backup-api.example.com;
}
```

### 19.3 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `APP_API_1_URL` | 主后端地址（必填） | `http://xrugc-api:80` |
| `APP_API_2_URL` | 备用后端（可选，failover） | `https://api.xrugc.com` |
| `APP_API_N_HOST` | 覆盖对应后端的 Host 头（可选） | `api.xrugc.com` |

### 19.4 调试端点

| 路径 | 说明 |
|------|------|
| `/health` | 健康检查，返回 `{"status":"ok","buildTime":"..."}` |
| `/debug-env` | 调试信息，返回 `APP_API_N_URL`、`buildTime`、`hostname` |

---

## 20. 反向代理测试页面（ApiDiagnostics）

路由：`/api-diagnostics`（公开路由，无需 token）

### 20.1 功能模块

**环境信息面板**：展示当前页面地址、Origin、axios baseURL、token 状态、是否在 iframe、`APP_API_N_URL`（从 `/debug-env` 读取）、容器 hostname 和启动时间。

**反向代理连通性检测**：直接用 `fetch` 探测各 nginx proxy_pass location，检测代理是否正确配置并能到达后端。每条测试显示：
- 请求 URL
- 预期后端地址（从 `/debug-env` 读取实际 upstream 后动态更新）
- HTTP 状态码
- 诊断结论（✅ 代理正常 / ⚠️ Nginx 未匹配规则 / ❌ 代理目标不可达）
- 响应耗时、关键响应头、响应体前 300 字

**API 端点测试（Axios）**：通过 axios 实例测试各业务接口，展示完整响应头和响应体。

**原始 Fetch 测试**：绕过 axios 拦截器，直接用 `fetch` 请求，排除拦截器干扰。

**自定义 URL 测试**：输入任意 URL 和 HTTP 方法，手动发送请求，用于临时调试。

### 20.2 诊断判定逻辑

```
HTTP 502/503/504 → ❌ 代理目标不可达（nginx 无法连接后端）
HTTP 404 + HTML 响应体 → ⚠️ nginx 未匹配到代理规则（返回了 nginx 自己的 404）
HTTP 2xx/3xx → ✅ 代理正常
HTTP 4xx（来自后端）→ ✅ 代理连通（后端返回认证/参数错误，代理本身正常）
```

### 20.3 访问方式

直接访问插件的 `/api-diagnostics` 路径，无需登录，适合部stics`，无需登录，适合部署后快速验证代理配置。

---

## 21. 握手状态模态窗

### 21.1 触发条件

非公开路由 + 尚未获得 token 时显示，分两种情况：

| 情况 | 展示内容 |
|------|---------|
| 非 iframe 环境 | ⚠️ 警告：未在 iframe 中运行，INIT 永远不会到达，附诊断页链接 |
| iframe 内握手中 | ⚙️ 进度：显示握手四步骤的实时状态 |

### 21.2 握手进度步骤

```
✅ 页面加载完成
✅ 发送 PLUGIN_READY
⏳/✅ 等待主系统回复 INIT    ← isReady 变为 true 时变绿
⏳/✅ 获取 JWT Token         ← hasToken 变为 true 时变绿
```

### 21.3 实现要点

```vue
<!-- App.vue -->
<!-- 显示条件：非公开路由 且 (非 iframe 或 无 token) -->
<Transition name="handshake-fade">
  <div v-if="showHandshake" class="handshake-overlay">
    <!-- 非 iframe：警告 + 诊断链接 -->
    <template v-if="!inIframe">
      <a href="/api-diagnostics">前往 API 诊断页面 →</a>
    </template>
    <!-- iframe 内：实时进度 -->
    <template v-else>
      <div :class="isReady ? 'done' : 'waiting'">等待主系统回复 INIT</div>
      <div :class="hasToken ? 'done' : 'waiting'">获取 JWT Token</div>
    </template>
  </div>
</Transition>
```

模态窗使用 `backdrop-filter: blur(4px)` 半透明遮罩，通过 `Transition` 组件实现淡入淡出动画。

### 21.4 非 iframe 环境处理

```typescript
onMounted(() => {
  if (isPublicRoute.value) return
  inIframe.value = isInIframe()
  if (!inIframe.value) {
    removeToken()       // 强制清除缓存 token，不允许复用
    hasToken.value = false
  } else {
    hasToken.value = !!getToken()  // iframe 内可复用已有 token
  }
})
```

非 iframe 环境下清除 token 是为了防止开发者直接访问插件 URL 时复用旧 token 绕过握手。

---

## 22. 常见陷阱与最佳实践

### 22.1 inIframe 初始值必须同步检测

`isInIframe()` 是同步函数，必须在 setup 阶段直接调用，不能延迟到 `onMounted`。否则首次渲染时 `inIframe` 为 `false`，模板条件分支会走错路径。

```typescript
// ❌ 延迟检测
const inIframe = ref(false)
onMounted(() => { inIframe.value = isInIframe() })

// ✅ 同步检测
const inIframe = ref(isInIframe())
```

### 22.2 路由守卫不应在 iframe 内检查 token

iframe 内的 token 通过异步握手获取，路由守卫执行时 token 可能还没到。如果守卫检查 `!getToken()` 并重定向到 NotAllowed，会导致偶发的"请通过主系统访问"页面。

```typescript
// ❌ 竞态：iframe 内握手完成前 getToken() 为 null
router.beforeEach((to) => {
  if (!isInIframe() || !getToken()) {
    return { name: 'NotAllowed' }
  }
})

// ✅ 只在非 iframe 时重定向，iframe 内由 App.vue 处理等待
router.beforeEach((to) => {
  if (to.meta.public) return true
  if (to.name === 'NotAllowed') return true
  if (!isInIframe()) {
    return { name: 'NotAllowed' }
  }
  return true
})
```

Token 等待由 App.vue 的 `v-if="hasToken"` 控制渲染。

### 22.3 App.vue 握手 UI 应区分 iframe 内外

- 非 iframe（直接访问插件 URL）：显示警告模态窗（⚠️ + 遮罩 + 诊断链接），因为这是错误状态
- iframe 内（正常握手）：显示简单 loading（旋转齿轮 + 文字），因为这是正常等待，不应让用户误以为出错

```vue
<!-- 非 iframe：警告模态窗 -->
<div v-if="showHandshake && !inIframe" class="handshake-overlay">
  <div class="handshake-card">⚠️ 请通过主系统访问</div>
</div>
<!-- iframe 内：简单 loading -->
<div v-else-if="showHandshake && inIframe" class="handshake-inline">
  ⚙️ 正在连接主系统...
</div>
```
