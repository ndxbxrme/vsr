import { defineConfig } from '@playwright/test';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? 'postgres://vitalspace:vitalspace@localhost:5432/vitalspace_test';

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
        DATABASE_URL: testDatabaseUrl,
        TEST_DATABASE_URL: testDatabaseUrl,
        API_PORT: '4320',
        APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY ?? '0123456789abcdef0123456789abcdef',
        GOOGLE_CLIENT_ID: 'playwright-google-client-id',
        GOOGLE_CLIENT_SECRET: 'playwright-google-client-secret',
        GOOGLE_AUTH_URL: 'http://127.0.0.1:4323/authorize',
        GOOGLE_TOKEN_URL: 'http://127.0.0.1:4323/token',
        GOOGLE_USERINFO_URL: 'http://127.0.0.1:4323/userinfo',
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
        DATABASE_URL: testDatabaseUrl,
        TEST_DATABASE_URL: testDatabaseUrl,
        WORKER_POLL_INTERVAL_MS: '250',
        WORKER_HEALTH_PORT: '4322',
      },
    },
    {
      command: 'pnpm exec tsx tests/e2e/mock-oidc-server.ts',
      port: 4323,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        OIDC_MOCK_PORT: '4323',
      },
    },
  ],
});
