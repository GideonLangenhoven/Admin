import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "marketing-safety-mocked.spec.ts", workers: 1, retries: 0,
  reporter: "list", timeout: 60000,
  outputDir: ".vercel/marketing-safety-results",
  use: { baseURL: "http://127.0.0.1:" + (process.env.MARKETING_PREVIEW_PORT || 3156), browserName: "chromium", channel: "chrome", trace: "retain-on-failure" },
});
