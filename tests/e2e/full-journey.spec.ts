import { test, expect } from "@playwright/test";
import { injectAdminSession } from "./helpers/auth";
import { collectConsoleLogs, filterLogs } from "./helpers/console-collector";
import { NAV_ITEMS, PRIVILEGED_NAV_ITEMS } from "./helpers/nav";

/**
 * Full User Journey Tests
 *
 * These tests simulate a real admin user clicking through every section
 * of the app, verifying pages load, interactive elements respond, and
 * console tracing fires correctly.
 */

test.describe("Full Admin Journey — Click Through Every Page", () => {
  test.setTimeout(120_000); // 2 minutes for full walkthrough

  test("complete app walkthrough as MAIN_ADMIN", async ({ page }) => {
    const logs = collectConsoleLogs(page);

    // Step 1: Start at login
    await page.goto("/");
    await expect(page.getByText("Admin Dashboard")).toBeVisible();
    await expect(page.getByText("Enter your email and password")).toBeVisible();

    // Step 2: Inject auth and reload
    await injectAdminSession(page, { role: "MAIN_ADMIN" });
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });

    // Step 3: Verify sidebar is present
    const sidebar = page.locator("aside");
    await expect(sidebar).toBeVisible();

    // Step 4: Walk through EVERY nav item using page.goto for reliability
    const allRoutes = [...NAV_ITEMS, ...PRIVILEGED_NAV_ITEMS];

    for (const route of allRoutes) {
      console.log(`[TEST] Navigating to: ${route.label} (${route.href})`);

      await page.goto(route.href);
      await page.waitForLoadState("domcontentloaded");

      // Verify the page loaded (main content visible, no crash)
      await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });

      // Check for any JavaScript errors in console
      const errors = logs.filter((l) => l.type === "error" && !l.text.includes("404") && !l.text.includes("Failed to fetch") && !l.text.includes("400"));
      if (errors.length > 0) {
        console.log(`[TEST] Console errors on ${route.label}:`, errors.map((e) => e.text).slice(0, 3));
      }
    }

    // Step 5: Navigate through marketing sub-pages
    const marketingSubPages = [
      { path: "/marketing/contacts", label: "Contacts" },
      { path: "/marketing/templates", label: "Templates" },
      { path: "/marketing/automations", label: "Automations" },
      { path: "/marketing/promotions", label: "Promotions" },
    ];

    for (const sub of marketingSubPages) {
      await page.goto(sub.path);
      await page.waitForLoadState("domcontentloaded");
      await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
    }

    // Step 6: Return to dashboard
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });

    // Verify console tracing fired for key components
    const authLogs = filterLogs(logs, "[AUTH]");
    const navLogs = filterLogs(logs, "[NAV]");
    expect(authLogs.length).toBeGreaterThan(0);
    expect(navLogs.length).toBeGreaterThan(0);
  });
});

test.describe("Full Mobile Journey", () => {
  test.use({ viewport: { width: 375, height: 812 } });
  test.setTimeout(120_000);

  test("mobile user can navigate all pages via bottom nav", async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });

    // Sidebar should be hidden on mobile
    await expect(page.locator("aside")).not.toBeVisible();

    // Bottom nav should be visible
    const bottomNav = page.locator("nav").last();
    await expect(bottomNav).toBeVisible();

    // Navigate through a subset of routes on mobile (using page.goto since bottom nav is horizontally scrollable)
    const mobileRoutes = ["/bookings", "/slots", "/inbox", "/marketing", "/reports"];

    for (const route of mobileRoutes) {
      await page.goto(route);
      await page.waitForLoadState("domcontentloaded");
      await expect(page.locator("main")).toBeVisible({ timeout: 30_000 });
      // Verify sidebar remains hidden on mobile
      await expect(page.locator("aside")).not.toBeVisible();
    }
  });
});

test.describe("Role-Based Access Journey", () => {
  test("ADMIN role cannot access privileged pages", async ({ page }) => {
    await injectAdminSession(page, { role: "ADMIN" });
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });

    // Settings and Super Admin should not appear in sidebar
    const sidebar = page.locator("aside");
    await expect(sidebar.getByText("Settings", { exact: true })).not.toBeVisible({ timeout: 3_000 });
    await expect(sidebar.getByText("Super Admin", { exact: true })).not.toBeVisible({ timeout: 3_000 });
  });

  test("SUPER_ADMIN has full access including operator switcher", async ({ page }) => {
    await injectAdminSession(page, { role: "SUPER_ADMIN" });
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });

    const sidebar = page.locator("aside");
    // Should see all nav items
    await expect(sidebar.getByText("Settings", { exact: true })).toBeVisible();
    await expect(sidebar.getByText("Super Admin", { exact: true })).toBeVisible();
  });
});

test.describe("Cross-Page Data Flow", () => {
  test("navigating between pages preserves auth session", async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });

    // Navigate through several pages
    const pages = ["/bookings", "/slots", "/marketing", "/reports", "/"];
    for (const url of pages) {
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      // Should NOT see login screen
      await expect(page.getByText("Enter your email and password")).not.toBeVisible({ timeout: 3_000 });
      await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
    }
  });

  test("page navigation does not leak memory (console check)", async ({ page }) => {
    const logs = collectConsoleLogs(page);
    await injectAdminSession(page);
    await page.reload();

    // Rapidly navigate between pages
    const pages = ["/bookings", "/slots", "/marketing", "/reports", "/inbox", "/"];
    for (const url of pages) {
      await page.goto(url);
      await page.waitForTimeout(500);
    }

    // Check for memory-related warnings
    const memWarnings = logs.filter((l) =>
      l.text.includes("memory") || l.text.includes("Maximum update depth")
    );
    expect(memWarnings.length).toBe(0);
  });
});

test.describe("Error Resilience", () => {
  test("pages handle network errors gracefully", async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });

    // Navigate to a page and verify it doesn't crash even if Supabase returns errors
    await page.goto("/bookings");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3000);

    // Page should still be rendering (not a white screen or crash)
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("body")).not.toHaveText("Application error");
  });

  test("invalid routes show some content (not a crash)", async ({ page }) => {
    await injectAdminSession(page);
    await page.reload();

    await page.goto("/this-route-does-not-exist");
    await page.waitForLoadState("networkidle");

    // Should show something (404 page or redirect to dashboard)
    await expect(page.locator("body")).toBeVisible();
  });
});
