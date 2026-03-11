<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

const route = useRoute();
const router = useRouter();
const message = ref('Completing sign-in...');

onMounted(async () => {
  const accessToken = route.query.accessToken;
  if (typeof accessToken !== 'string' || accessToken.trim().length === 0) {
    message.value = 'OAuth callback did not include an access token.';
    return;
  }

  localStorage.setItem('vitalspace.explorer.accessToken', accessToken);
  message.value = 'Sign-in complete. Redirecting to the explorer...';
  await router.replace('/explorer');
});
</script>

<template>
  <main class="marketing-shell">
    <section class="hero-panel">
      <p class="eyebrow">OAuth Callback</p>
      <h1>{{ message }}</h1>
    </section>
  </main>
</template>
