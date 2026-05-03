import { test, expect } from "@playwright/test";
import { ADMIN_URL, BASE_URL } from "./helpers/env";

test.describe("Smoke", () => {
  test("booking site home renders with at least one tour", async ({ page }) => {
    await page.goto(BASE_URL + "/", { waitUntil: "networkidle" });
    // Tour cards render "Book Now" buttons once data loads from Supabase
    await expect(page.getByText(/book now/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test("chat widget opens and shows input", async ({ page }) => {
    await page.goto(BASE_URL + "/", { waitUntil: "networkidle" });
    // Dismiss cookie banner if visible
    var okBtn = page.getByRole("button", { name: "OK" });
    if (await okBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await okBtn.click();
    }
    var chatBtn = page.getByRole("button", { name: /open chat/i });
    await expect(chatBtn).toBeVisible({ timeout: 10_000 });
    await chatBtn.click();
    // Chat panel opens with a message input
    await expect(
      page.getByPlaceholder(/type a message/i),
    ).toBeVisible({ timeout: 10_000 });
  });

  test("change-password page renders", async ({ page }) => {
    await page.goto(ADMIN_URL + "/change-password");
    await expect(page.getByText(/forgot your password/i)).toBeVisible({ timeout: 10_000 });
    await expect(
      page.getByPlaceholder(/secure reset link/i),
    ).toBeVisible();
  });

  test("admin login screen renders", async ({ page }) => {
    await page.goto(ADMIN_URL + "/");
    await expect(page.getByRole("heading", { name: /admin dashboard/i })).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByPlaceholder(/email/i)).toBeVisible();
    await expect(page.getByPlaceholder(/password/i)).toBeVisible();
  });
});
