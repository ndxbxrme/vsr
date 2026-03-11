import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import './style.css';
import HomeView from './views/HomeView.vue';
import PropertyExplorerView from './views/PropertyExplorerView.vue';

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
  ],
});

createApp(App).use(createPinia()).use(router).use(VueQueryPlugin, { queryClient }).mount('#app');
