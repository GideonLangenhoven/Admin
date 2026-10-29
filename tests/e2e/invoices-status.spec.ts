import { test, expect } from "@playwright/test";

// H4: invoice badges, due amounts and the Outstanding total come from the
// booking. INV-00007 and INV-00004 still say "Pending" but their bookings
// were cancelled before paying, so nothing is due on them.
const FIXTURE = "http://127.0.0.1:3191";
const BUSINESS = "10000000-0000-4000-8000-000000000001";
const id = (n: number) => `10000000-0000-4000-8000-0000000003${String(n).padStart(2, "0")}`;
const invoice = (n: number, number: string, total: number, method: string) => ({
  id: id(n), business_id: BUSINESS, booking_id: id(n + 50), invoice_number: number, total_amount: total, payment_method: method,
  customer_name: `Guest ${n}`, customer_email: `guest${n}@example.invalid`, tour_name: "Harbour paddle", tour_date: "2026-10-20T07:00:00Z", created_at: "2026-10-20T08:00:00Z",
});
const invoices = [
  invoice(1, "INV-00007", 730, "Pending"), invoice(2, "INV-00004", 610, "Pending"),
  invoice(3, "INV-00009", 500, "Pending"), invoice(4, "INV-00010", 400, "Yoco"),
  invoice(5, "INV-00011", 500, "Cash"),
];
const bookings = [
  { id: id(51), status: "CANCELLED", total_amount: 730, total_captured: 0, created_at: "2026-10-19T08:00:00Z" },
  { id: id(52), status: "CANCELLED", total_amount: 610, total_captured: 0, created_at: "2026-10-18T08:00:00Z" },
  { id: id(53), status: "PENDING", total_amount: 500, total_captured: 0, created_at: "2026-10-20T08:00:00Z" },
  { id: id(54), status: "PAID", total_amount: 400, total_captured: 400, created_at: "2026-10-20T08:00:00Z" },
  // Round 2, 13b: cancelled, refund reserved, bank transfer not made yet.
  { id: id(55), status: "CANCELLED", total_amount: 500, total_captured: 500, total_refunded: 500, refund_status: "MANUAL_EFT_REQUIRED", created_at: "2026-10-20T08:00:00Z" },
];

test.use({ viewport: { width: 1280, height: 900 } });

let bookingQueries: string[];
let emails: Record<string, unknown>[];
let notices: { title?: string; message: string; tone?: string }[];

test.beforeEach(async ({ page, request }) => {
  await request.post(`${FIXTURE}/__fixture/reset`);
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.routeWebSocket(/realtime/, () => {});
  bookingQueries = []; emails = []; notices = [];
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    if (url.pathname === "/rest/v1/invoices") return route.fulfill({ json: invoices });
    if (url.pathname === "/rest/v1/bookings") { bookingQueries.push(url.search); return route.fulfill({ json: bookings }); }
    if (url.pathname === "/functions/v1/send-email") { emails.push(route.request().postDataJSON().data); return route.fulfill({ json: { ok: true } }); }
    return route.continue();
  });
  // The preview has no notification layer, so notify() logs its payload to the console.
  page.on("console", async msg => {
    if (msg.type() === "warning" && msg.text().startsWith("App notification emitted")) notices.push(await msg.args()[1].jsonValue());
  });
});

test("the invoices page shows each booking's real state and only counts what is owed", async ({ page }) => {
  await page.goto("/invoices");
  await expect(page.getByRole("heading", { name: "Invoices", level: 2 })).toBeVisible();
  // en-ZA formats R500,00 (decimal comma) in some ICU builds, R500.00 in others.
  const rand = (n: number) => new RegExp(`^R${n}[.,]00$`);
  await expect(page.getByText("Outstanding total").locator("..").locator("p").nth(1)).toHaveText(rand(500));
  for (const [number, status, due] of [["INV-00007", "cancelled", 0], ["INV-00004", "cancelled", 0], ["INV-00009", "unpaid", 500], ["INV-00010", "paid", 0], ["INV-00011", "refund pending", 0]] as const) {
    const row = page.locator("tr", { hasText: number });
    await expect(row.locator(".ui-status")).toHaveText(status);
    await expect(row.locator("td").nth(7)).toHaveText(rand(due));
  }
  expect(bookingQueries.every(q => q.includes(`business_id=eq.${BUSINESS}`) && q.includes("refund_status"))).toBe(true);
});

test("resending takes amounts from the booking, and a cancelled unpaid booking has nothing to resend", async ({ page }) => {
  await page.goto("/invoices");
  await page.locator("tr", { hasText: "INV-00007" }).getByRole("button", { name: "Resend" }).click();
  await expect.poll(() => notices.find(n => n.title === "Nothing to invoice")).toMatchObject({ tone: "warning" });
  await page.locator("tr", { hasText: "INV-00009" }).getByRole("button", { name: "Resend" }).click();
  await expect.poll(() => notices.find(n => n.title === "Invoice resent")).toMatchObject({ tone: "success" });
  expect(emails.map(e => [e.invoice_number, e.booking_id])).toEqual([["INV-00009", id(53)]]);
});
