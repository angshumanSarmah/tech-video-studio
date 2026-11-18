import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from '#web/App.vue';
import { createAppRouter } from '#web/router.ts';
import './styles.css';

createApp(App).use(createPinia()).use(createAppRouter()).mount('#app');
