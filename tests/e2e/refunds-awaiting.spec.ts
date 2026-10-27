import { test, expect, type Page } from "@playwright/test";

// H7: money parked by a weather/operator cancellation (refund_status
// ACTION_REQUIRED) is visible on Refunds with its state, never swept into
// "Submit all", and the operator can refund, issue a voucher or resend the
// guest's options, all through the server.
const FIXTURE = "http://127.0.0.1:3191";
const GUEST_CHOOSES = "10000000-0000-4000-8000-000000000401";
const OPERATOR_HANDLES = "10000000-0000-4000-8000-000000000402";
const REQUESTED = "10000000-0000-4000-8000-000000000403";
const row = (id: string, name: string, extra: Record<string, unknown>) => ({
  id, customer_name: name, email: name.toLowerCase().replace(/ /g, ".") + "@example.invalid", qty: 3, total_amount: 1500, total_captured: 1500,
  refund_amount: 1500, cancelled_at: "2026-10-11T07:00:00Z", slots: { start_time: "2026-10-11T07:00:00Z" }, tours: { name: "Harbour paddle" }, ...extra,
});
const queue = [
  row(GUEST_CHOOSES, "Wind Guest", { refund_status: "ACTION_REQUIRED", cancellation_self_service: true, cancellation_reason: "Weather cancellation: strong wind" }),
  row(OPERATOR_HANDLES, "Phone Guest", { refund_status: "ACTION_REQUIRED", cancellation_self_service: false, cancellation_reason: "Weather cancellation: storm" }),
  row(REQUESTED, "Asked Guest", { refund_status: "REQUESTED", cancellation_self_service: true, refund_amount: 300 }),
];

type Call = { fn: string; body: Record<string, unknown> };
type Notice = { title?: string; message: string; tone?: string };

test.use({ viewport: { width: 1280, height: 900 } });

async function open(page: Page, answers: Record<string, unknown>) {
  const calls: Call[] = [];
  const notices: Notice[] = [];
  await page.addInitScript(() => {
    const exp = 4102444800;
    const encode = (v: object) => btoa(JSON.stringify(v)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
    const user = { id: "10000000-0000-4000-8000-000000000110", email: "operator@example.invalid", aud: "authenticated", role: "authenticated" };
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: encode({ alg: "HS256" }) + "." + encode({ ...user, sub: user.id, exp }) + ".synthetic", refresh_token: "synthetic", expires_at: exp, expires_in: 3600, token_type: "bearer", user }));
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.clock.setFixedTime(new Date("2026-10-15T05:00:00Z"));
  await page.routeWebSocket(/realtime/, () => {});
  await page.route("**/*", route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    const fn = url.pathname.match(/^\/functions\/v1\/([\w-]+)/)?.[1];
    if (fn) { calls.push({ fn, body: req.postDataJSON() }); return route.fulfill({ json: answers[fn] ?? { error: "unexpected" }, status: answers[fn] ? 200 : 500 }); }
    if (url.pathname === "/rest/v1/bookings" && req.method() === "GET") {
      const pending = url.searchParams.get("refund_status")?.includes("REQUESTED");
      return route.fulfill({ json: pending ? queue : [], headers: { "content-range": "0-0/" + queue.length } });
    }
    if (url.pathname.startsWith("/rest/v1/bookings")) { calls.push({ fn: "PATCH bookings", body: req.postDataJSON() }); return route.fulfill({ status: 204 }); }
    return route.continue();
  });
  page.on("console", async msg => {
    if (msg.type() === "warning" && msg.text().startsWith("App notification emitted")) notices.push(await msg.args()[1].jsonValue());
  });
  await page.goto("/refunds");
  return { calls, notices, section: page.getByRole("region", { name: "Waiting for a decision" }) };
}

test("money parked by a weather cancellation is visible with its state, apart from the refund queue", async ({ page }) => {
  const { section } = await open(page, {});
  await expect(section).toContainText("2 waiting for a decision");
  const guest = section.locator(`[data-awaiting-id="${GUEST_CHOOSES}"]`);
  await expect(guest).toContainText("Waiting for the guest to choose: refund, voucher or new date.");
  await expect(guest).toContainText("Cancelled 3 days ago. Guests get one automatic reminder after 3 days.");
  await expect(guest.getByRole("button", { name: "Resend options" })).toBeVisible();
  const operator = section.locator(`[data-awaiting-id="${OPERATOR_HANDLES}"]`);
  await expect(operator).toContainText("The guest was told you will be in touch.");
  await expect(operator.getByRole("button", { name: "Resend options" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Refund queue" })).toContainText("1 waiting");
});

test("Refund now resolves the guest's credit on the server, then submits the refund", async ({ page }) => {
  const { calls, notices, section } = await open(page, {
    "rebook-booking": { ok: true, action: "CLAIM_CREDIT", refund_status: "REQUESTED", refund_amount: 1500 },
    "process-refund": { ok: true, amount: 1500, refund_status: "REFUNDED" },
  });
  await section.locator(`[data-awaiting-id="${OPERATOR_HANDLES}"]`).getByRole("button", { name: "Refund now" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Refund now" }).click();
  await expect.poll(() => notices.find(n => n.title === "Refund processed")).toMatchObject({ tone: "success" });
  expect(calls.map(c => [c.fn, c.body])).toEqual([
    ["rebook-booking", { booking_id: OPERATOR_HANDLES, action: "CLAIM_CREDIT", credit_action: "REFUND" }],
    ["process-refund", { booking_id: OPERATOR_HANDLES, amount: 1500 }],
  ]);
});

test("Issue voucher and Resend options go through the server and confirm what happened", async ({ page }) => {
  const { calls, notices, section } = await open(page, {
    "rebook-booking": { ok: true, action: "CLAIM_CREDIT", voucher_code: "WX7K2P", voucher_amount: 1500 },
    "auto-messages": { ok: true },
  });
  const guest = section.locator(`[data-awaiting-id="${GUEST_CHOOSES}"]`);
  await guest.getByRole("button", { name: "Resend options" }).click();
  await expect.poll(() => notices.find(n => n.title === "Options resent")).toMatchObject({ tone: "success" });
  await guest.getByRole("button", { name: "Issue voucher" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Issue voucher" }).click();
  await expect.poll(() => notices.find(n => n.title === "Voucher issued"))
    .toEqual({ title: "Voucher issued", message: "Voucher WX7K2P (R1500.00) was emailed to the guest.", tone: "success" });
  expect(calls.map(c => [c.fn, c.body])).toEqual([
    ["auto-messages", { action: "refund_choice_reminder_one", booking_id: GUEST_CHOOSES }],
    ["rebook-booking", { booking_id: GUEST_CHOOSES, action: "CLAIM_CREDIT", credit_action: "VOUCHER" }],
  ]);
});
