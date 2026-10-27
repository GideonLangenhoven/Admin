import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'claires-hiking-landing.spec.ts',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: { baseURL: process.env.CLAIRES_HIKING_URL || 'http://127.0.0.1:8765', browserName: 'chromium' },
  webServer: process.env.CLAIRES_HIKING_URL ? undefined : {
    command: 'python3 -m http.server 8765 --bind 127.0.0.1 --directory public',
    url: 'http://127.0.0.1:8765',
    reuseExistingServer: true,
  },
});
