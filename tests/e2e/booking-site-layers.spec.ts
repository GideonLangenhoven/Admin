import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixtureNow, slots, tourId } from "../helpers/booking-guest-fixture.cjs";

// Round 2, booking site layering and cookie choice on phones and tablets (R1 to R5).
const fixtureUrl = "http://127.0.0.1:3117";
const book = `/book?tour=${tourId}&slot=${slots[0].id}&date=2026-10-03`;
const phones = [[320, 568], [375, 667], [390, 844]] as const;

// The element is what a tap at its centre reaches: nothing fixed sits on it.
const unobstructed = (locator: Locator) => locator.evaluate(el => {
  const r = el.getBoundingClientRect();
  const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return !!top && (top === el || el.contains(top));
});

// A tap at the element's centre lands on the cookie banner (the fixed layer
// that talks about cookies). Off-screen elements are never under it.
const underCookieBanner = (locator: Locator) => locator.evaluate(el => {
  const r = el.getBoundingClientRect();
  let layer = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  while (layer && getComputedStyle(layer).position !== "fixed") layer = layer.parentElement;
  return !!layer && !layer.contains(el) && /cookie/i.test(layer.textContent || "");
});

// Page text about money or paying (prices, totals, Pay, the secure-payment
// note) that the floating chat launcher overlaps.
const underLauncher = (page: Page) => page.evaluate(() => {
  const launcher = document.querySelector('button[aria-label="Open chat"]')?.getBoundingClientRect();
  if (!launcher?.width) return [];
  return [...document.querySelectorAll("main *, footer *")].filter(el => {
    const text = [...el.childNodes].filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.textContent).join("");
    if (!/R\s?\d|\bPay\b|secure|card/i.test(text)) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.left < launcher.right && r.right > launcher.left && r.top < launcher.bottom && r.bottom > launcher.top;
  }).map(el => (el.textContent || "").trim().slice(0, 40));
});

const toBottom = (page: Page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
const scrollToFraction = (page: Page, fraction: number) => page.evaluate(f => window.scrollTo(0, (document.documentElement.scrollHeight - innerHeight) * f), fraction);

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

  test("R4: the chat launcher never sits on prices, totals or Pay", async ({ page }) => {
    for (const [width, height] of [...phones, [768, 1024], [1024, 768], [1280, 800]] as const) {
      await page.setViewportSize({ width, height });
      for (const step of ["calendar", "details", "voucher"]) {
        if (step === "calendar") await page.goto(book);
        if (step === "details") await page.getByRole("button", { name: /Continue to details/i }).filter({ visible: true }).click();
        if (step === "voucher") await page.goto("/voucher");
        await expect(page.locator("main").getByText(/R\s?\d/).filter({ visible: true }).first()).toBeVisible();
        for (const at of [0, 0.25, 0.5, 0.75, 1]) {
          await scrollToFraction(page, at);
          expect(await underLauncher(page), `${width}x${height} ${step} at ${at * 100}%`).toEqual([]);
        }
      }
    }
  });

  test("R4: below xl, checkout pages open the chat from the page", async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto(book);
    await expect(page.getByRole("button", { name: "Open chat" })).toBeHidden();
    const prompt = page.getByRole("button", { name: "Chat with us" });
    await prompt.click();
    const chat = page.getByRole("dialog", { name: /assistant/ });
    await expect(chat).toBeVisible();
    await chat.getByRole("button", { name: "Close chat" }).click();
    await expect(chat).toBeHidden();
    await expect(prompt).toBeFocused();
  });
});

test.describe("on a first visit", () => {
  test("R2: the cookie banner never covers checkout", async ({ page }) => {
    for (const [width, height] of [...phones, [768, 1024], [1024, 768]] as const) {
      await page.setViewportSize({ width, height });
      await page.goto(book);
      const banner = page.locator("div.fixed").filter({ hasText: /cookies/i }).last();
      await expect(banner).toBeVisible();
      for (const step of ["calendar", "details"]) {
        if (step === "details") await page.getByRole("button", { name: /Continue to details/i }).filter({ visible: true }).click();
        const bar = page.locator(`[data-mobile-booking-bar="${step}"]`);
        if (width < 768) {
          const [b, s] = [await banner.boundingBox(), await bar.boundingBox()];
          expect(b!.y + b!.height, `${width}x${height} ${step}: banner sits above the checkout bar`).toBeLessThanOrEqual(s!.y);
        }
        const controls = bar.locator("a, button").or(page.getByRole("button", { name: /^(Continue to details|Pay R)/i })).filter({ visible: true });
        await expect(controls.first()).toBeVisible();
        for (const at of [0, 0.25, 0.5, 0.75, 1]) {
          await scrollToFraction(page, at);
          for (const control of await controls.all()) {
            expect(await underCookieBanner(control), `${width}x${height} ${step} at ${at * 100}%: ${await control.textContent()}`).toBe(false);
          }
        }
      }
    }
  });

  for (const [width, height] of [[375, 667], [768, 1024]] as const) {
    test(`R3: at ${width}px the chat launcher waits until the cookie banner is answered`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto("/");
      // Kayak and Aonyx have no bottom nav, so their launcher sits at the
      // screen edge, on the banner: test that worst case.
      await page.evaluate(() => document.body.removeAttribute("data-mobile-bottom-nav"));
      const banner = page.locator("div.fixed").filter({ hasText: /cookies/i }).last();
      const launcher = page.getByRole("button", { name: "Open chat" });
      await expect(banner).toBeVisible();
      for (const button of await banner.getByRole("button").all()) {
        expect(await unobstructed(button), `${await button.textContent()} is tappable`).toBe(true);
      }
      await expect(launcher).toBeHidden();
      await banner.getByRole("button").first().click();
      await expect(banner).toBeHidden();
      await expect(launcher).toBeVisible();
    });
  }

  test("R5: the cookie banner offers a real choice, remembers it and reopens from the footer", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator("[data-cookie-banner]");
    const consent = () => page.evaluate(() => localStorage.getItem("cookie-consent"));
    for (const name of ["Accept all", "Reject non-essential", "Settings"]) await expect(banner.getByRole("button", { name })).toBeVisible();
    // Opaque: a solid colour (rgba would be see-through) and no frosted blur.
    const look = await banner.locator("section").evaluate(el => ({ bg: getComputedStyle(el).backgroundColor, blur: getComputedStyle(el).backdropFilter }));
    expect(look.bg).toMatch(/^rgb\(/);
    expect(look.blur).toBe("none");
    // The title takes the banner's ink, not the theme's heading colour (white on white on dark themes).
    await page.addStyleTag({ content: "html, body, body * { --text: rgb(255, 255, 255) !important; }" });
    const ink = await banner.locator("section").evaluate(el => getComputedStyle(el).color);
    await expect(banner.getByRole("heading", { name: "Cookies" })).toHaveCSS("color", ink);

    await banner.getByRole("button", { name: "Reject non-essential" }).click();
    await expect(banner).toBeHidden();
    expect(await consent()).toBe("essential");
    await page.reload();
    await expect(page.getByRole("heading", { name: "Fresh air. A different perspective." })).toBeVisible();
    await expect(banner).toBeHidden();

    const settings = page.locator("footer").getByRole("button", { name: "Cookie settings" });
    await settings.click();
    const performance = banner.getByRole("checkbox", { name: /Performance/ });
    await expect(performance).toBeFocused();
    await expect(performance).not.toBeChecked();
    await expect(banner.getByRole("checkbox", { name: /Essential/ })).toBeDisabled();
    await performance.check();
    await banner.getByRole("button", { name: "Save choices" }).click();
    await expect(banner).toBeHidden();
    await expect(settings).toBeFocused();
    expect(await consent()).toBe("all");
  });
});
