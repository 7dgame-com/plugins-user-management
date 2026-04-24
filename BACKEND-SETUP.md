# 后端配置需求：user-management 插件 Develop 环境

## 当前状态

前端插件和 nginx 反向代理均已正常工作：

- Docker 镜像已构建并部署：`hkccr.ccs.tencentyun.com/plugins/user-manager:develop`
- nginx 现按前缀拆分上游：
  - 前端请求 `/api/v1/plugin/verify-token` → `APP_API_N_URL + /v1/plugin/verify-token`
  - 前端请求 `/api/v1/plugin-user/users` → `APP_API_N_URL + /v1/plugin-user/users`

## 问题

后端插件注册表中，`user-management` 插件的 `allowedOrigin` 只有生产地址，develop 域名未注册，导致来自 `user-manager.d.plugins.xrugc.com` 的请求被拒绝返回 404。

当前注册表中的记录（从 `GET /v1/plugin/list` 查到）：

```json
{
  "id": "user-management",
  "url": "https://user-manager.plugins.xrugc.com/",
  "allowedOrigin": "https://user-manager.plugins.xrugc.com"
}
```

## 需要操作

在 `api.d.xrteeth.com` 的插件注册表中，为 `user-management` 插件新增 develop 环境记录：

```json
{
  "id": "user-management",
  "url": "https://user-manager.d.plugins.xrugc.com/",
  "allowedOrigin": "https://user-manager.d.plugins.xrugc.com"
}
```

## Develop 环境信息

| 项目 | 地址 |
|------|------|
| 前端插件 | `https://user-manager.d.plugins.xrugc.com` |
| 后端 API | `https://api.d.xrteeth.com` |
| 主系统 | `https://d.dev.xrugc.com` |
