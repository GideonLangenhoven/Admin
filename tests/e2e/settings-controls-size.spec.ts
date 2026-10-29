import { test, expect } from "@playwright/test";

// Round 2, A3: Settings radios and checkboxes were squashed beside long text
// (the WhatsApp Bot Mode radio was 4px wide at 406px). Every one keeps at
// least 16 x 16, square, at phone and tablet widths.
const FIXTURE = "http://127.0.0.1:3191";

for (const width of [375, 406, 768]) {
  test(`Settings checkboxes and radios keep their size at ${width}px`, async ({ page, request }) => {
    await request.post(`${FIXTURE}/__fixture/reset`);
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => {
      localStorage.setItem("ck_admin_role", "MAIN_ADMIN");
      localStorage.setItem("ck_admin_email", "operator@example.invalid");
      localStorage.setItem("ck_admin_timezone", "Africa/Johannesburg");
      localStorage.setItem("ck_welcome_done", "1");
    });
    await page.routeWebSocket(/realtime/, () => {});
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.hostname !== "127.0.0.1" || !["3190", "3191"].includes(url.port)) return route.abort();
      if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Operational actions disabled in synthetic preview" } });
      return route.continue();
    });
    // The preview's API is off: answer bot-mode so the WhatsApp auto-reply radios render.
    await page.route("**/api/admin/whatsapp/bot-mode", route => route.fulfill({ json: { mode: "OUTSIDE_HOURS", currentlyActive: false, businessHours: null, timezone: "Africa/Johannesburg" } }));
    await page.goto("/settings");
    const closed = page.locator('button[aria-expanded="false"][aria-controls$="-content"]');
    await expect(closed.first()).toBeVisible();
    while (await closed.count()) await closed.first().click();
    await expect(page.locator('input[name="whatsapp_bot_mode"]').first()).toBeVisible();

    const boxes = await page.locator('main :is(input[type="checkbox"], input[type="radio"])').evaluateAll(inputs => inputs
      .filter(el => el.getClientRects().length && !el.classList.contains("sr-only"))
      .map(el => { const r = el.getBoundingClientRect(); return { input: el.outerHTML.slice(0, 90), w: Math.round(r.width), h: Math.round(r.height) }; }));
    expect(boxes.length).toBeGreaterThan(5);
    expect(boxes.filter(box => box.w < 16 || box.h < 16 || box.w !== box.h)).toEqual([]);
  });
}
