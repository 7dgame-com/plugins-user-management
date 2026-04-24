# user-management 插件实现指南

本文档只记录 `user-management` 当前实现的关键点。通用插件协议以 `web/docs/plugin-development-guide.md` 和 `plugins/plugin-template-frontend-only/` 为准。

## 当前架构

```text
web 主前端
  -> /plugins/user-management
  -> PluginLayout 创建 iframe
  -> PLUGIN_READY -> INIT 下发 token/config

user-management
  src/composables/usePluginMessageBridge.ts
  src/api/index.ts
    userApi: /api/v1/plugin-user
    mainApi: /api/v1
  src/composables/useAuthSession.ts
  src/composables/usePermissions.ts
  src/router/index.ts
```

插件没有独立后端。业务接口和会话接口都经插件域名下的 `/api/*` 代理到主后端。

## 运行时路径

| 用途 | 浏览器请求路径 | 说明 |
|------|----------------|------|
| 用户业务 API | `/api/v1/plugin-user/*` | 用户列表、创建、更新、删除、邀请、健康检查 |
| 当前会话 | `/api/v1/plugin/verify-token` | 返回用户、角色、组织信息 |
| 组织列表 | `/api/v1/organization/list` | 批量创建和组织管理使用 |
| token 刷新回退 | `/api/auth/refresh` | 主框架刷新超时后使用本地 refresh token |

当前实现不再创建 `pluginApi`，也不再依赖 `/api-config`、`allowed-actions`、`check-permission`。

## 会话与权限

`verifyCurrentToken()` 位于 `src/api/index.ts`：

```ts
const mainApi = axios.create({
  baseURL: "/api/v1",
  timeout: 10000
})

export function verifyCurrentToken() {
  return mainApi.get("/plugin/verify-token")
}
```

`useAuthSession()` 调用 `verifyCurrentToken()`，提取：

- `id`
- `username`
- `nickname`
- `roles`

`usePermissions()` 根据当前角色在插件本地映射权限。当前 `user-management` 的策略是：只有 `root` 角色拥有全部管理能力。

```ts
const allowed = loaded.value && hasRootAccess.value
```

受控动作：

- `list-users`
- `view-user`
- `create-user`
- `update-user`
- `delete-user`
- `change-role`
- `manage-invitations`
- `manage-organizations`

路由通过 `meta.requiresPermission` 声明所需动作。首次导航时守卫会放行，由 `App.vue` 负责展示握手、无 token 或无权限状态，避免重定向循环。

## Token 刷新

`src/api/index.ts` 的响应拦截器遇到 401 时按两段式刷新：

1. iframe 模式下先通过 `TOKEN_REFRESH_REQUEST` 请求主框架刷新 token。
2. 主框架超时后，回退到本地 refresh token 调用 `/api/auth/refresh`。

两段都失败时清理 token，并在 iframe 中向主框架发送 `TOKEN_EXPIRED`。

## 代理配置

当前 nginx/Vite 只需要 `/api` 代理。运行时上游使用 `APP_API_N_URL` 系列变量。

```text
/api/* -> APP_API_N_URL/*
```

旧配置中的 `APP_CONFIG_*` 和 `/api-config/*` 已不是当前实现需要的路径。

## 公开页面

以下路由不需要主系统 token：

- `/register`
- `/api-diagnostics`

其余页面必须等待 `INIT` 或 token 刷新完成后才能进行业务请求。

## 维护提示

- 修改插件握手、token 刷新、主题、语言逻辑时，同步检查 `plugins/plugin-template-frontend-only/src/composables/usePluginMessageBridge.ts`。
- 修改权限动作时，同时更新 `usePermissions.ts`、`router/index.ts` 和 README 的接口表。
- 不要把历史 `/api-config` 示例重新复制进本插件文档。
