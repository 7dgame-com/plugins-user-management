# Token 刷新机制 — 外部系统集成指南

本文档描述用户管理插件（user-management plugin）实现 Token 刷新机制后，需要**主后端**和**主前端**配合修改的内容。请按照本文档完成对应系统的改造。

---

## 一、主后端需要新增的 API

### 1.1 新增端点：`POST /v1/plugin/refresh-token`

插件后端在刷新 token 时，会调用主后端的此端点来获取新的 access token。

#### 请求

- **Method**: `POST`
- **URL**: `{MAIN_API_BASE}/v1/plugin/refresh-token`
  - `MAIN_API_BASE` 由插件后端环境变量 `MAIN_API_URL` 配置，默认 `http://localhost:8091`
- **Content-Type**: `application/json`
- **Request Body**:

```json
{
  "userId": "string"  // 用户 ID，由插件后端从 refresh token 中解析得到
}
```

#### 响应

**成功响应** (HTTP 200):

```json
{
  "code": 0,
  "data": {
    "accessToken": "string"  // 新生成的 JWT access token
  }
}
```

**失败响应** (HTTP 200，业务错误):

```json
{
  "code": 1,
  "message": "string"  // 错误描述，如 "用户不存在"、"用户已被禁用" 等
}
```

#### 实现要点

1. 根据 `userId` 查找用户，验证用户状态（是否存在、是否被禁用等）
2. 为该用户生成一个新的 JWT access token（与正常登录时生成的 token 格式一致）
3. 返回新的 access token
4. 建议对此端点做基本的安全校验（如只允许来自插件后端的内网请求，或通过共享密钥验证）

#### 调用方代码参考

以下是插件后端调用此端点的代码（位于 `backend/src/routes/auth.js`）：

```javascript
const response = await axios.post(`${MAIN_API_BASE}/v1/plugin/refresh-token`, {
  userId,
});

if (response.data.code === 0) {
  // 成功，使用 response.data.data.accessToken
  accessToken = response.data.data.accessToken;
} else {
  // 失败，插件后端会返回 502 给前端
  console.error('Main backend refresh failed:', response.data.message);
}
```

#### 错误处理

| 场景 | 插件后端行为 |
|------|-------------|
| 主后端返回 `code: 0` | 正常流程，使用新 accessToken |
| 主后端返回 `code: 非0` | 插件后端返回 HTTP 502 给前端 |
| 主后端网络不可达 / 超时 | 插件后端返回 HTTP 502 给前端 |

---

### 1.2 已有端点确认：`GET /v1/plugin/verify-token`

此端点已存在并被插件后端的 auth 中间件使用。无需修改，仅确认其正常工作即可。

插件后端在用户首次通过认证时，会通过此端点验证 access token，验证成功后自动生成 refresh token 并通过响应头 `X-Refresh-Token` 返回给前端。

---

## 二、主前端需要修改的 postMessage 通信

插件前端运行在 iframe 中，通过 `postMessage` 与主前端通信。Token 刷新机制新增了以下通信协议。

### 2.1 新增：监听 `TOKEN_REFRESH_REQUEST` 消息

当插件的 access token 过期时，插件前端会优先通过 postMessage 请求主前端刷新 token。

#### 插件发送的消息

```javascript
// 插件前端 → 主前端
window.parent.postMessage({
  type: 'TOKEN_REFRESH_REQUEST'
}, '*')
```

#### 主前端需要做的

1. 监听来自插件 iframe 的 `TOKEN_REFRESH_REQUEST` 消息
2. 收到后，使用主前端自身的认证机制获取新的 access token
3. 通过 `TOKEN_UPDATE` 消息将新 token 发送回插件 iframe

```javascript
// 主前端监听代码示例
window.addEventListener('message', (event) => {
  // 安全检查：验证消息来源是否为插件 iframe
  const pluginIframe = document.getElementById('user-management-iframe')
  if (event.source !== pluginIframe?.contentWindow) return

  if (event.data?.type === 'TOKEN_REFRESH_REQUEST') {
    // 使用主前端的认证机制获取新 token
    refreshAccessToken()
      .then(({ accessToken, refreshToken }) => {
        // 将新 token 发送回插件 iframe
        pluginIframe.contentWindow.postMessage({
          type: 'TOKEN_UPDATE',
          payload: {
            token: accessToken,           // 必须：新的 access token
            refreshToken: refreshToken     // 可选：新的 refresh token（如果有）
          }
        }, '*')  // 生产环境建议使用具体的 origin
      })
      .catch(() => {
        // 刷新失败时不发送消息，插件会在 3 秒超时后自动回退到本地刷新
      })
  }
})
```

#### 超时机制

- 插件前端发送 `TOKEN_REFRESH_REQUEST` 后，会等待 **3 秒**（可通过环境变量 `VITE_IFRAME_REFRESH_TIMEOUT` 配置）
- 如果 3 秒内未收到 `TOKEN_UPDATE` 响应，插件会自动回退到使用本地 refresh token 直接调用插件后端的 `/api/auth/refresh` 端点
- 因此主前端的响应应尽量在 3 秒内完成

---

### 2.2 修改：`INIT` 消息增加 `refreshToken` 字段

现有的 `INIT` 消息用于在插件加载时传递 access token。现在需要同时传递 refresh token（如果有的话）。

#### 修改前

```javascript
pluginIframe.contentWindow.postMessage({
  type: 'INIT',
  payload: {
    token: accessToken
  }
}, '*')
```

#### 修改后

```javascript
pluginIframe.contentWindow.postMessage({
  type: 'INIT',
  payload: {
    token: accessToken,
    refreshToken: refreshToken  // 新增：可选字段，传递 refresh token
  }
}, '*')
```

> 注意：`refreshToken` 是可选字段。如果主前端没有 refresh token，可以不传，插件会在首次 API 请求时通过 `X-Refresh-Token` 响应头从插件后端获取。

---

### 2.3 修改：`TOKEN_UPDATE` 消息增加 `refreshToken` 字段

现有的 `TOKEN_UPDATE` 消息用于在 token 更新时通知插件。现在需要同时传递 refresh token。

#### 修改前

```javascript
pluginIframe.contentWindow.postMessage({
  type: 'TOKEN_UPDATE',
  payload: {
    token: newAccessToken
  }
}, '*')
```

#### 修改后

```javascript
pluginIframe.contentWindow.postMessage({
  type: 'TOKEN_UPDATE',
  payload: {
    token: newAccessToken,
    refreshToken: newRefreshToken  // 新增：可选字段
  }
}, '*')
```

---

### 2.4 已有消息确认：`TOKEN_EXPIRED`

插件在 token 刷新彻底失败（本地 refresh token 也无效）时，会发送此消息通知主前端。此消息已存在，无需修改，仅确认主前端已正确处理。

```javascript
// 插件前端 → 主前端（已有，无需修改）
window.parent.postMessage({
  type: 'TOKEN_EXPIRED'
}, '*')
```

主前端收到此消息后应引导用户重新登录。

---

### 2.5 已有消息确认：`DESTROY`

主前端发送 `DESTROY` 消息时，插件会清除所有本地 token（包括 access token 和 refresh token）。此消息已存在，无需修改。

---

## 三、完整的 postMessage 通信协议汇总

| 方向 | 消息类型 | 状态 | 说明 |
|------|---------|------|------|
| 主前端 → 插件 | `INIT` | **需修改** | payload 增加可选 `refreshToken` 字段 |
| 插件 → 主前端 | `PLUGIN_READY` | 已有，无需修改 | 插件加载完成通知 |
| 主前端 → 插件 | `TOKEN_UPDATE` | **需修改** | payload 增加可选 `refreshToken` 字段 |
| 插件 → 主前端 | `TOKEN_REFRESH_REQUEST` | **新增** | 插件请求主前端刷新 token |
| 插件 → 主前端 | `TOKEN_EXPIRED` | 已有，无需修改 | token 彻底失效通知 |
| 主前端 → 插件 | `DESTROY` | 已有，无需修改 | 销毁插件通知 |

---

## 四、完整的 Token 刷新流程

```
用户操作 → 插件前端发起 API 请求
                ↓
        插件后端返回 401（access token 过期）
                ↓
        ┌─ iframe 模式？─┐
        │ 是              │ 否
        ↓                 ↓
  发送 TOKEN_REFRESH_REQUEST    直接使用本地
  给主前端                       refresh token
        ↓                       调用 /api/auth/refresh
  主前端 3 秒内响应？              ↓
  ┌─────┴─────┐           插件后端调用主后端
  │ 是         │ 否        POST /v1/plugin/refresh-token
  ↓            ↓                 ↓
收到 TOKEN_UPDATE  回退到本地    主后端返回新 access token
更新本地 token     refresh token       ↓
  ↓            调用 /api/auth/refresh  插件后端轮换 refresh token
重试原始请求         ↓                 返回新的 accessToken + refreshToken
                同上流程                    ↓
                                    插件前端更新本地 token
                                    重试原始请求
```

---

## 五、改动清单（Checklist）

### 主后端

- [ ] 新增 `POST /v1/plugin/refresh-token` 端点
  - 接收 `{ userId: string }`
  - 返回 `{ code: 0, data: { accessToken: "..." } }`
  - 验证用户状态（存在、未禁用）
  - 生成与登录一致的 JWT access token

### 主前端

- [ ] 监听插件 iframe 的 `TOKEN_REFRESH_REQUEST` 消息
  - 收到后刷新 token 并通过 `TOKEN_UPDATE` 回传
  - 刷新失败时不发送消息（插件会自动超时回退）
- [ ] `INIT` 消息的 payload 增加可选 `refreshToken` 字段
- [ ] `TOKEN_UPDATE` 消息的 payload 增加可选 `refreshToken` 字段
- [ ] 确认已正确处理 `TOKEN_EXPIRED` 消息（引导用户重新登录）
