# 用户管理插件

前后端分离的用户管理工具，用于增加和管理系统用户。

## 认证方式

插件不提供独立登录，通过主系统的 Plugin Auth API 进行身份验证和权限控制：
- 用户在主系统登录后，主系统通过 postMessage 将 JWT Token 传递给插件
- 插件后端调用主后端 `/v1/plugin/verify-token` 验证用户身份
- 插件后端调用主后端 `/v1/plugin/check-permission` 检查操作权限

## 技术栈

- 前端：Vue 3 + TypeScript + Element Plus + Vite
- 后端：Node.js + Express + MySQL + Redis
- 共享主系统的 MySQL 和 Redis

## 端口

| 服务 | 端口 |
|------|------|
| 前端 | http://localhost:3003 |
| 后端 API | http://localhost:8086/api |

## 开发启动

```bash
# 后端（需先安装依赖）
cd backend
npm install
node --env-file=.env src/index.js

# 前端
cd frontend
npm install
npm run dev
```

## Docker 启动

```bash
# 确保主系统已运行（提供 Plugin Auth API）
cd driver && docker-compose up -d

# 启动用户管理插件
cd plugins/user-management
docker-compose up -d
```

## API

| 方法 | 路径 | 说明 | 权限 |
|------|------|------|------|
| GET | /api/users/me | 当前用户信息 | 需认证 |
| GET | /api/users/permissions | 当前用户权限列表 | 需认证 |
| GET | /api/users | 用户列表（分页+搜索） | list-users |
| GET | /api/users/:id | 用户详情 | view-user |
| POST | /api/users | 创建用户 | create-user |
| PUT | /api/users/:id | 更新用户 | update-user |
| DELETE | /api/users/:id | 删除用户 | delete-user |
| GET | /api/health | 健康检查 | 无 |

## 权限配置

在主后端管理后台的「插件权限配置」中添加。`action` 字段支持逗号分隔配置多个操作。

### 动作权限说明

| action | 说明 | 对应 API |
|--------|------|----------|
| list-users | 查看用户列表 | GET /api/users |
| view-user | 查看用户详情 | GET /api/users/:id |
| create-user | 创建用户 | POST /api/users |
| update-user | 编辑用户 | PUT /api/users/:id |
| delete-user | 删除用户 | DELETE /api/users/:id |

### 配置示例

管理员拥有全部权限（一行逗号分隔）：

| role_or_permission | plugin_name | action |
|---|---|---|
| admin | user-management | list-users,view-user,create-user,update-user,delete-user |

只读角色（仅查看）：

| role_or_permission | plugin_name | action |
|---|---|---|
| teacher | user-management | list-users,view-user |
