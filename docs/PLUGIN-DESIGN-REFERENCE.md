# user-management 插件设计参考

本文档记录 `user-management` 的界面和交互约定。通用设计系统以 `web/docs/plugin-design-guide.md` 和 `web/docs/plugin-design-quick-reference.md` 为准。

## 页面结构

```text
App.vue
  AppLayout.vue
    左侧抽屉式导航
    顶部工具区
    router-view
      UserList
      UserForm
      BatchCreateForm
      InvitationList
      OrganizationList
      Register
      ApiDiagnostics
```

`App.vue` 负责握手状态、无 token 状态和 iframe 环境判断。业务页面只处理自己的数据加载和交互。

## 状态展示

| 状态 | 展示方式 |
|------|----------|
| 等待 `INIT` | 显示加载/授权等待状态 |
| 非 iframe 打开受保护页 | 显示“请从主系统打开”类提示 |
| token 无效或过期 | 清理本地 token，等待主系统重新注入 |
| 无权限 | 保留当前页面结构，提示无权限 |
| 公开路由 | 不要求 token，直接渲染 |

## 主题和语言

- 初始主题和语言来自 iframe URL 参数：`?lang=...&theme=...`。
- 运行时监听主系统发送的 `THEME_CHANGE`、`LANG_CHANGE`。
- 页面样式使用 CSS 变量，不硬编码主色、背景、文字色。
- 语言包保留 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`th-TH`。

## 权限体验

当前插件只允许 `root` 执行管理动作。页面可继续用细粒度 `requiresPermission` 声明能力，但能力来源是本地角色矩阵，不是远程 `allowed-actions`。

设计上要保证：

- 用户没有能力时，不显示危险操作入口。
- 首次加载权限未完成时，不闪现操作按钮。
- 批量创建、删除、角色变更等操作必须有确认或明确反馈。

## 与模板的关系

`user-management` 是完整业务插件参考，不是新插件模板。新插件应优先复制 `plugins/plugin-template-frontend-only/`：

- 模板负责通用握手、会话、权限、主题、语言、代理结构。
- `user-management` 只用于参考复杂业务页面如何组织列表、表单、批量操作和公开注册页。

## 不再维护的旧口径

以下内容已过时，不应再作为设计或实现依据：

- `plugin-template-sample`
- 插件内部 `/api-config` 代理
- `allowed-actions` 控制插件内部页面
- `check-permission` 逐动作远程鉴权
- `INIT` 先于 `PLUGIN_READY` 的握手顺序
