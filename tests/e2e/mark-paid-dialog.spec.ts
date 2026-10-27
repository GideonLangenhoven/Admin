import { test, expect, type Page } from "@playwright/test";

// M2: Mark Paid asks what was actually received (a deposit is fine), how and
// a reference, then reports what the server recorded and how the guest was
// told. A refusal keeps the dialog open with the reason, never database text.
const BOOKING = "10000000-0000-4000-8000-000000000022"; // CONFIRMED, R100 of R200 received
const FIXTURE = "http://127.0.0.1:3191";
type Notice = { title?: string; message: string; tone?: string };

test.use({ viewport: { width: 662, height: 555 } });

async function openMarkPaid(page: Page, answer: { status: number; json: unknown }, patch?: Record<string, unknown>) {
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.clock.setFixedTime(new Date("2026-10-15T05:00:00Z"));
  await page.routeWebSocket(/realtime/, () => {});
  const calls: unknown[] = [];
  await page.route("**/*", async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    if (url.pathname === "/functions/v1/manual-mark-paid") { calls.push(req.postDataJSON()); return route.fulfill(answer); }
    if (patch && (url.pathname === "/rest/v1/rpc/list_operator_bookings" || (url.pathname === "/rest/v1/bookings" && req.method() === "GET"))) {
      const res = await route.fetch();
      const rows = await res.json();
      const edit = (row: { id?: string }) => row.id === BOOKING ? { ...row, ...patch } : row;
      return route.fulfill({ response: res, json: Array.isArray(rows) ? rows.map(edit) : edit(rows) });
    }
    return route.continue();
  });
  // The preview has no notification layer, so notify() logs its payload to the console.
  const seen: Notice[] = [];
  page.on("console", async msg => {
    if (msg.type() === "warning" && msg.text().startsWith("App notification emitted")) seen.push(await msg.args()[1].jsonValue());
  });

  await page.goto("/bookings");
  await page.getByRole("button", { name: /view guests/i }).first().click();
  await page.locator(`[data-booking-id="${BOOKING}"]`).filter({ visible: true }).first().getByRole("button", { name: "Guest actions", exact: true }).click();
  await page.locator("[data-mobile-action-sheet]").getByRole("button", { name: /^Mark Paid/ }).click();
  return { calls, seen, dialog: page.getByRole("dialog", { name: "Record a payment" }) };
}

test.beforeEach(async ({ request }) => { await request.post(`${FIXTURE}/__fixture/reset`); });

test("records a part-payment with method and reference, and says what is still due", async ({ page }) => {
  const { calls, seen, dialog } = await openMarkPaid(page, { status: 200, json: { ok: true, amount: 40, balance_due: 60, paid_in_full: false, notified: "receipt" } });
  await expect(dialog).toContainText(/R100[.,]00 due \(R100[.,]00 already received\)/);
  const amount = dialog.getByLabel("Amount received (R)");
  await expect(amount).toHaveValue("100.00");
  await expect(dialog).toContainText("The booking will be marked paid.");
  await expect(dialog).toContainText("The guest is emailed a receipt.");

  await amount.fill("150");
  await expect(dialog.getByRole("alert")).toHaveText(/That is more than the R100[.,]00 still due\./);
  await expect(dialog.getByRole("button", { name: "Record payment" })).toBeDisabled();
  await amount.fill("10.005");
  await expect(dialog.getByRole("alert")).toHaveText("Enter the amount in rand and cents, for example 500.00.");

  await amount.fill("40,00");
  await expect(dialog).toContainText(/R60[.,]00 will still be due\. The booking stays confirmed\./);
  await dialog.getByLabel("Payment method").selectOption("EFT");
  await dialog.getByLabel("Reference (optional)").fill("FNB 123");
  await dialog.getByRole("button", { name: /^Record R40[.,]00$/ }).click();

  await expect.poll(() => seen.find(n => n.title === "Payment recorded")).toMatchObject({
    tone: "success", message: expect.stringMatching(/^R40[.,]00 by EFT \(bank transfer\)\. R60[.,]00 still due\. Receipt email queued\.$/),
  });
  expect(calls).toEqual([{ action: "mark_paid", booking_id: BOOKING, amount: 40, payment_method: "EFT", payment_reference: "FNB 123", expected_captured: 100 }]);
  await expect(dialog).toBeHidden();
});

for (const [label, error, shown] of [
  ["the server's reason", "This booking's payments changed since you opened it. Refresh and check the balance.", "This booking's payments changed since you opened it. Refresh and check the balance."],
  ["a plain message instead of database text", 'null value in column "status" violates not-null constraint', "The payment could not be recorded. Please try again."],
] as const) {
  test(`a refused payment keeps the dialog open and shows ${label}`, async ({ page }) => {
    const { calls, seen, dialog } = await openMarkPaid(page, { status: 409, json: { error } });
    await dialog.getByRole("button", { name: /^Record R100[.,]00$/ }).click();
    await expect(dialog.getByRole("alert")).toHaveText(shown);
    await expect.poll(() => seen.find(n => n.title === "Payment not recorded")).toEqual({ title: "Payment not recorded", message: shown, tone: "error" });
    expect(calls).toHaveLength(1);
    await expect(dialog).toBeVisible();
  });
}

test("a booking with nothing due is marked paid without an amount", async ({ page }) => {
  const { calls, seen, dialog } = await openMarkPaid(page, { status: 200, json: { ok: true, amount: 0, balance_due: 0, paid_in_full: true, notified: "confirmation" } }, { status: "PENDING", total_amount: 0, total_captured: 0 });
  await expect(dialog).toContainText("Nothing is due. The booking will be marked paid.");
  await expect(dialog.getByLabel("Amount received (R)")).toHaveCount(0);
  await expect(dialog).toContainText("The guest is emailed their booking confirmation.");
  await dialog.getByRole("button", { name: "Mark paid", exact: true }).click();
  await expect.poll(() => seen.find(n => n.title === "Payment recorded")).toMatchObject({ tone: "success", message: "The booking is paid in full. Booking confirmation email queued." });
  expect(calls).toEqual([{ action: "mark_paid", booking_id: BOOKING, expected_captured: 0 }]);
});
