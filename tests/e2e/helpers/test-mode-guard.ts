import { Page, expect } from "@playwright/test";

export async function assertAdminTestModeOn(
  page: Page,
  adminUrl: string,
  email: string,
  password: string,
) {
  const warmup = await page.request.post(adminUrl + "/api/admin/login", {
    data: { email, password },
    timeout: 30_000,
  }).catch(() => null);
  await page.goto(adminUrl + "/", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder(/email/i).fill(email);
  await page.getByPlaceholder(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();

  try {
    await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
  } catch {
    throw new Error("Admin login did not navigate to dashboard main area.");
  }

  const banner = page.getByText(/TEST MODE/i).first();
  await expect(
    banner,
    "ABORT: Admin must show TEST MODE banner before E2E tests can run. " +
      "Enable Yoco test mode in Settings → Credentials.",
  ).toBeVisible({ timeout: 8_000 });
}
