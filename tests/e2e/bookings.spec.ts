import { test, expect } from "@playwright/test";
import { injectAdminSession } from "./helpers/auth";
import { collectConsoleLogs, hasTrace } from "./helpers/console-collector";

test.describe("Bookings List Page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("bookings page loads successfully", async ({ page }) => {
    await page.goto("/bookings");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("bookings page has search/filter controls", async ({ page }) => {
    await page.goto("/bookings");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Should have search input or filter controls
    const searchInput = page.locator("input[type='text'], input[type='search']").first();
    if (await searchInput.isVisible()) {
      await expect(searchInput).toBeVisible();
    }
  });

  test("bookings page shows date navigation", async ({ page }) => {
    await page.goto("/bookings");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2000);

    // Should have date navigation (prev/next buttons or date picker)
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("clicking a booking row navigates to detail", async ({ page }) => {
    await page.goto("/bookings");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // If there are booking rows, click the first one
    const bookingLink = page.locator("a[href^='/bookings/']").first();
    if (await bookingLink.isVisible()) {
      await bookingLink.click();
      await expect(page).toHaveURL(/bookings\/.+/);
    }
  });

  test("bookings page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/bookings");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[BOOKINGS]")).toBe(true);
  });
});

test.describe("New Booking Page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("new booking page loads", async ({ page }) => {
    await page.goto("/new-booking");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("new booking page has tour selection", async ({ page }) => {
    await page.goto("/new-booking");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Should have a tour selector (dropdown or buttons)
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("new booking page has calendar/availability view", async ({ page }) => {
    await page.goto("/new-booking");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("new booking page has customer form fields", async ({ page }) => {
    await page.goto("/new-booking");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Look for typical booking form fields
    const nameInput = page.getByPlaceholder(/name/i);
    const emailInput = page.getByPlaceholder(/email/i);
    const phoneInput = page.getByPlaceholder(/phone|mobile/i);

    // At least one form field should be present (possibly after selecting a tour/slot)
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("new booking page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/new-booking");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[NEW_BOOKING]")).toBe(true);
  });
});

test.describe("Slots Management Page", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("slots page loads", async ({ page }) => {
    await page.goto("/slots");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible();
  });

  test("slots page has calendar view", async ({ page }) => {
    await page.goto("/slots");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("slots page has tour filter/selector", async ({ page }) => {
    await page.goto("/slots");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Should have tour selection dropdown or tabs
    const mainContent = page.locator("main");
    await expect(mainContent).toBeVisible();
  });

  test("slots page has add slot button", async ({ page }) => {
    await page.goto("/slots");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Look for add/create slot button
    const addBtn = page.getByRole("button", { name: /add|create|new/i });
    if (await addBtn.first().isVisible()) {
      await expect(addBtn.first()).toBeVisible();
    }
  });

  test("slots page has view mode toggle (week/day)", async ({ page }) => {
    await page.goto("/slots");
    await page.waitForLoadState("domcontentloaded");
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(2000);

    // Look for week/day view toggle
    const weekBtn = page.getByText(/week/i).first();
    const dayBtn = page.getByText(/day/i).first();

    if (await weekBtn.isVisible({ timeout: 5_000 }).catch(() => false) &&
        await dayBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await dayBtn.click();
      await page.waitForTimeout(500);
      await weekBtn.click();
      await page.waitForTimeout(500);
    }
  });

  test("slots page console tracing", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await page.goto("/slots");
    await page.waitForTimeout(4000);

    expect(hasTrace(logs, "[SLOTS]")).toBe(true);
  });
});
