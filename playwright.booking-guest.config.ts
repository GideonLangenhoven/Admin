import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e", testMatch: ["booking-guest.spec.ts", "booking-account-surfaces.spec.ts"], workers: 1, fullyParallel: false,
  timeout: 45_000, expect: { timeout: 10_000 }, reporter: [["list"]],
  outputDir: "/private/tmp/capekayak-booking-guest-results",
  webServer: [
    { command: "node tests/helpers/booking-guest-fixture.cjs", url: "http://127.0.0.1:3117/__fixture/state", reuseExistingServer: true },
    { command: "node tests/helpers/booking-guest-preview.mjs", url: "http://127.0.0.1:3116", reuseExistingServer: true, timeout: 120_000 },
  ],
  use: { baseURL: "http://127.0.0.1:3116", viewport: { width: 1366, height: 768 }, timezoneId: "Asia/Tokyo", serviceWorkers: "block", screenshot: "only-on-failure", trace: "retain-on-failure" },
});
