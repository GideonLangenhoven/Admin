import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e", testMatch: "web-chat-production.spec.ts", workers: 1, fullyParallel: false,
  timeout: 60_000, expect: { timeout: 10_000 }, reporter: [["list"], ["json", { outputFile: "/private/tmp/capekayak-web-chat-browser-results.json" }]],
  outputDir: "/private/tmp/capekayak-web-chat-browser-results",
  webServer: [
    { command: "node --experimental-strip-types tests/helpers/web-chat-server.ts", url: "http://127.0.0.1:3094/__fixture/state", reuseExistingServer: false, timeout: 120_000 },
    { command: "node --experimental-strip-types tests/helpers/web-chat-preview.ts", url: "http://127.0.0.1:3093", reuseExistingServer: false, timeout: 180_000 },
  ],
  use: { baseURL: "http://127.0.0.1:3093", serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chrome-phone", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", channel: "chrome", permissions: ["local-network-access"] } },
    { name: "webkit-phone", use: { ...devices["iPhone 13"] } },
    { name: "chrome-desktop", use: { ...devices["Desktop Chrome"], channel: "chrome", permissions: ["local-network-access"] } },
  ],
});
