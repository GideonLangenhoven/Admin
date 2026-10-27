import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e", testMatch: "dashboard-layout.spec.ts", workers: 1, timeout: 60_000,
  expect: { timeout: 15_000 }, reporter: "list",
  webServer: {
    command: "node tests/helpers/operator-preview.mjs", env: { OPERATOR_PREVIEW_LAYOUT_EDITOR: "1" },
    url: "http://127.0.0.1:3160", reuseExistingServer: false, timeout: 120_000,
  },
  use: { baseURL: "http://127.0.0.1:3160", viewport: { width: 1440, height: 1000 }, timezoneId: "Africa/Johannesburg" },
});
