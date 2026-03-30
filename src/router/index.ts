import { createRouter, createWebHistory } from 'vue-router'
import { isInIframe } from '../utils/token'

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
          component: () => import('../views/UserList.vue')
        },
        {
          path: 'users/create',
          name: 'UserCreate',
          component: () => import('../views/UserForm.vue')
        },
        {
          path: 'users/:id/edit',
          name: 'UserEdit',
          component: () => import('../views/UserForm.vue')
        },
        {
          path: 'users/batch-create',
          name: 'BatchCreate',
          component: () => import('../views/BatchCreateForm.vue'),
          meta: { title: '批量创建用户' }
        },
        {
          path: 'invitations',
          name: 'InvitationList',
          component: () => import('../views/InvitationList.vue'),
          meta: { title: '邀请管理' }
        },
      ]
    }
  ]
})

router.beforeEach((to) => {
  if (to.meta.public) return true

  // 只拦截非 iframe 的直接访问，iframe 内的 token 等待由 App.vue 处理
  if (!isInIframe()) {
    // App.vue 会显示"请从主系统打开此插件"，路由正常放行
    return true
  }

  return true
})

export default router
