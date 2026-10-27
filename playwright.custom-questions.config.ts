import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e", testMatch: "booking-custom-questions.spec.ts", workers: 1, fullyParallel: false,
  timeout: 60_000, expect: { timeout: 12_000 },
  reporter: [["list"], ["json", { outputFile: "/private/tmp/capekayak-custom-questions-browser.json" }]],
  outputDir: "/private/tmp/capekayak-custom-questions-browser-results",
  webServer: [
    { command: "node --experimental-strip-types tests/helpers/custom-questions-server.ts", url: "http://127.0.0.1:35237/__fixture/state", reuseExistingServer: false, stdout: "pipe" },
    { command: "node tests/helpers/custom-questions-preview.mjs guest", url: "http://127.0.0.1:35236", reuseExistingServer: false, timeout: 180_000, stdout: "pipe" },
    { command: "node tests/helpers/custom-questions-preview.mjs admin", url: "http://127.0.0.1:35238", reuseExistingServer: false, timeout: 180_000, stdout: "pipe" },
  ],
  use: { baseURL: "http://127.0.0.1:35236", timezoneId: "Africa/Johannesburg", serviceWorkers: "block", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"], permissions: ["local-network-access"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"], permissions: ["local-network-access"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
});
