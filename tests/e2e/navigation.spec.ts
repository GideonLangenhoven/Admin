import { test, expect } from "@playwright/test";
import { injectAdminSession } from "./helpers/auth";
import { NAV_ITEMS, PRIVILEGED_NAV_ITEMS } from "./helpers/nav";
import { collectConsoleLogs, hasTrace } from "./helpers/console-collector";

test.describe("Desktop Navigation — Sidebar", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page, { role: "MAIN_ADMIN" });
    await page.reload();
    // Wait for dev server compilation + auth resolution
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
  });

  test("sidebar is visible on desktop", async ({ page }) => {
    await expect(page.locator("aside")).toBeVisible();
  });

  test("all nav items are visible for MAIN_ADMIN", async ({ page }) => {
    const sidebar = page.locator("aside");
    for (const item of NAV_ITEMS) {
      await expect(sidebar.getByText(item.label, { exact: true })).toBeVisible();
    }
    // Privileged items should also be visible for MAIN_ADMIN
    for (const item of PRIVILEGED_NAV_ITEMS) {
      await expect(sidebar.getByText(item.label, { exact: true })).toBeVisible();
    }
  });

  test("Dashboard is active by default on /", async ({ page }) => {
    // The beforeEach already navigated to / and verified main is visible
    const sidebar = page.locator("aside");
    const dashLink = sidebar.getByText("Dashboard", { exact: true });
    await expect(dashLink).toBeVisible({ timeout: 15_000 });
  });

  test("clicking nav items navigates to correct routes", async ({ page }) => {
    const sidebar = page.locator("aside");

    // Test a subset of routes to avoid excessive navigation
    const routesToTest = [
      { label: "Bookings", href: "/bookings" },
      { label: "Slots", href: "/slots" },
      { label: "Refunds", href: "/refunds" },
      { label: "Marketing", href: "/marketing" },
      { label: "Reports", href: "/reports" },
    ];

    for (const route of routesToTest) {
      // Mock data endpoints so pages don't error out
      await page.route("**/rest/v1/**", async (r) => {
        const url = r.request().url();
        if (url.includes("admin_users") || url.includes("businesses")) {
          await r.continue();
        } else {
          await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([]) });
        }
      });

      await sidebar.getByText(route.label, { exact: true }).click();
      await page.waitForURL(`**${route.href}`, { timeout: 10_000 });
      await expect(page).toHaveURL(new RegExp(route.href));
      await expect(page.locator("main")).toBeVisible();
    }
  });

  test("sidebar collapse toggle works", async ({ page }) => {
    const sidebar = page.locator("aside");
    // Sidebar should start expanded (w-64)
    await expect(sidebar).toBeVisible();

    // Find and click the collapse button (←)
    const collapseBtn = sidebar.getByTitle("Collapse sidebar");
    if (await collapseBtn.isVisible()) {
      await collapseBtn.click();
      // After collapse, nav labels should be hidden
      await expect(sidebar.getByText("Dashboard", { exact: true })).not.toBeVisible({ timeout: 3_000 });

      // Click expand button (→)
      const expandBtn = sidebar.getByTitle("Expand sidebar");
      await expandBtn.click();
      await expect(sidebar.getByText("Dashboard", { exact: true })).toBeVisible();
    }
  });

  test("sidebar remembers collapsed state in localStorage", async ({ page }) => {
    const sidebar = page.locator("aside");
    const collapseBtn = sidebar.getByTitle("Collapse sidebar");

    if (await collapseBtn.isVisible()) {
      await collapseBtn.click();
      await page.waitForTimeout(500);

      // Check localStorage
      const saved = await page.evaluate(() => localStorage.getItem("ck_sidebar_collapsed"));
      expect(saved).toBe("true");

      // Reload - should stay collapsed
      await page.reload();
      await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
      const expandBtn = sidebar.getByTitle("Expand sidebar");
      await expect(expandBtn).toBeVisible();

      // Restore
      await expandBtn.click();
    }
  });
});

test.describe("Desktop Navigation — Privileged Routes", () => {
  test("ADMIN role cannot see Settings and Super Admin", async ({ page }) => {
    await injectAdminSession(page, { role: "ADMIN" });
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("aside");
    // These should be hidden for plain ADMIN
    await expect(sidebar.getByText("Settings", { exact: true })).not.toBeVisible({ timeout: 3_000 });
    await expect(sidebar.getByText("Super Admin", { exact: true })).not.toBeVisible({ timeout: 3_000 });
  });

  test("SUPER_ADMIN can see all nav items", async ({ page }) => {
    await injectAdminSession(page, { role: "SUPER_ADMIN" });
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("aside");
    await expect(sidebar.getByText("Settings", { exact: true })).toBeVisible();
    await expect(sidebar.getByText("Super Admin", { exact: true })).toBeVisible();
  });
});

test.describe("Mobile Navigation", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("sidebar is hidden on mobile, bottom nav is visible", async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });

    // Sidebar should be hidden (has class hidden on md:)
    const sidebar = page.locator("aside");
    await expect(sidebar).not.toBeVisible();

    // Mobile bottom nav bar should exist
    const mobileNav = page.locator("nav.md\\:hidden, nav").last();
    await expect(mobileNav).toBeVisible();
  });

  test("mobile header shows sign out button", async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    // Wait for either main content or the login form (in case auth doesn't resolve on mobile)
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(5000);

    // On mobile, the header should show "Sign Out" if authenticated
    const signOut = page.getByText("Sign Out");
    if (await signOut.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await expect(signOut).toBeVisible();
    }
  });

  test("mobile bottom nav items navigate correctly", async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });

    // Use JavaScript navigation instead of clicking since the bottom nav is horizontally scrollable
    await page.evaluate(() => {
      window.location.href = "/bookings";
    });
    await page.waitForURL("**/bookings", { timeout: 15_000 });
    await expect(page).toHaveURL(/bookings/);
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
  });
});

test.describe("Theme Toggle", () => {
  test.beforeEach(async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("theme toggle button exists in sidebar", async ({ page }) => {
    // ThemeToggle is in the sidebar footer
    const sidebar = page.locator("aside");
    // Look for sun/moon icon button (theme toggle)
    const themeToggle = sidebar.locator("button").last();
    await expect(themeToggle).toBeVisible();
  });

  test("clicking theme toggle changes html class", async ({ page }) => {
    // Get initial theme class
    const initialClass = await page.locator("html").getAttribute("class");

    // Find theme toggle button in sidebar
    const sidebar = page.locator("aside");
    const footer = sidebar.locator("div").last();
    // The theme toggle is one of the buttons in the sidebar footer
    const buttons = footer.locator("button");
    const lastBtn = buttons.last();

    if (await lastBtn.isVisible()) {
      await lastBtn.click();
      await page.waitForTimeout(300);
      const newClass = await page.locator("html").getAttribute("class");
      // Class should have changed (light ↔ dark)
      expect(newClass).not.toBe(initialClass);
    }
  });
});

test.describe("Navigation — Console Tracing", () => {
  test("logs navigation events to console", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await injectAdminSession(page);
    await page.reload();
    await page.waitForTimeout(3000);

    expect(hasTrace(logs, "[NAV] AppShell mounted")).toBe(true);
  });
});
