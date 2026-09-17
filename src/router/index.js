import { createRouter, createWebHistory } from 'vue-router'
import { useTokenStore } from '@/stores/tokenStore'
import { useAuthStore } from '@/stores/auth'

const routes = [
  {
    name: 'DefaultLayout',
    path: '/admin',
    component: () => import('@/layout/DefaultLayout.vue'),
    children: [
      {
        path: 'pushing-levels',
        name: 'PushingLevels',
        component: () => import('@/views/PushingLevels.vue'),
        meta: { title: '主线推关', requiresToken: true },
      },
      {
        path: 'batch-daily-tasks',
        name: 'BatchDailyTasks',
        component: () => import('@/views/BatchDailyTasks.vue'),
        meta: { title: '批量日常', requiresToken: true },
      },
    ],
  },
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/Login.vue'),
    meta: { title: '登录' },
  },
  {
    path: '/register',
    name: 'Register',
    component: () => import('@/views/Register.vue'),
    meta: { title: '注册' },
  },
  // 所有旧路由重定向到主线推关
  { path: '/', redirect: '/admin/pushing-levels' },
  { path: '/tokens', redirect: '/admin/pushing-levels' },
  { path: '/admin/dashboard', redirect: '/admin/pushing-levels' },
  { path: '/admin/game-features', redirect: '/admin/pushing-levels' },
  { path: '/admin/PushingLevels', redirect: '/admin/pushing-levels' },
  { path: '/admin/daily-tasks', redirect: '/admin/batch-daily-tasks' },
  { path: '/admin/message-test', redirect: '/admin/pushing-levels' },
  { path: '/admin/profile', redirect: '/admin/pushing-levels' },
  { path: '/game-roles', redirect: '/admin/pushing-levels' },
  {
    path: '/:pathMatch(.*)*',
    name: 'NotFound',
    component: () => import('@/views/NotFound.vue'),
    meta: { title: '页面不存在' },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, from, savedPosition) {
    return savedPosition || { top: 0 }
  },
})

// 导航守卫
router.beforeEach((to, from, next) => {
  const authStore = useAuthStore()
  const tokenStore = useTokenStore()

  document.title = to.meta.title ? `${to.meta.title} - XYZW` : 'XYZW'

  const publicPages = ['/login', '/register']
  const isPublicPage = publicPages.includes(to.path)

  if (!authStore.isAuthenticated && !isPublicPage) {
    next('/login')
    return
  }

  if (authStore.isAuthenticated && isPublicPage) {
    next('/admin/pushing-levels')
    return
  }

  if (to.meta.requiresToken && !tokenStore.hasTokens) {
    // 没有 token 时仍然进入页面，页面内会提示添加 token
    next()
    return
  }

  next()
})

export default router
