import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import './style.css';
import HomeView from './views/HomeView.vue';
import OAuthCallbackView from './views/OAuthCallbackView.vue';
import PilotReadinessView from './views/PilotReadinessView.vue';
import PropertyExplorerView from './views/PropertyExplorerView.vue';
import WorkflowLibraryView from './views/WorkflowLibraryView.vue';
import WorkspaceView from './views/WorkspaceView.vue';

const queryClient = new QueryClient();

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      component: HomeView,
    },
    {
      path: '/explorer',
      component: PropertyExplorerView,
    },
    {
      path: '/workspace/sales',
      component: WorkspaceView,
      props: {
        product: 'sales',
      },
    },
    {
      path: '/workspace/lettings',
      component: WorkspaceView,
      props: {
        product: 'lettings',
      },
    },
    {
      path: '/workflows/sales',
      component: WorkflowLibraryView,
      props: {
        product: 'sales',
      },
    },
    {
      path: '/workflows/lettings',
      component: WorkflowLibraryView,
      props: {
        product: 'lettings',
      },
    },
    {
      path: '/pilot-readiness',
      component: PilotReadinessView,
    },
    {
      path: '/oauth/callback',
      component: OAuthCallbackView,
    },
  ],
});

createApp(App).use(createPinia()).use(router).use(VueQueryPlugin, { queryClient }).mount('#app');
