import { test, expect, type Page } from "@playwright/test";

// H5: the composer no longer promises a WhatsApp message. Sending itself is
// covered by tests/unit/broadcasts-page-send.test.ts: this preview has no
// confirmation layer, so confirmAction() resolves false here.
const SLOT = "10000000-0000-4000-8000-000000000501";
const slot = { id: SLOT, start_time: "2026-10-17T06:00:00Z", capacity_total: 10, booked: 2, held: 0, status: "OPEN", tours: { name: "Harbour paddle" } };
const guest = {
  id: "10000000-0000-4000-8000-000000000502", customer_name: "Email Guest", phone: null, email: "email.guest@example.invalid",
  qty: 2, total_amount: 1000, status: "PAID", slots: { start_time: slot.start_time }, tours: { name: "Harbour paddle" },
};

test.use({ viewport: { width: 1280, height: 900 } });

async function compose(page: Page) {
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
    if (url.pathname.startsWith("/functions/")) return route.fulfill({ status: 500, json: { error: "unexpected" } });
    if (url.pathname === "/rest/v1/slots" && req.method() === "GET") return route.fulfill({ json: [slot] });
    if (url.pathname === "/rest/v1/bookings" && req.method() === "GET") return route.fulfill({ json: [guest] });
    return route.continue();
  });
  await page.goto("/broadcasts");
  await page.getByRole("button", { name: /^17\d*$/ }).click();
  await page.getByRole("button", { name: /Harbour paddle/ }).click();
  await expect(page.getByText("Customers (1)")).toBeVisible();
  return page.locator(".ui-card", { has: page.getByRole("heading", { name: "Compose" }) });
}

test("the composer says who gets the message on which channel", async ({ page }) => {
  const card = await compose(page);
  await expect(card.getByText("Message", { exact: true })).toBeVisible();
  await expect(card.getByText("WhatsApp Message")).toHaveCount(0);
  await expect(card).toContainText("For updates about the trip; promotions go out from Marketing. Email goes to guests who have an email address and haven't unsubscribed. WhatsApp goes to guests who opted in, when WhatsApp is connected.");
  await card.locator("[contenteditable]").fill("Hi {name}, meet at the slipway.");
  await expect(card.getByRole("button", { name: "Send to 1 guest", exact: true })).toBeEnabled();
});
