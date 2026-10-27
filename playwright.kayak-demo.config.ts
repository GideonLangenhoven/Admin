import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e", testMatch: "kayak-demo.spec.ts", workers: 1, fullyParallel: false,
  timeout: 60_000, expect: { timeout: 10_000 }, reporter: [["list"]],
  outputDir: "/private/tmp/capekayak-kayak-demo-browser-results",
  webServer: [
    { command: "node tests/helpers/kayak-demo-server.mjs", url: "http://127.0.0.1:3107/__fixture/state", reuseExistingServer: false, timeout: 90_000 },
    { command: "node tests/helpers/kayak-demo-preview.mjs", url: "http://127.0.0.1:3106", reuseExistingServer: false, timeout: 180_000 },
  ],
  // A reused production build's CSP cannot allow the local fixture API port.
  // The final hosted page retains the production CSP, checked separately.
  use: { baseURL: "http://127.0.0.1:3106", bypassCSP: Boolean(process.env.KAYAK_DEMO_PREBUILT), serviceWorkers: "block", trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome", permissions: ["local-network-access"] } },
    { name: "phone", use: { ...devices["iPhone 13"], defaultBrowserType: "chromium", channel: "chrome", permissions: ["local-network-access"] } },
    { name: "webkit-phone", use: { ...devices["iPhone 13"] } },
  ],
});
