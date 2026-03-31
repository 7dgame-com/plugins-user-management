# 后端配置需求：user-management 插件 Develop 环境

## 问题描述

`user-management` 插件在 develop 环境（`https://user-manager.d.plugins.xrugc.com`）无法正常工作，所有 API 请求返回 404。

根本原因：后端插件注册表中，`user-management` 插件的 `url` 和 `allowedOrigin` 指向的是生产地址，develop 环境的域名未被注册，导致 `verify-token`、`allowed-actions` 等接口拒绝来自 develop 域名的请求。

验证方式：
```
# 直接请求后端（返回 401，接口存在）
curl https://api.d.xrteeth.com/v1/plugin/verify-token
→ {"name":"Unauthorized",...}

# 通过 develop 插件域名请求（返回 404，域名未注册）
curl https://user-manager.d.plugins.xrugc.com/v1/plugin/verify-token
→ {"statusCode":404}
```

---

## 需要在后端执行的操作

在 develop 后端（`api.d.xrteeth.com`）的插件注册表中，为 `user-management` 插件新增一条 develop 环境记录：

| 字段 | 当前值（生产） | 需要新增（develop） |
|------|--------------|-------------------|
| `id` | `user-management` | `user-management`（同一插件，新增环境记录） |
| `url` | `https://user-manager.plugins.xrugc.com/` | `https://user-manager.d.plugins.xrugc.com/` |
| `allowedOrigin` | `https://user-manager.plugins.xrugc.com` | `https://user-manager.d.plugins.xrugc.com` |

其他字段（name、icon、group、enabled 等）与生产保持一致即可。

---

## 当前 Develop 环境信息

| 项目 | 地址 |
|------|------|
| 前端插件地址 | `https://user-manager.d.plugins.xrugc.com` |
| 后端 API | `https://api.d.xrteeth.com` |
| 主系统地址 | `https://d.dev.xrugc.com` |
| Docker 镜像 | `hkccr.ccs.tencentyun.com/plugins/user-manager:develop` |

---

## 涉及的 API 接口

插件运行时会调用以下接口，均需要 `allowedOrigin` 匹配才能正常响应：

- `GET /v1/plugin/verify-token?plugin_name=user-management`
- `GET /v1/plugin/allowed-actions?plugin_name=user-management`
- `GET /v1/plugin-user/me`
- `GET /v1/plugin-user/users`
- `POST /v1/plugin-user/users`
- `PUT /v1/plugin-user/users/:id`
- `DELETE /v1/plugin-user/users/:id`
