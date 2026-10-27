import { test, expect, type Page } from "@playwright/test";

// P2: "Book Page →" on a tour opened the booking site's home page, and
// Deactivate and Hide changed a live tour with one click and no question.
const FIXTURE = "http://127.0.0.1:3191";
const HARBOUR = "10000000-0000-4000-8000-000000000003";

test.beforeEach(async ({ request }) => { await request.post(`${FIXTURE}/__fixture/reset`); });

async function openTours(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.routeWebSocket(/realtime/, () => {});
  const tourWrites: unknown[] = [];
  await page.route("**/*", async route => {
    const req = route.request(), url = new URL(req.url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    if (url.pathname === "/rest/v1/tours" && req.method() === "PATCH") { tourWrites.push(req.postDataJSON()); return route.fulfill({ status: 204 }); }
    if (["/rest/v1/tours", "/rest/v1/businesses"].includes(url.pathname) && req.method() === "GET") {
      const res = await route.fetch();
      const rows = await res.json();
      const edit = (row: object) => url.pathname.endsWith("tours") ? { ...row, active: true, hidden: false } : { ...row, booking_site_url: "https://example.invalid/" };
      return route.fulfill({ response: res, json: Array.isArray(rows) ? rows.map(edit) : rows && edit(rows) });
    }
    return route.continue();
  });
  // The preview has no notification layer: confirmAction logs its question and answers no.
  const asked: { title?: string }[] = [];
  page.on("console", async msg => {
    if (msg.text().startsWith("App confirmation requested")) asked.push(await msg.args()[1].jsonValue());
  });
  await page.goto("/settings#tours");
  return { tourWrites, asked };
}

test("Book Page opens that tour on the booking site", async ({ page }) => {
  await openTours(page);
  await expect(page.getByRole("link", { name: "Book Page →" }).first()).toHaveAttribute("href", "https://example.invalid/book?tour=" + HARBOUR);
});

test("Deactivate and Hide ask first, and change nothing when declined", async ({ page }) => {
  const { tourWrites, asked } = await openTours(page);
  await page.getByRole("button", { name: "Deactivate" }).first().click();
  await expect.poll(() => asked.map(a => a.title)).toEqual(["Deactivate tour"]);
  await page.getByRole("button", { name: "Hide", exact: true }).first().click();
  await expect.poll(() => asked.map(a => a.title)).toEqual(["Deactivate tour", "Hide tour"]);
  expect(tourWrites).toEqual([]);
});
