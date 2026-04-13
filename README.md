# 用户管理插件

用户管理工具插件，提供用户增删改查、批量创建用户、邀请码管理等功能。作为插件系统的参考实现，本插件沉淀了后续插件模板和接入规范中的通用模式。

## 功能

- **用户管理**：查看用户列表、创建/编辑/删除用户、修改角色
- **批量创建**：通过模板（如 `student_{001}`）批量生成用户，支持编号补零
- **邀请码管理**：生成带名额和有效期的邀请链接，查看注册记录
- **邀请注册**：通过邀请链接自助注册（公开路由，无需登录）

## 架构

纯前端插件，无独立后端。nginx 将 `/api/` 请求反向代理到主后端，前端直接调用主后端的插件 API。

```
浏览器 → nginx (port 80)
  ├── /api/*  → 主后端 API（${API_UPSTREAM}）
  └── /*      → SPA 静态文件
```

## 认证方式

插件不提供独立登录，通过主系统的 Plugin Auth API 进行身份验证和权限控制：

1. 主系统加载 iframe 后，插件发送 `PLUGIN_READY`
2. 主系统收到后发送 `INIT`（携带 JWT Token 和配置）
3. 插件存储 token，后续 API 请求通过 `Authorization: Bearer {token}` 传递

## 技术栈

- 前端：Vue 3 + TypeScript + Element Plus + Vite
- 运行时：nginx（反向代理 + SPA 静态服务）
- 共享主系统的 MySQL 和 Redis（通过主后端 API 访问）

## 端口

| 服务 | 端口 |
|------|------|
| 前端（Docker） | http://localhost:3003 |
| 前端（开发） | http://localhost:3003 |

## 开发启动

```bash
npm install
npm run dev
```

开发环境代理配置（`vite.config.ts`）：`/api` → `http://localhost:8081`

## Docker 部署

```bash
# 确保主系统已运行（提供 Plugin Auth API）
cd driver && docker-compose up -d

# 构建并启动插件
cd plugins/user-management
docker build -t user-management .
docker run -p 3003:80 -e API_UPSTREAM=http://xrugc-api:80 user-management
```

或通过 `driver/docker-compose.yml` 统一编排：

```yaml
xrugc-user-management:
  image: hkccr.ccs.tencentyun.com/plugins/user-manager:latest
  ports:
    - "3003:80"
  environment:
    - API_UPSTREAM=http://xrugc-api:80
  networks:
    - xrugc-network
```

## 环境变量

| 变量 | 说明 | 示例 |
|------|------|------|
| `API_UPSTREAM` | 主后端 API 地址（nginx 反向代理目标） | `http://xrugc-api:80`（Docker 内部）或 `https://api.xrugc.com`（生产） |

## API

插件前端通过 nginx 分两路代理后端请求：业务接口走 `/api/v1/plugin-user/`，通用插件接口走 `/api-config/api/v1/plugin/`：

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | /api/v1/plugin-user/me | 当前用户信息 | 需认证 |
| GET | /api-config/api/v1/plugin/allowed-actions | 当前用户权限列表 | 需认证 |
| GET | /api/v1/plugin-user/users | 用户列表（分页+搜索） | list-users |
| GET | /api/v1/plugin-user/users/:id | 用户详情 | view-user |
| POST | /api/v1/plugin-user/users | 创建用户 | create-user |
| PUT | /api/v1/plugin-user/users/:id | 更新用户 | update-user |
| DELETE | /api/v1/plugin-user/users/:id | 删除用户 | delete-user |
| POST | /api/v1/plugin-user/batch-create-users | 批量创建用户 | create-user |
| GET | /api/v1/plugin-user/invitations | 邀请列表 | manage-invitations |
| POST | /api/v1/plugin-user/invitations | 生成邀请链接 | manage-invitations |
| DELETE | /api/v1/plugin-user/invitations/:id | 撤销邀请 | manage-invitations |
| GET | /api/v1/plugin-user/health | 健康检查 | 无 |

## 权限配置

在主后端管理后台的「插件权限配置」中添加。`action` 字段支持逗号分隔配置多个操作，`*` 表示全部权限。

### 动作权限说明

| action | 说明 |
|--------|------|
| list-users | 查看用户列表 |
| view-user | 查看用户详情 |
| create-user | 创建用户（含批量创建） |
| update-user | 编辑用户 |
| delete-user | 删除用户 |
| change-role | 修改用户角色 |
| manage-invitations | 管理邀请码 |

### 配置示例

管理员拥有全部权限：

| role_or_permission | plugin_name | action |
|---|---|---|
| admin | user-management | * |

只读角色（仅查看）：

| role_or_permission | plugin_name | action |
|---|---|---|
| teacher | user-management | list-users,view-user |

## 作为参考实现

本插件是插件系统的原始参考实现。后续插件模板和接入规范中的通用模式（如 `usePluginMessageBridge`、`useTheme`、`usePermissions`、`token.ts` 等）都可以回溯到这里。
