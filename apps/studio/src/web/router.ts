import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
  type RouterHistory,
} from 'vue-router';
import DashboardView from '#web/views/DashboardView.vue';
import PlaceholderView from '#web/views/PlaceholderView.vue';

declare module 'vue-router' {
  interface RouteMeta {
    /** Page heading and left-nav label. */
    title: string;
  }
}

/** Top-level pages, in left-nav order. The nav is generated from this list. */
export const routes = [
  { path: '/', name: 'dashboard', component: DashboardView, meta: { title: 'Dashboard' } },
  { path: '/runs', name: 'runs', component: PlaceholderView, meta: { title: 'Runs' } },
  { path: '/assets', name: 'assets', component: PlaceholderView, meta: { title: 'Assets' } },
  {
    path: '/references',
    name: 'references',
    component: PlaceholderView,
    meta: { title: 'References' },
  },
  { path: '/memory', name: 'memory', component: PlaceholderView, meta: { title: 'Memory' } },
  { path: '/settings', name: 'settings', component: PlaceholderView, meta: { title: 'Settings' } },
] satisfies RouteRecordRaw[];

export function createAppRouter(history: RouterHistory = createWebHistory()) {
  return createRouter({
    history,
    routes: [...routes, { path: '/:pathMatch(.*)*', redirect: '/' }],
  });
}
