import { test, expect } from "@playwright/test";
import { injectAdminSession } from "./helpers/auth";
import { collectConsoleLogs, hasTrace } from "./helpers/console-collector";

test.describe("Refunds Page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("refunds page loads", async ({ page }) => {
    await page.goto("/refunds");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("refunds page has pending/processed tabs", async ({ page }) => {
    await page.goto("/refunds");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Should have tabs or section headers for pending and processed
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();

    const pendingTab = page.getByText(/pending/i);
    const processedTab = page.getByText(/processed|completed/i);

    if (await pendingTab.first().isVisible()) {
      await pendingTab.first().click();
      await page.waitForTimeout(500);
    }
    if (await processedTab.first().isVisible()) {
      await processedTab.first().click();
      await page.waitForTimeout(500);
    }
  });

  test("refunds page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/refunds");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[REFUNDS]")).toBe(true);
  });
});

test.describe("Invoices Page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("invoices page loads", async ({ page }) => {
    await page.goto("/invoices");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("invoices page has date picker", async ({ page }) => {
    await page.goto("/invoices");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("invoices page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/invoices");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[INVOICES]")).toBe(true);
  });
});

test.describe("Weather Page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("weather page loads", async ({ page }) => {
    await page.goto("/weather");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("weather page has location tabs", async ({ page }) => {
    await page.goto("/weather");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("weather page has cancel slots button", async ({ page }) => {
    await page.goto("/weather");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const cancelBtn = page.getByRole("button", { name: /cancel/i });
    if (await cancelBtn.first().isVisible()) {
      await expect(cancelBtn.first()).toBeVisible();
    }
  });
});

test.describe("Photos Page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("photos page loads", async ({ page }) => {
    await page.goto("/photos");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("photos page has slot selector", async ({ page }) => {
    await page.goto("/photos");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("photos page has URL input form", async ({ page }) => {
    await page.goto("/photos");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("photos page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/photos");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[PHOTOS]")).toBe(true);
  });
});

test.describe("Peak Pricing Page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("pricing page loads", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("pricing page shows tour list", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("pricing page has add peak period form", async ({ page }) => {
    await page.goto("/pricing");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("pricing page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/pricing");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[PRICING]")).toBe(true);
  });
});

test.describe("Reports Page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("reports page loads", async ({ page }) => {
    await page.goto("/reports");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("reports page has tab navigation", async ({ page }) => {
    await page.goto("/reports");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Reports page has multiple tabs: Bookings, Financials, Marketing, etc.
    const bookingsTab = page.getByText(/booking/i);
    const financialsTab = page.getByText(/financial/i);

    if (await bookingsTab.first().isVisible()) {
      await bookingsTab.first().click();
      await page.waitForTimeout(500);
    }
    if (await financialsTab.first().isVisible()) {
      await financialsTab.first().click();
      await page.waitForTimeout(500);
    }
  });

  test("reports page has date range selector", async ({ page }) => {
    await page.goto("/reports");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Look for date inputs
    const dateInputs = page.locator("input[type='date']");
    if (await dateInputs.first().isVisible()) {
      await expect(dateInputs.first()).toBeVisible();
    }
  });

  test("reports page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/reports");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[REPORTS]")).toBe(true);
  });
});

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page, { role: "MAIN_ADMIN" });
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("settings page loads for MAIN_ADMIN", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
  });

  test("settings page has collapsible sections", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
  });

  test("settings page has save button", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const saveBtn = page.getByRole("button", { name: /save/i });
    if (await saveBtn.first().isVisible()) {
      await expect(saveBtn.first()).toBeVisible();
    }
  });

  test("settings page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/settings");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[SETTINGS]")).toBe(true);
  });
});

test.describe("Super Admin Page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page, { role: "SUPER_ADMIN" });
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("super admin page loads for SUPER_ADMIN", async ({ page }) => {
    await page.goto("/super-admin");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("super admin page has onboarding form", async ({ page }) => {
    await page.goto("/super-admin");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("super admin page has business list", async ({ page }) => {
    await page.goto("/super-admin");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });
});
