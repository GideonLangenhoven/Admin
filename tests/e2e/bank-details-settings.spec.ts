import { test, expect, type Page } from "@playwright/test";

// M13: Settings asked for the banking details before it had read the admin's
// role, so a super-admin's request went without the target business header
// and bank-details refused it (403). The fields stayed empty with no sign of
// the failure, and a failed save showed "Edge Function returned a non-2xx
// status code".
const BUSINESS = "10000000-0000-4000-8000-000000000001";
const BANK = { account_owner: "Example Tours (Pty) Ltd", account_number: "070631824", account_type: "Current", bank_name: "Standard Bank", branch_code: "020909" };
type Answer = { status: number; json: unknown };

async function openBanking(page: Page, role: string, answers: { get?: Answer; set?: Answer } = {}, path = "/settings#invoice") {
  await page.addInitScript(r => {
    localStorage.setItem("ck_admin_role", r);
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  }, role);
  await page.routeWebSocket(/realtime/, () => {});
  const saved: Record<string, unknown>[] = [];
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    if (url.pathname === "/rest/v1/businesses" && req.method() === "PATCH") return route.fulfill({ status: 204 });
    if (url.pathname === "/functions/v1/bank-details" && req.method() === "POST") {
      const body = req.postDataJSON();
      const fixed = answers[body.action as "get" | "set"];
      if (fixed) return route.fulfill(fixed);
      // Like verifyAdmin: a super-admin must name the target business; a
      // tenant admin's business comes from their own account.
      if (role === "SUPER_ADMIN" && req.headers()["x-admin-business-id"] !== body.business_id) {
        return route.fulfill({ status: 403, json: { error: "Select the target business again" } });
      }
      if (body.action === "set") { saved.push(body); return route.fulfill({ json: { success: true } }); }
      return route.fulfill({ json: BANK });
    }
    return route.continue();
  });
  await page.goto(path);
  return { saved, owner: page.getByLabel("Account owner"), bankName: page.getByLabel("Bank name"), save: page.getByRole("button", { name: "Save invoice details" }) };
}

for (const role of ["SUPER_ADMIN", "MAIN_ADMIN"]) {
  test(`a ${role} loads and saves the banking details`, async ({ page }) => {
    const { saved, owner, bankName, save } = await openBanking(page, role);
    await expect(owner).toHaveValue(BANK.account_owner);
    await bankName.fill("FNB");
    await save.click();
    await expect(page.getByText("Invoice and banking details saved.")).toBeVisible();
    expect(saved).toEqual([expect.objectContaining({ business_id: BUSINESS, bank_name: "FNB", account_number: BANK.account_number })]);
  });
}

test("banking details that fail to load say so and can't be overwritten", async ({ page }) => {
  const { owner } = await openBanking(page, "SUPER_ADMIN", { get: { status: 500, json: { error: "permission denied for function get_business_bank_details" } } });
  await expect(page.getByText("Banking details could not be loaded: Please refresh the page and try again.")).toBeVisible();
  await expect(owner).toBeDisabled();
});

test("a failed banking save says why in plain words", async ({ page }) => {
  const { bankName, save } = await openBanking(page, "MAIN_ADMIN", { set: { status: 403, json: { error: "Protected settings require an active business" } } });
  await expect(bankName).toHaveValue(BANK.bank_name);
  await bankName.fill("FNB");
  await save.click();
  await expect(page.getByText("Bank details failed: Protected settings require an active business")).toBeVisible();
});

test("the invoices page names the business when it loads the banking details", async ({ page }) => {
  const request = page.waitForRequest(r => r.url().endsWith("/functions/v1/bank-details") && r.method() === "POST");
  await openBanking(page, "SUPER_ADMIN", {}, "/invoices");
  expect((await request).headers()["x-admin-business-id"]).toBe(BUSINESS);
});
