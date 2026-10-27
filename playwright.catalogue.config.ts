import { defineConfig, devices } from "@playwright/test";

// Catalogue checks stop at navigation. Both the backend and browser block
// every booking, checkout and notification submission.
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  expect: { timeout: 12_000 },
  testMatch: "booking-catalogue.spec.ts",
  globalSetup: "./tests/helpers/catalogue-photos.mjs",
  webServer: [
    { command: "node tests/helpers/catalogue-server.mjs", url: "http://127.0.0.1:3147/__fixture/state", reuseExistingServer: false },
    { command: "node tests/helpers/catalogue-preview.mjs guest", url: "http://127.0.0.1:3146", reuseExistingServer: false, timeout: 180_000 },
    { command: "node tests/helpers/catalogue-preview.mjs admin", url: "http://127.0.0.1:3148/settings", reuseExistingServer: false, timeout: 180_000 },
  ],
  use: { baseURL: "http://127.0.0.1:3146", timezoneId: "Africa/Johannesburg", serviceWorkers: "block", screenshot: "only-on-failure", trace: "retain-on-failure" },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"], permissions: ["local-network-access"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"], permissions: ["local-network-access"] } },
    { name: "mobile-webkit", use: { ...devices["iPhone 13"] } },
  ],
  timeout: 120_000,
  outputDir: "/private/tmp/capekayak-catalogue-browser-results",
  reporter: [["list"], ["json", { outputFile: "/private/tmp/capekayak-catalogue-browser.json" }]],
});
