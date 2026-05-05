import { Page, expect } from "@playwright/test";

export async function assertAdminTestModeOn(
  page: Page,
  adminUrl: string,
  email: string,
  password: string,
) {
  await page.goto(adminUrl + "/", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder(/email/i).fill(email);
  await page.getByPlaceholder(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  await page.waitForSelector("main", { timeout: 15_000 });

  const banner = page.getByText(/TEST MODE/i).first();
  await expect(
    banner,
    "ABORT: Admin must show TEST MODE banner before E2E tests can run. " +
      "Enable Yoco test mode in Settings → Credentials.",
  ).toBeVisible({ timeout: 8_000 });
}
