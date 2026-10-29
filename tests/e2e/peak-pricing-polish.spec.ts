import { test, expect, type Page } from "@playwright/test";

// P2: Set Peak Period's per-tour price showed (and, untouched, re-read) the
// tour's standard peak price, and "Save tour prices" gave no confirmation
// near the button and reported success even when a save failed.
const FIXTURE = "http://127.0.0.1:3191";
type Notice = { title?: string; message: string; tone?: string };

test.beforeEach(async ({ request }) => { await request.post(`${FIXTURE}/__fixture/reset`); });

async function openPricing(page: Page, tourSave: { status: number; json?: unknown }) {
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.routeWebSocket(/realtime/, () => {});
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    if (url.pathname === "/rest/v1/tours" && req.method() === "PATCH") return route.fulfill(tourSave);
    if (url.pathname === "/rest/v1/tours" && req.method() === "GET") {
      const res = await route.fetch();
      const rows = await res.json();
      return route.fulfill({ response: res, json: rows.map((row: object) => ({ ...row, peak_price_per_person: 150 })) });
    }
    return route.continue();
  });
  // The preview has no notification layer, so notify() logs its payload to the console.
  const seen: Notice[] = [];
  page.on("console", async msg => {
    if (msg.type() === "warning" && msg.text().startsWith("App notification emitted")) seen.push(await msg.args()[1].jsonValue());
  });
  await page.goto("/pricing");
  return seen;
}

test("Set Peak Period prices start blank, with the standard peak price as the hint", async ({ page }) => {
  await openPricing(page, { status: 204 });
  const periodPrices = page.getByPlaceholder("R150");
  await expect(periodPrices).toHaveCount(2);
  for (const input of await periodPrices.all()) await expect(input).toHaveValue("");
});

test("Save tour prices confirms, and names the tours it could not save", async ({ page }) => {
  let seen = await openPricing(page, { status: 204 });
  await page.getByRole("button", { name: "Save tour prices" }).click();
  await expect.poll(() => seen.find(n => n.tone === "success")).toMatchObject({ title: "Tour prices saved" });

  await page.unrouteAll({ behavior: "ignoreErrors" });
  seen = await openPricing(page, { status: 403, json: { code: "42501", message: 'new row violates row-level security policy for table "tours"' } });
  await page.getByRole("button", { name: "Save tour prices" }).click();
  await expect.poll(() => seen.find(n => n.tone === "error"))
    .toEqual({ title: "Prices not saved", message: "Could not save Harbour paddle, Coastal walk. Please try again.", tone: "error" });
});

// Round 2, 13g: the peak period's end date opened on today's month, not the start's.
test("Set Peak Period opens the end date on the start's month", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-10-15T09:00:00Z"));
  await openPricing(page, { status: 204 });
  const picker = (label: string) => page.getByText(label, { exact: true }).locator("..").getByRole("button");
  await picker("Start Date").click();
  await page.getByRole("button", { name: "Go to the Next Month" }).click();
  await page.getByRole("button", { name: "Go to the Next Month" }).click();
  await page.locator('[data-day="2026-12-10"] button').click();
  await picker("End Date").click();
  await expect(page.getByText("December 2026")).toBeVisible();
  await expect(page.locator('[data-day="2026-12-09"]')).toHaveAttribute("data-disabled", "true");
});
