# 用户管理插件 - 更新日志

## [未发布] - 2026-03-13

### 新增
- ✨ 完整的多语言支持（i18n）
  - 支持 5 种语言：简体中文、繁体中文、英语、日语、泰语
  - 通过 URL 参数自动获取主前端的语言设置
  - 所有界面文本已完成翻译
  
### 改进
- 🌐 所有视图组件已迁移到 vue-i18n
  - UserList.vue - 用户列表
  - UserForm.vue - 用户表单
  - InvitationList.vue - 邀请列表
  - Register.vue - 用户注册
  - App.vue - 应用布局

### 技术细节
- 📦 添加 vue-i18n v11 依赖
- 🗂️ 创建完整的语言包结构
- 📝 添加 I18N.md 文档说明多语言使用方法

### 文件变更
- 新增: `src/i18n/index.ts`
- 新增: `src/i18n/locales/zh-CN.ts`
- 新增: `src/i18n/locales/zh-TW.ts`
- 新增: `src/i18n/locales/en-US.ts`
- 新增: `src/i18n/locales/ja-JP.ts`
- 新增: `src/i18n/locales/th-TH.ts`
- 新增: `I18N.md`
- 修改: `src/main.ts` - 集成 i18n
- 修改: `package.json` - 添加 vue-i18n 依赖
- 修改: 所有视图组件 - 使用 t() 函数替换硬编码文本

## 使用方法

插件会自动从 URL 参数中读取语言设置：
```
http://localhost:5173/?lang=en-US
```

在主前端中使用时，语言会自动同步。
