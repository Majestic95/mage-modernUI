import { defineConfig } from '@playwright/test';

/**
 * Slice 62 — local-only e2e smoke test config. Both servers
 * (WebApi on :18080, Vite on :5173) must be running before
 * `pnpm e2e`. No webServer auto-start because the WebApi
 * cold-start is ~75s; running it on every test invocation
 * would dominate iteration time. CI integration with
 * webServer auto-start is queued as slice 62b.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false, // single test for v1; serial avoids state collisions
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    headless: true,
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
});
