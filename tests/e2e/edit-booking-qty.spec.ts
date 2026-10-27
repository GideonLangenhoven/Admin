import { test, expect, type Page } from "@playwright/test";

// H1: changing the guest count of an unpaid booking must go through
// rebook-booking (hold, slot counters and total change together), and a
// failed guest change or payment link must show the server's reason in red.
const BOOKING = "10000000-0000-4000-8000-000000000021"; // PENDING, 2 guests
const FIXTURE = "http://127.0.0.1:3191";

type Call = { url: string; method: string; body: Record<string, unknown> | null };
type Notice = { title?: string; message: string; tone?: string };

test.use({ viewport: { width: 662, height: 555 } });

test.beforeEach(async ({ page, request }) => {
  await request.post(`${FIXTURE}/__fixture/reset`);
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.clock.setFixedTime(new Date("2026-10-15T05:00:00Z"));
  await page.routeWebSocket(/realtime/, () => {});
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    return route.continue();
  });
});

// Records every call to an edge function or a direct bookings write, and answers edge functions as scripted.
async function record(page: Page, answers: Record<string, { status: number; json: unknown }>) {
  const calls: Call[] = [];
  await page.route(/127\.0\.0\.1:3191\/(functions\/v1\/|rest\/v1\/bookings)/, route => {
    const req = route.request();
    calls.push({ url: req.url(), method: req.method(), body: req.postDataJSON?.() ?? null });
    const fn = new URL(req.url()).pathname.match(/functions\/v1\/([\w-]+)/)?.[1];
    if (fn && answers[fn]) return route.fulfill({ status: answers[fn].status, json: answers[fn].json });
    if (req.method() === "PATCH") return route.fulfill({ status: 204 });
    return route.fallback();
  });
  return calls;
}

// The preview has no notification layer, so notify() logs its payload to the console.
function notices(page: Page) {
  const seen: Notice[] = [];
  page.on("console", async msg => {
    if (msg.type() === "warning" && msg.text().startsWith("App notification emitted")) seen.push(await msg.args()[1].jsonValue());
  });
  return seen;
}

async function openGuestAction(page: Page, action: RegExp) {
  await page.goto("/bookings");
  await page.getByRole("button", { name: /view guests/i }).first().click();
  const row = page.locator(`[data-booking-id="${BOOKING}"]`).filter({ visible: true }).first();
  await row.getByRole("button", { name: "Guest actions", exact: true }).click();
  await page.locator("[data-mobile-action-sheet]").getByRole("button", { name: action }).click();
}

test("a guest-count change goes through rebook-booking, never a direct qty write", async ({ page }) => {
  const calls = await record(page, { "rebook-booking": { status: 200, json: { ok: true, action: "ADD_GUESTS", diff: 0, new_total: 300 } } });
  const seen = notices(page);
  await openGuestAction(page, /^Edit booking/);
  const dialog = page.getByRole("heading", { name: "Edit Booking" }).locator("..");
  await dialog.getByLabel("Qty").fill("3");
  await expect(dialog.getByLabel("Total (ZAR)")).toBeDisabled();
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => seen.find(n => n.title === "Booking updated")).toMatchObject({ tone: "success" });

  const rebook = calls.filter(c => c.url.includes("/functions/v1/rebook-booking"));
  expect(rebook.map(c => c.body)).toEqual([{ booking_id: BOOKING, action: "ADD_GUESTS", new_qty: 3 }]);
  const writes = calls.filter(c => c.url.includes("/rest/v1/bookings") && c.method === "PATCH");
  for (const w of writes) {
    expect(w.body).not.toHaveProperty("qty");
    expect(w.body).not.toHaveProperty("total_amount");
  }
});

test("a guest-count change refused for capacity shows the reason and saves nothing", async ({ page }) => {
  const calls = await record(page, { "rebook-booking": { status: 409, json: { error: "Not enough spots available" } } });
  const seen = notices(page);
  await openGuestAction(page, /^Edit booking/);
  const dialog = page.getByRole("heading", { name: "Edit Booking" }).locator("..");
  await dialog.getByLabel("Qty").fill("9");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => seen.find(n => n.title === "Guest count not changed"))
    .toEqual({ title: "Guest count not changed", message: "Not enough spots available", tone: "error" });
  expect(calls.filter(c => c.url.includes("/rest/v1/bookings") && c.method === "PATCH")).toEqual([]);
});

test("a failed payment link shows the server's reason, not a generic error", async ({ page }) => {
  await record(page, {
    "create-checkout": { status: 409, json: { error: "CHECKOUT_UNAVAILABLE", reason: "Reservation expired. Please choose a time again." } },
  });
  const seen = notices(page);
  await openGuestAction(page, /^Payment Link/);
  await expect.poll(() => seen.find(n => n.title === "Payment link failed"))
    .toEqual({ title: "Payment link failed", message: "Reservation expired. Please choose a time again.", tone: "error" });
});
