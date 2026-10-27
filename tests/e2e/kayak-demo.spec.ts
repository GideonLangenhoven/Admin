import { test, expect } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  // Actual provider APIs are never reachable from this test browser.
  await page.route("**/*", async route => {
    if (new URL(route.request().url()).hostname !== "127.0.0.1") return route.abort();
    if (route.request().resourceType() !== "document") return route.continue();
    const response = await route.fetch();
    const headers = response.headers();
    if (headers["content-security-policy"]) headers["content-security-policy"] = headers["content-security-policy"].replace("connect-src 'self'", "connect-src 'self' http://127.0.0.1:3107");
    return route.fulfill({ response, headers });
  });
});

test("Kayak storefront shows real tour details and photographs without overflow", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "A little salt air. A whole new perspective." })).toHaveCount(0);
  for (const name of ["Morning Kayak", "Sunset Paddle", "Midday Hike"]) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.locator('[data-shot="tour-card"]')).toHaveCount(3);
  await expect(page.locator('[data-shot="tour-card"]').first()).toContainText("R600");
  for (const photo of await page.locator("main img").all()) await photo.scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator("main img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `/private/tmp/capekayak-kayak-${testInfo.project.name}.png`, fullPage: true });
});

test("tour link opens the correct calendar and reaches the isolated payment screen", async ({ page }, testInfo) => {
  await page.goto("/");
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.locator('[data-shot="tour-card"]').first().click();
  await expect(page).toHaveURL(/book\?tour=96e07644-315b-4e96-8f36-bb070b665cf8/);
  await expect(page.locator('[data-shot="calendar-day"]:enabled').first()).toBeVisible();
  await page.locator('[data-shot="calendar-day"]:enabled').first().click();
  await page.getByRole("button", { name: /08:30/ }).click();
  await page.screenshot({ path: `/private/tmp/capekayak-kayak-calendar-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: /Continue/ }).filter({ visible: true }).first().click();
  await page.locator("#book-name").fill("Local demo guest");
  await page.locator("#book-email").fill("local-demo@example.invalid");
  await page.locator("#book-phone").fill("000000001");
  await page.locator("#book-terms").check();
  await page.getByRole("button", { name: /Pay|payment|Reserve/i }).filter({ visible: true }).first().click();
  await expect(page).toHaveURL("http://127.0.0.1:3106/fixture-payment");
  const state = await (await page.request.get("http://127.0.0.1:3107/__fixture/state")).json();
  expect(state.checkoutRequests).toBeGreaterThan(0);
  expect(state.bookings.at(-1)).toMatchObject({ tour_id: "96e07644-315b-4e96-8f36-bb070b665cf8", qty: 1, total_amount: 600 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
