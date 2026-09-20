import { expect, test, type Page } from "@playwright/test";
import { ADMIN_URL, BASE_URL } from "./helpers/env";

const ADMIN_EMAIL = process.env.MOBILE_TEST_ADMIN_EMAIL || "";
const ADMIN_PASSWORD = process.env.MOBILE_TEST_ADMIN_PASSWORD || "";
const EVIDENCE = "docs/qa/evidence/mobile-first";

const viewports = [
  { name: "phone-320x568", width: 320, height: 568 },
  { name: "phone-360x800", width: 360, height: 800 },
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "phone-430x932", width: 430, height: 932 },
  { name: "phone-landscape-844x390", width: 844, height: 390 },
  { name: "edge-767x900", width: 767, height: 900 },
  { name: "tablet-768x1024", width: 768, height: 1024 },
  { name: "edge-1023x900", width: 1023, height: 900 },
  { name: "tablet-1024x768", width: 1024, height: 768 },
  { name: "desktop-1440x900", width: 1440, height: 900 },
];

async function expectGeometry(page: Page) {
  const geometry = await page.evaluate(() => {
    const root = document.documentElement;
    const targets = [...document.querySelectorAll<HTMLElement>("button, input, select, textarea, nav a, a.btn, a.ui-btn")]
      .filter((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 50), width: rect.width, height: rect.height };
      });
    return {
      overflow: Math.max(root.scrollWidth, document.body.scrollWidth) - window.innerWidth,
      undersizedStandalone: window.innerWidth < 1024 ? targets.filter((target) => target.width < 44 || target.height < 44).slice(0, 20) : [],
    };
  });
  expect(geometry.overflow, `horizontal overflow: ${geometry.overflow}px`).toBeLessThanOrEqual(1);
  expect(geometry.undersizedStandalone, "visible standalone controls smaller than 44px").toEqual([]);
}

async function loginAdmin(page: Page) {
  await page.goto(ADMIN_URL + "/");
  await page.getByPlaceholder(/email/i).fill(ADMIN_EMAIL);
  await page.getByPlaceholder(/password/i).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
}

test.describe("customer mobile layout", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} has no page-wide overflow`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(BASE_URL + "/", { waitUntil: "networkidle" });
      await expect(page.locator('[data-shot="tour-card"]').first()).toBeVisible();
      await expectGeometry(page);
      await page.screenshot({ path: `${EVIDENCE}/customer-home-${viewport.name}.png`, fullPage: true });
    });
  }

  test("booking bar, calendar and short-screen chat stay contained", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(BASE_URL + "/", { waitUntil: "networkidle" });
    await page.locator('[data-shot="tour-card"]').first().click();
    await expect(page.locator('[data-mobile-booking-bar="calendar"]')).toBeVisible();
    await expect(page.locator('.glass-bottom-nav')).toHaveCount(0);
    const dayTargets = await page.locator('[data-shot="calendar-day"]').evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().width));
    expect(Math.min(...dayTargets)).toBeGreaterThanOrEqual(44);
    await expectGeometry(page);
    await page.screenshot({ path: `${EVIDENCE}/customer-book-calendar-320x568.png` });

    await page.getByRole("button", { name: /open chat/i }).click();
    const dialog = page.getByRole("dialog", { name: /assistant/i });
    await expect(dialog).toBeVisible();
    const chatBox = await dialog.boundingBox();
    expect(chatBox?.y).toBeGreaterThanOrEqual(0);
    expect((chatBox?.y || 0) + (chatBox?.height || 0)).toBeLessThanOrEqual(568);
    await expect(page.getByLabel(/chat message/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /close chat/i })).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/customer-chat-320x568.png` });
    await page.getByRole("button", { name: /close chat/i }).click();
    await expect(page.getByRole("button", { name: /open chat/i })).toBeFocused();
  });

  test("My Bookings retains ordinary site navigation", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BASE_URL + "/my-bookings", { waitUntil: "networkidle" });
    await expect(page.locator('.glass-bottom-nav')).toBeVisible();
    await expect(page.locator('[data-mobile-booking-bar]')).toHaveCount(0);
  });
});

test.describe("admin mobile layout", () => {
  test.skip(!ADMIN_EMAIL || !ADMIN_PASSWORD, "Requires an isolated MOBILE_TEST_ADMIN account; never use production credentials.");

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAdmin(page);
  });

  test("five destinations and focus-safe More navigation", async ({ page }) => {
    const nav = page.getByRole("navigation", { name: "Primary" });
    await expect(nav.getByText("Today", { exact: true })).toBeVisible();
    await expect(nav.getByText("Bookings", { exact: true })).toBeVisible();
    await expect(nav.getByText("New Booking", { exact: true })).toBeVisible();
    await expect(nav.getByText("Inbox", { exact: true })).toBeVisible();
    await expect(nav.getByText("More", { exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "More navigation" })).toHaveCount(0);
    const trigger = page.getByRole("button", { name: "More navigation" });
    await trigger.click();
    await expect(page.getByRole("dialog", { name: "More navigation" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "More navigation" })).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expectGeometry(page);
  });

  test("Today exposes the first departure before revenue", async ({ page }) => {
    const manifest = page.getByRole("heading", { name: "Manifest" });
    await expect(manifest).toBeVisible();
    const revenue = page.getByRole("heading", { name: "Revenue" });
    const manifestBox = await manifest.boundingBox();
    const revenueBox = await revenue.boundingBox();
    expect(manifestBox?.y).toBeLessThan(revenueBox?.y || Infinity);
    await page.screenshot({ path: `${EVIDENCE}/admin-today-390x844.png` });
  });

  test("bookings expose complete guest and departure sheets", async ({ page }) => {
    await page.getByText("Bookings", { exact: true }).last().click();
    await page.getByRole("button", { name: /view guests/i }).first().click();
    await page.getByRole("button", { name: "Guest actions" }).first().click();
    const sheet = page.locator('[data-mobile-action-sheet]');
    await expect(sheet).toBeVisible();
    for (const label of ["View booking", "Edit booking", "WhatsApp", "Rebook", "Mark Paid", "Payment Link", "Payment Reminder", "Refund", "Resend Invoice", "Cancel"]) {
      await expect(sheet.getByRole("button", { name: new RegExp(label, "i") })).toBeVisible();
    }
    await page.screenshot({ path: `${EVIDENCE}/admin-guest-actions-390x844.png` });
  });
});
