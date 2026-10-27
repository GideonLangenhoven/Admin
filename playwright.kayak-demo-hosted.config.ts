import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e", testMatch: "kayak-demo-hosted.spec.ts", workers: 1,
  maxFailures: 1,
  timeout: 60_000, expect: { timeout: 15_000 },
  reporter: [["list"], ["json", { outputFile: "/private/tmp/capekayak-kayak-hosted-browser-results.json" }]],
  outputDir: "/private/tmp/capekayak-kayak-hosted-browser-results",
  use: { baseURL: process.env.KAYAK_DEMO_HOSTED_URL, storageState: process.env.KAYAK_DEMO_STORAGE_STATE, serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
    { name: "phone", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", channel: "chrome" } },
    { name: "webkit-phone", use: { ...devices["iPhone 13"] } },
  ],
});
