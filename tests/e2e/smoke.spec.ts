import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { ADMIN_URL, BASE_URL } from "./helpers/env";

async function gotoWithAbortRetry(page: Page, url: string, timeoutMs = 30_000) {
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  } catch (error) {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  }
}

test.describe("Smoke", () => {
  test.setTimeout(120_000);

  test("booking site home renders with at least one tour", async ({ page }) => {
    await gotoWithAbortRetry(page, BASE_URL + "/");
    // Tour cards expose accessible labels like "Book <tour name>"
    await expect(page.getByRole("button", { name: /^Book / })).toBeVisible({ timeout: 45_000 });
  });

  test("chat widget opens and shows input", async ({ page }) => {
    await gotoWithAbortRetry(page, BASE_URL + "/");
    // Dismiss cookie banner if visible
    const okBtn = page.getByRole("button", { name: /^OK$/ });
    const okVisible = await okBtn.isVisible({ timeout: 8_000 }).catch(() => false);
    if (okVisible) {
      await okBtn.click();
      await expect(okBtn).toBeHidden({ timeout: 5_000 });
    }
    const chatBtn = page.getByRole("button", { name: /open chat/i });
    await expect(chatBtn).toBeVisible({ timeout: 10_000 });
    const closeBtn = page.getByRole("button", { name: /close chat/i });
    let opened = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      await chatBtn.click({ timeout: 5_000 });
      const visible = await closeBtn.isVisible({ timeout: 3_000 }).catch(() => false);
      if (visible) {
        opened = true;
        break;
      }
      await page.waitForTimeout(250);
    }
    expect(opened).toBeTruthy();
    // Chat panel opens with a message input
    await expect(
      page.getByLabel(/chat message/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("change-password page renders", async ({ page }) => {
    await gotoWithAbortRetry(page, ADMIN_URL + "/change-password", 90_000);
    await expect(page.getByText(/forgot your password/i)).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByPlaceholder(/secure reset link/i),
    ).toBeVisible();
  });

  test("admin login screen renders", async ({ page }) => {
    await gotoWithAbortRetry(page, ADMIN_URL + "/", 90_000);
    await expect(page.getByRole("heading", { name: /admin dashboard/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByPlaceholder(/email/i)).toBeVisible();
    await expect(page.getByPlaceholder(/password/i)).toBeVisible();
  });
});
