import { test, expect } from "@playwright/test";

const kayak = "44ff11ab-c697-47de-9227-0ffa51db127c";
const claire = "af17838c-fdd6-4b84-97c0-1cea39db7c0a";
const publicHosts = process.env.KAYAK_DEMO_PUBLIC_HOSTS === "1";

test.beforeEach(async ({ page }) => {
  // This hosted check can read public data and navigate calendars only.
  // Block every write, including booking creation and payment/provider calls.
  await page.route("**/*", route => ["GET", "HEAD", "OPTIONS"].includes(route.request().method()) ? route.continue() : route.abort());
});

test("Kayak retains the original tour-card layout with populated tours and working photos", async ({ page }, testInfo) => {
  const response = await page.goto(publicHosts ? "/" : `/?business_id=${kayak}`);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["content-security-policy"]).toContain("https://*.supabase.co");
  await expect(page.getByRole("heading", { name: "A little salt air. A whole new perspective." })).toHaveCount(0);
  await expect(page.locator('[data-shot="tour-card"]')).toHaveCount(3);
  await expect(page.locator('button[data-shot="tour-card"]').first()).toHaveClass(/glass/);
  await expect(page.locator("article")).toHaveCount(0);
  for (const name of ["Morning Kayak", "Sunset Paddle", "Midday Hike"]) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  for (const photo of await page.locator("main img").all()) await photo.scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator("main img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: `/private/tmp/capekayak-kayak-restored-${publicHosts ? "public" : "hosted"}-${testInfo.project.name}.png`, fullPage: true });
});

test("calendar reaches guest details while the cookie notice stays clear of the mobile button", async ({ page }, testInfo) => {
  await page.goto(`/book?tour=96e07644-315b-4e96-8f36-bb070b665cf8${publicHosts ? "" : `&business_id=${kayak}`}`);
  await expect(page.locator('[data-shot="calendar-day"]:enabled').first()).toBeVisible();
  await page.locator('[data-shot="calendar-day"]:enabled').first().click();
  await page.locator("button[data-slot-id]").first().click();
  if (testInfo.project.name !== "desktop") {
    const continueButton = await page.getByRole("button", { name: /Continue to details/i }).filter({ visible: true }).first().boundingBox();
    const cookieButton = await page.getByRole("button", { name: "OK", exact: true }).boundingBox();
    expect(continueButton && cookieButton).toBeTruthy();
    expect(cookieButton!.y + cookieButton!.height).toBeLessThan(continueButton!.y);
  }
  await page.getByRole("button", { name: /Continue to details/i }).filter({ visible: true }).first().click();
  await expect(page.locator("#book-name")).toBeVisible();
  await expect(page.locator("#book-email")).toBeVisible();
  await expect(page.getByText("Morning Kayak", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test("Claires retains its own tour catalog and tenant branding", async ({ page }) => {
  await page.goto(publicHosts ? "https://claires-hiking.booking.bookingtours.co.za/" : `/?business_id=${claire}`);
  await expect(page.locator('[data-shot="tour-card"]')).toHaveCount(5);
  await expect(page.getByRole("heading", { name: "A little salt air. A whole new perspective." })).toHaveCount(0);
  await expect(page.getByText("Payments run in test mode", { exact: false })).toHaveCount(0);
});
