import { test, expect, type Page } from "@playwright/test";

// H2: "Refund & cancel" must go through process-refund (cancel, seats, refund
// record, provider call and guest email together). The browser never writes
// the booking, and only a provider-confirmed refund says "Refund processed".
const BOOKING = "10000000-0000-4000-8000-000000000020"; // PAID, 3 guests, R300, no Yoco checkout
const FIXTURE = "http://127.0.0.1:3191";

type Call = { url: string; method: string; body: Record<string, unknown> | null };
type Notice = { title?: string; message: string; tone?: string };

test.use({ viewport: { width: 662, height: 555 } });

test.beforeEach(async ({ page, request }) => {
  await request.post(`${FIXTURE}/__fixture/reset`);
  await page.addInitScript(() => {
    const exp = 4102444800;
    const encode = (v: object) => btoa(JSON.stringify(v)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const user = { id: "10000000-0000-4000-8000-000000000110", email: "operator@example.invalid", aud: "authenticated", role: "authenticated" };
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: encode({ alg: "HS256" }) + "." + encode({ ...user, sub: user.id, exp }) + ".synthetic", refresh_token: "synthetic", expires_at: exp, expires_in: 3600, token_type: "bearer", user }));
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

// Records process-refund calls and direct bookings writes; answers process-refund as scripted.
async function record(page: Page, answer: { status: number; json: unknown }) {
  const calls: Call[] = [];
  await page.route(/127\.0\.0\.1:3191\/(functions\/v1\/|rest\/v1\/bookings)/, route => {
    const req = route.request();
    calls.push({ url: req.url(), method: req.method(), body: req.postDataJSON?.() ?? null });
    if (req.url().includes("/functions/v1/process-refund")) return route.fulfill(answer);
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

async function refundAndCancel(page: Page) {
  await page.goto("/bookings");
  await page.getByRole("button", { name: /view guests/i }).first().click();
  const row = page.locator(`[data-booking-id="${BOOKING}"]`).filter({ visible: true }).first();
  await row.getByRole("button", { name: "Guest actions", exact: true }).click();
  await page.locator("[data-mobile-action-sheet]").getByRole("button", { name: /^Refund/ }).click();
  await page.getByRole("button", { name: "Refund & cancel", exact: true }).click();
}

const directWrites = (calls: Call[]) => calls.filter(c => c.url.includes("/rest/v1/bookings") && c.method === "PATCH");

test("refund & cancel goes through process-refund and never writes the booking from the browser", async ({ page }) => {
  const calls = await record(page, { status: 200, json: { ok: true, amount: 300, refund_status: "REFUNDED" } });
  const seen = notices(page);
  await refundAndCancel(page);
  await expect.poll(() => seen.find(n => n.title === "Refund processed")).toMatchObject({ tone: "success" });
  expect(calls.filter(c => c.url.includes("/functions/v1/process-refund")).map(c => c.body)).toEqual([{ booking_id: BOOKING, amount: 300 }]);
  expect(directWrites(calls)).toEqual([]);
});

for (const [label, answer] of [
  ["a bank-transfer refund", { status: 200, json: { ok: true, pending: true, refund_status: "MANUAL_EFT_REQUIRED", amount: 300 } }],
  ["a refund the provider has not confirmed", { status: 202, json: { ok: true, pending: true, refund_status: "REFUND_PENDING", amount: 300 } }],
] as const) {
  test(`${label} says "Refund pending", never "Refund processed"`, async ({ page }) => {
    const calls = await record(page, answer);
    const seen = notices(page);
    await refundAndCancel(page);
    await expect.poll(() => seen.find(n => n.title === "Refund pending")).toMatchObject({ tone: "warning" });
    expect(seen.find(n => n.title === "Refund processed")).toBeUndefined();
    expect(directWrites(calls)).toEqual([]);
  });
}

test("a refused refund shows the server's reason in red and changes nothing", async ({ page }) => {
  const calls = await record(page, { status: 409, json: { error: "Completed trips cannot be cancelled" } });
  const seen = notices(page);
  await refundAndCancel(page);
  await expect.poll(() => seen.find(n => n.title === "Refund failed"))
    .toEqual({ title: "Refund failed", message: "Completed trips cannot be cancelled", tone: "error" });
  expect(directWrites(calls)).toEqual([]);
});

// H2: declining a queued refund goes through decline_refund_request (tenant
// check, status guard, timeline entry), never a direct bookings write.
for (const [label, email, notice] of [
  ["and the guest is emailed", { status: 200, json: { ok: true } }, { message: "The guest has been emailed.", tone: "success" }],
  ["but the email fails, so the operator is told", { status: 500, json: { error: "Resend unavailable" } }, { message: "The guest was not emailed. Let them know the refund was declined.", tone: "warning" }],
] as const) {
  test(`declining a refund goes through the server ${label}`, async ({ page }) => {
    const queued = { id: BOOKING, customer_name: "Refund guest", email: "guest@example.invalid", qty: 3, total_amount: 300, total_captured: 300, refund_status: "REQUESTED", refund_amount: 300, slots: { start_time: "2026-10-16T07:00:00Z" }, tours: { name: "Harbour paddle" } };
    const calls: Call[] = [];
    await page.route(/127\.0\.0\.1:3191\/(functions\/v1\/|rest\/v1\/bookings|rest\/v1\/rpc\/decline_refund_request)/, route => {
      const req = route.request();
      calls.push({ url: req.url(), method: req.method(), body: req.postDataJSON?.() ?? null });
      if (req.url().includes("decline_refund_request")) return route.fulfill({ json: { ok: true } });
      if (req.url().includes("/functions/v1/send-email")) return route.fulfill(email);
      if (req.method() === "PATCH") return route.fulfill({ status: 204 });
      return route.fulfill({ json: req.url().includes("REQUESTED") ? [queued] : [] });
    });
    const seen = notices(page);
    await page.goto("/refunds");
    await page.getByRole("button", { name: "Decline", exact: true }).click();
    await page.getByRole("button", { name: "Decline refund", exact: true }).click();
    await expect.poll(() => seen.find(n => n.title === "Refund declined")).toEqual({ title: "Refund declined", ...notice });
    expect(calls.filter(c => c.url.includes("decline_refund_request")).map(c => c.body)).toEqual([{ p_booking_id: BOOKING }]);
    expect(directWrites(calls)).toEqual([]);
  });
}
