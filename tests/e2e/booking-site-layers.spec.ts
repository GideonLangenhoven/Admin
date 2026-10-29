import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixtureNow, slots, tourId } from "../helpers/booking-guest-fixture.cjs";

// Round 2, booking site layering on phones and tablets (R1).
const fixtureUrl = "http://127.0.0.1:3117";
const book = `/book?tour=${tourId}&slot=${slots[0].id}&date=2026-10-03`;
const phones = [[320, 568], [375, 667], [390, 844]] as const;

// The element is what a tap at its centre reaches: nothing fixed sits on it.
const unobstructed = (locator: Locator) => locator.evaluate(el => {
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return !!top && (top === el || el.contains(top));
});

const toBottom = (page: Page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));

test.beforeEach(async ({ page, request }) => {
  await request.post(`${fixtureUrl}/__fixture/reset`, { data: {} });
  await page.clock.install({ time: new Date(fixtureNow) });
  await page.clock.setFixedTime(new Date(fixtureNow));
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});

test.describe("with cookies already answered", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("cookie-consent-accepted", "true"));
  });

  test("R1: on phones every footer link scrolls clear of the checkout bar", async ({ page }) => {
    for (const [width, height] of phones) {
      await page.setViewportSize({ width, height });
      await page.goto(book);
      for (const step of ["calendar", "details"]) {
        if (step === "details") await page.getByRole("button", { name: /Continue to details/i }).filter({ visible: true }).click();
        await expect(page.locator(`[data-mobile-booking-bar="${step}"]`)).toBeVisible();
        await toBottom(page);
        const footer = page.locator("footer");
        for (const link of [
          footer.getByRole("link", { name: "Terms & Conditions" }), footer.getByRole("link", { name: "Privacy Policy" }),
          footer.getByRole("link", { name: "Cookies Policy" }), footer.getByRole("link", { name: "Privacy Request" }),
          footer.locator('a[href="https://bookingtours.co.za"]'),
        ]) {
          expect(await unobstructed(link), `${width}x${height} ${step}: ${await link.textContent()}`).toBe(true);
        }
      }
    }
  });

  test("R1: the page opts into the iPhone safe area", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /viewport-fit=cover/);
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute("content", /width=device-width, initial-scale=1/);
  });
});

