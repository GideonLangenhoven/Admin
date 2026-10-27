import { test, expect, type Page } from "@playwright/test";

// M3: the booking page offers the same Guest actions as the bookings list,
// from one registry. Mark Paid runs on the page; the others open their own
// dialog on the list, and an action that would act at once asks first when it
// arrives by link, so a link alone changes nothing.
const BOOKING = "10000000-0000-4000-8000-000000000022"; // CONFIRMED, R100 of R200 received
const FIXTURE = "http://127.0.0.1:3191";
type Call = { path: string; method: string };
type Notice = { title?: string; message: string; tone?: string };

test.use({ viewport: { width: 662, height: 900 } });

test.beforeEach(async ({ request }) => { await request.post(`${FIXTURE}/__fixture/reset`); });

async function setup(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.clock.setFixedTime(new Date("2026-10-15T05:00:00Z"));
  await page.routeWebSocket(/realtime/, () => {});
  const calls: Call[] = [];
  await page.route("**/*", route => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    if (url.pathname.startsWith("/functions/v1/") || (url.pathname.startsWith("/rest/v1/bookings") && req.method() === "PATCH")) calls.push({ path: url.pathname, method: req.method() });
    return route.continue();
  });
  // The preview has no notification layer, so notify() and confirmAction() log their payloads.
  const asked: Notice[] = [];
  page.on("console", async msg => {
    if (msg.type() === "warning" && msg.text().startsWith("App confirmation requested")) asked.push(await msg.args()[1].jsonValue());
  });
  return { calls, asked };
}

async function openGuestActions(page: Page) {
  await page.goto(`/bookings/${BOOKING}`);
  await page.getByRole("button", { name: "Guest actions", exact: true }).click();
  return page.getByRole("group", { name: "Guest actions" });
}

test("a confirmed booking with money due offers the main actions on its own page", async ({ page }) => {
  await setup(page);
  const actions = await openGuestActions(page);
  for (const name of ["Mark Paid", "Payment Link", "Rebook", "Refund", "Cancel", "Edit", "Resend Invoice"])
    await expect(actions.getByRole("button", { name: new RegExp("^" + name) }), name).toBeEnabled();
  await expect(actions.getByRole("button", { name: /^Payment Reminder/ })).toBeDisabled();
  await expect(actions.getByRole("button", { name: /^View/ })).toHaveCount(0);

  await actions.getByRole("button", { name: /^Mark Paid/ }).click();
  await expect(page.getByRole("dialog", { name: "Record a payment" })).toContainText(/R100[.,]00 due/);
  await expect(page).toHaveURL(new RegExp(`/bookings/${BOOKING}$`));
});

test("Rebook opens the same Rebook dialog on the bookings list, focused on the booking", async ({ page }) => {
  await setup(page);
  const actions = await openGuestActions(page);
  await actions.getByRole("button", { name: /^Rebook/ }).click();
  await expect(page.getByLabel("Available slots")).toBeVisible();
  // The action is dropped from the address, so a reload does not reopen it.
  await expect(page).toHaveURL(new RegExp(`/bookings\\?date=2026-10-15&booking=${BOOKING}$`));
});

test("an action that acts at once asks first when it arrives by link", async ({ page }) => {
  const { calls, asked } = await setup(page);
  await page.goto(`/bookings?date=2026-10-15&booking=${BOOKING}&action=allow-unpaid`);
  await expect.poll(() => asked).toEqual([{ title: "Allow Without Payment", message: "Partial Example: Keep places for pay on arrival.", confirmLabel: "Allow Without Payment" }]);
  expect(calls.filter(c => c.method === "PATCH")).toEqual([]);
  await expect(page).toHaveURL(new RegExp(`/bookings\\?date=2026-10-15&booking=${BOOKING}$`));
});
