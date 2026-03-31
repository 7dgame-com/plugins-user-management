# 后端配置需求：user-management 插件 Develop 环境

## 当前状态

前端插件和 nginx 反向代理均已正常工作：

- Docker 镜像已构建并部署：`hkccr.ccs.tencentyun.com/plugins/user-manager:develop`
- nginx 反向代理已配置，`/v1/plugin/` 和 `/v1/plugin-user/` 请求正确转发到 `https://api.d.xrteeth.com`
- 请求确实到达了后端，但后端返回 `{"statusCode":404}`

## 问题

后端插件注册表中，`user-management` 插件的 `allowedOrigin` 只有生产地址，develop 域名未注册，导致来自 `user-manager.d.plugins.xrugc.com` 的请求被拒绝。

验证：
```bash
# 直接请求后端 → 401（接口存在，只是没带 token）
curl https://api.d.xrteeth.com/v1/plugin/verify-token
→ {"name":"Unauthorized",...}

# 通过 nginx 代理请求 → 404（后端拒绝，域名未注册）
curl https://user-manager.d.plugins.xrugc.com/v1/plugin/verify-token
→ {"statusCode":404}
```

当前注册表中的记录（从 `/v1/plugin/list` 查到）：
```json
{
  "id": "user-management",
  "url": "https://user-manager.plugins.xrugc.com/",
  "allowedOrigin": "https://user-manager.plugins.xrugc.com"
}
```

## 需要操作

在 `api.d.xrteeth.com` 的插件注册表中，将 `user-management` 插件新增或更新 develop 环境的域名：

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
