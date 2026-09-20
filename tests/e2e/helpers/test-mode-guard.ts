import { Page, expect } from "@playwright/test";

export async function assertAdminTestModeOn(
  page: Page,
  adminUrl: string,
  email: string,
  password: string,
) {
  const login = await page.request.post(adminUrl + "/api/admin/login", {
    data: { email, password },
    timeout: 30_000,
  });
  expect(login.ok(), "Dedicated test administrator must sign in").toBeTruthy();
  const identity = await login.json();
  expect(identity.admin?.role, "Use a tenant owner, not platform-wide access").toBe("MAIN_ADMIN");
  const credentials = await page.request.get(adminUrl + "/api/credentials?business_id=" + identity.admin.business_id, {
    headers: { Authorization: "Bearer " + identity.session.access_token },
  });
  expect(credentials.ok()).toBeTruthy();
  expect(await credentials.json(), "Both Yoco TEST credentials and test mode are required").toMatchObject({ yoco_test: true, yoco_test_mode: true });
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
  return identity.admin.business_id as string;
}
