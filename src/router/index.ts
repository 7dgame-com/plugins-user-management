import { createRouter, createWebHistory } from 'vue-router'
import { ElMessage } from 'element-plus'
import { isInIframe } from '../utils/token'
import { usePermissions } from '../composables/usePermissions'

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    public?: boolean
    requiresPermission?: string
  }
}

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/register',
      name: 'Register',
      component: () => import('../views/Register.vue'),
      meta: { title: '邀请注册', public: true }
    },
    {
      path: '/api-diagnostics',
      name: 'ApiDiagnostics',
      component: () => import('../views/ApiDiagnostics.vue'),
      meta: { title: 'API 诊断', public: true }
    },
    {
      path: '/',
      component: () => import('../layout/AppLayout.vue'),
      redirect: '/users',
      children: [
        {
          path: 'users',
          name: 'UserList',
          component: () => import('../views/UserList.vue'),
          meta: { requiresPermission: 'list-users' }
        },
        {
          path: 'users/create',
          name: 'UserCreate',
          component: () => import('../views/UserForm.vue'),
          meta: { requiresPermission: 'create-user' }
        },
        {
          path: 'users/:id/edit',
          name: 'UserEdit',
          component: () => import('../views/UserForm.vue'),
          meta: { requiresPermission: 'update-user' }
        },
        {
          path: 'users/batch-create',
          name: 'BatchCreate',
          component: () => import('../views/BatchCreateForm.vue'),
          meta: { title: '批量创建用户', requiresPermission: 'create-user' }
        },
        {
          path: 'invitations',
          name: 'InvitationList',
          component: () => import('../views/InvitationList.vue'),
          meta: { title: '邀请管理', requiresPermission: 'manage-invitations' }
        },
        {
          path: 'organizations',
          name: 'OrganizationList',
          component: () => import('../views/OrganizationList.vue'),
          meta: { title: '组织管理', requiresPermission: 'manage-organizations' }
        },
      ]
    }
  ]
})

export function permissionGuard(
  to: { meta: { public?: boolean; requiresPermission?: string } },
  from: { name?: string | symbol | null | undefined }
): boolean | string {
  if (to.meta.public) return true

  const requiredPermission = to.meta.requiresPermission
  if (!requiredPermission) return true

  try {
    const { can } = usePermissions()
    if (can(requiredPermission as Parameters<typeof can>[0])) {
      return true
    }
    // 首次导航（from.name 为空）时直接放行，避免重定向回 '/' 产生无限循环
    // App.vue 的模板层会处理无 token / 无权限的展示
    if (!from.name) return true
    ElMessage.error('您没有权限访问此页面')
    return false
  } catch {
    ElMessage.error('权限验证失败，请稍后重试')
    if (!from.name) return true
    return false
  }
}

router.beforeEach(permissionGuard)

export default router
