<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

const apiBaseUrl = computed(() => import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4220/api/v1');
const apiOrigin = computed(() => import.meta.env.VITE_API_ORIGIN ?? new URL(apiBaseUrl.value).origin);
const oauthProviders = ref<string[]>([]);
const googleOauthUrl = computed(() => {
  if (typeof window === 'undefined') {
    return '#';
  }

  return `${apiOrigin.value}/api/v1/auth/oauth/google/start?redirectTo=${encodeURIComponent(`${window.location.origin}/oauth/callback`)}`;
});

onMounted(async () => {
  const response = await fetch(`${apiBaseUrl.value}/bootstrap`);
  if (!response.ok) {
    return;
  }

  const body = (await response.json()) as { oauthProviders?: string[] };
  oauthProviders.value = body.oauthProviders ?? [];
});
</script>

<template>
  <main class="marketing-shell">
    <section class="hero-panel">
      <p class="eyebrow">VitalSpace Remake</p>
      <h1>Sales and lettings workspaces are ready for the first operational slice.</h1>
      <p class="hero-copy">
        The platform now has shared cases, workflow progression, communications, files, and
        reporting primitives. The next step is proving staff can work real sales and lettings
        flows in the browser.
      </p>
      <div class="hero-actions">
        <RouterLink class="primary-link" to="/workspace/sales">Open Sales Workspace</RouterLink>
        <RouterLink class="ghost-button" to="/workspace/lettings">
          Open Lettings Workspace
        </RouterLink>
        <RouterLink class="ghost-button" to="/pilot-readiness">
          Open Pilot Readiness
        </RouterLink>
        <RouterLink class="ghost-button" to="/explorer">Open Property Explorer</RouterLink>
        <a
          v-if="oauthProviders.includes('google')"
          class="ghost-button"
          :href="googleOauthUrl"
        >
          Continue with Google
        </a>
      </div>
      <p class="hero-meta">API base: {{ apiBaseUrl }}</p>
    </section>

    <section class="status-grid">
      <article class="status-card">
        <h2>What This Slice Proves</h2>
        <ul>
          <li>Tenant-scoped sales and lettings dashboards, lists, and detail flows</li>
          <li>Case actions for notes, communications, files, offers, applications, and workflow</li>
          <li>Operational reporting visible in the same workspace staff use day to day</li>
        </ul>
      </article>
      <article class="status-card">
        <h2>Next After This</h2>
        <ul>
          <li>Run side-by-side pilot flows and close the blocking parity gaps only</li>
          <li>Harden the sales and lettings workspaces with feedback from real users</li>
          <li>Move deeper into reporting, migration tooling, and provider hardening</li>
        </ul>
      </article>
    </section>
  </main>
</template>
