<script setup lang="ts">
import { computed } from 'vue';

const apiBaseUrl = computed(() => import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:4220/api/v1');
</script>

<template>
  <main class="marketing-shell">
    <section class="hero-panel">
      <p class="eyebrow">VitalSpace Remake</p>
      <h1>Property sync is live enough to inspect real read models.</h1>
      <p class="hero-copy">
        The platform now normalizes Dezrez property, offer, viewing, and timeline data into shared
        app tables. The next step is validating that shape in the browser.
      </p>
      <div class="hero-actions">
        <RouterLink class="primary-link" to="/explorer">Open Property Explorer</RouterLink>
      </div>
      <p class="hero-meta">API base: {{ apiBaseUrl }}</p>
    </section>

    <section class="status-grid">
      <article class="status-card">
        <h2>What This Slice Proves</h2>
        <ul>
          <li>Tenant-scoped property list and detail reads</li>
          <li>Offers, viewings, and timeline exposed as first-class API resources</li>
          <li>Frontend validation without adding more provider-specific sync complexity</li>
        </ul>
      </article>
      <article class="status-card">
        <h2>Next After This</h2>
        <ul>
          <li>Refine the read models based on real usage</li>
          <li>Add richer role/property/owner enrichment only where the UI proves it is needed</li>
          <li>Bring realtime invalidation into the explorer and then into the actual workspace UI</li>
        </ul>
      </article>
    </section>
  </main>
</template>
