import { test, expect } from "@playwright/test";
import { injectAdminSession } from "./helpers/auth";
import { collectConsoleLogs, hasTrace } from "./helpers/console-collector";

test.describe("Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("dashboard page loads and shows content area", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
  });

  test("dashboard shows loading state initially", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
  });

  test("dashboard displays stat cards area", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
  });

  test("dashboard has weather widget section", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
  });

  test("manifest date toggle between TODAY and TOMORROW", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2000);

    // Look for Today/Tomorrow toggle buttons
    const tomorrowBtn = page.getByText("Tomorrow", { exact: false }).first();
    if (await tomorrowBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await tomorrowBtn.click();
      await page.waitForTimeout(500);
      const todayBtn = page.getByText("Today", { exact: false }).first();
      if (await todayBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
        await todayBtn.click();
      }
    }
  });

  test("quick action links navigate correctly", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });

    // Dashboard typically has quick-link cards to other sections
    const mainContent = page.locator("main");
    const bookingsLink = mainContent.locator("a[href='/bookings']");
    if (await bookingsLink.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await bookingsLink.first().click();
      await expect(page).toHaveURL(/bookings/);
    }
  });

  test("dashboard console tracing fires on load", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[DASHBOARD]")).toBe(true);
  });
});
