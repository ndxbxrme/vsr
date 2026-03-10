import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { createPinia } from 'pinia';
import { io } from 'socket.io-client';
import { createApp, h, resolveComponent } from 'vue';
import { createRouter, createWebHistory } from 'vue-router';

const config = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4220/api/v1',
  apiOrigin: import.meta.env.VITE_API_ORIGIN ?? 'http://localhost:4220',
};
const queryClient = new QueryClient();

const routes = [
  {
    path: '/',
    component: {
      render: () =>
        h('main', { class: 'page' }, [
          h('h1', 'VitalSpace'),
          h('p', `API: ${config.apiBaseUrl}`),
          h('p', 'Milestone A foundation is in place.'),
        ]),
    },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

const socket = io(config.apiOrigin, {
  autoConnect: false,
});

const Root = {
  setup() {
    socket.connect();
    return () => h(resolveComponent('RouterView'));
  },
};

createApp(Root).use(createPinia()).use(router).use(VueQueryPlugin, { queryClient }).mount('#app');
