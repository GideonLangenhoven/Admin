import { test, expect, type Page } from "@playwright/test";

// H6: modals must stay usable on short screens. Before the fix the Add New
// Slots panel had overflow-visible, so Create Slots sat below the viewport.
const TOUR = "10000000-0000-4000-8000-000000000003";
const FIXTURE = "http://127.0.0.1:3191";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
    localStorage.setItem("ck_admin_email", "operator@example.invalid");
    localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
    localStorage.setItem("ck_welcome_done", "1");
  });
  await page.routeWebSocket(/realtime/, () => {});
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
    return route.continue();
  });
});

async function pickNextMonthDay(page: Page, trigger: ReturnType<Page["getByRole"]>, day: string) {
  await trigger.click();
  const calendar = page.locator(".rdp-root").last();
  await calendar.getByRole("button", { name: /next month/i }).click();
  await calendar.locator("button.rdp-day_button").filter({ hasText: new RegExp(`^${day}$`) }).first().click();
}

async function expectInViewport(page: Page, locator: ReturnType<Page["getByRole"]>) {
  const viewport = page.viewportSize()!;
  const box = (await locator.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
}

for (const [width, height] of [[375, 667], [662, 555]] as const) {
  test(`Add New Slots can be filled and submitted at ${width}x${height}`, async ({ page, request }) => {
    await request.post(`${FIXTURE}/__fixture/reset`);
    await page.setViewportSize({ width, height });
    await page.goto("/slots?panel=add");
    const dialog = page.getByRole("dialog", { name: "Add New Slots", exact: true });
    await expect(dialog).toBeVisible();
    const create = dialog.getByRole("button", { name: "Create Slots", exact: true });
    // The action row is pinned, so it is on screen before any scrolling.
    await expectInViewport(page, create);

    await dialog.getByRole("combobox").first().selectOption(TOUR);
    await pickNextMonthDay(page, dialog.getByRole("button", { name: "Start Date", exact: true }), "15");
    await pickNextMonthDay(page, dialog.getByRole("button", { name: "End Date", exact: true }), "15");
    await dialog.getByRole("spinbutton").last().fill("600");
    await expect(create).toBeEnabled();
    await expectInViewport(page, create);
    expect(await dialog.evaluate(el => el.scrollHeight - el.clientHeight)).toBeGreaterThanOrEqual(0);
    await create.click();

    // The synthetic backend records the write (and refuses it with 403).
    await expect.poll(async () => {
      const state = await (await request.get(`${FIXTURE}/__fixture/state`)).json();
      const write = state.writes.find((w: { table?: string }) => w.table === "slots");
      return write ? [].concat(write.body)[0]?.price_per_person_override : undefined;
    }).toBe(600);
  });
}
