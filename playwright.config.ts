import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  timeout: 60_000,
  expect: { timeout: 15_000 },

  use: {
    // Relative page.goto() calls in the specs target the ADMIN app; the
    // customer booking site is always addressed explicitly via helpers/env
    // BASE_URL. (The old default pointed baseURL at a deleted tenant's
    // booking site, which silently ran every admin spec against the wrong app.)
    baseURL: process.env.ADMIN_URL || "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  ],
});
