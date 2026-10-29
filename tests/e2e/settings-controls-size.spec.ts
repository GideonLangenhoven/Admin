import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

// Round 2, A3: Settings radios and checkboxes were squashed beside long text
// (the WhatsApp Bot Mode radio was 4px wide at 406px). A4: Settings text
// buttons and links were 16px tall, under the 24px WCAG 2.5.8 asks for.
const FIXTURE = "http://127.0.0.1:3191";

async function openAllSettings(page: Page, request: APIRequestContext, width: number) {
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
}

for (const width of [375, 406, 768]) {
  test(`Settings checkboxes and radios keep their size at ${width}px`, async ({ page, request }) => {
    await openAllSettings(page, request, width);
    const boxes = await page.locator('main :is(input[type="checkbox"], input[type="radio"])').evaluateAll(inputs => inputs
      .filter(el => el.getClientRects().length && !el.classList.contains("sr-only"))
      .map(el => { const r = el.getBoundingClientRect(); return { input: el.outerHTML.slice(0, 90), w: Math.round(r.width), h: Math.round(r.height) }; }));
    expect(boxes.length).toBeGreaterThan(5);
    expect(boxes.filter(box => box.w < 16 || box.h < 16 || box.w !== box.h)).toEqual([]);
  });
}

for (const width of [375, 1280]) {
  test(`Settings buttons and links are at least 24px tall at ${width}px`, async ({ page, request }) => {
    await openAllSettings(page, request, width);
    // A link inside a sentence is exempt; one that stands on its own is a target.
    const short = await page.locator("main").evaluate(main => [...main.querySelectorAll<HTMLElement>("button, a[href]")]
      .filter(el => el.getClientRects().length && (el.tagName === "BUTTON" || el.parentElement?.textContent?.trim() === el.textContent?.trim()))
      .filter(el => el.getBoundingClientRect().height < 24)
      .map(el => (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40)));
    expect(short).toEqual([]);
  });
}
