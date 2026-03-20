import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/register',
      name: 'Register',
      component: () => import('../views/Register.vue'),
      meta: { title: '邀请注册' }
    },
    {
      path: '/api-diagnostics',
      name: 'ApiDiagnostics',
      component: () => import('../views/ApiDiagnostics.vue'),
      meta: { title: 'API 诊断' }
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
          path: 'invitations',
          name: 'InvitationList',
          component: () => import('../views/InvitationList.vue'),
          meta: { title: '邀请管理' }
        },
      ]
    }
  ]
})

export default router
