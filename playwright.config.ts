import { defineConfig } from '@playwright/test';

const databaseUrl =
  process.env.DATABASE_URL ?? 'postgres://vitalspace:vitalspace@localhost:5432/vitalspace';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:4321',
    trace: 'on-first-retry',
  },
  webServer: [
    {
      command: 'pnpm db:migrate && pnpm --filter @vitalspace/api dev',
      port: 4320,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        API_PORT: '4320',
      },
    },
    {
      command: 'pnpm --filter @vitalspace/web exec vite --host 127.0.0.1 --port 4321',
      port: 4321,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        VITE_API_BASE_URL: 'http://127.0.0.1:4320/api/v1',
        VITE_API_ORIGIN: 'http://127.0.0.1:4320',
      },
    },
    {
      command: 'pnpm exec tsx tests/e2e/worker-server.ts',
      port: 4322,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        WORKER_POLL_INTERVAL_MS: '250',
        WORKER_HEALTH_PORT: '4322',
      },
    },
  ],
});
