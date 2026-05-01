import { test as setup, expect } from "@playwright/test";

/**
 * Global setup — runs once before all test suites.
 * Used to verify the dev server is responsive.
 */
setup("verify dev server is running", async ({ page, baseURL }) => {
  const url = baseURL || "http://localhost:3000";
  const response = await page.goto(url);
  if (!response || response.status() >= 500) {
    throw new Error(`Dev server returned status ${response?.status()}. Is it running on :3000?`);
  }
  await expect(page.locator("body")).toBeVisible({ timeout: 30_000 });
});
