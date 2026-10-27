import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import current from "../fixtures/catalogue-current.json";
import { contrast, type RGB } from "../../booking/lib/theme-engine";

const backend = "http://127.0.0.1:3147";
const guest = "http://127.0.0.1:3146";
const { businessId, fixtureNow, slots } = current;
const tours = current.tours.map((tour, sort_order) => ({ ...tour, business_id: businessId, sort_order, active: true, hidden: false, duration_minutes: 120 }));
const theme = { ...current.theme, id: businessId, subscription_status: "ACTIVE", subdomain: "kayak", timezone: "Africa/Johannesburg", logo_url: "/__catalogue_photos/logo.jpg", booking_site_url: guest };
const longTours = [...tours, ...tours.map((tour, index) => ({ ...tour, id: `20000000-0000-4000-8000-00000000000${index + 4}`, name: ["A guided coastal paddle with mountain views and time to explore the sheltered coves", "Sunset and wildlife along the quiet coastline, with a small group and a local guide", "Mountain views, forest paths and a leisurely walk along the Atlantic coast"][index], sort_order: index + 3 }))];
const palettes = [
  { color_bg: "#e1e5f2", color_nav: "#ffffff", color_cta: "#1f7a8c" },
  { color_bg: "#cad2c5", color_nav: "#f2f4f0", color_cta: "#52796f" },
  { color_bg: "#f5ebe0", color_nav: "#ffffff", color_cta: "#d5bdaf" },
  { color_bg: "#fcf6bd", color_nav: "#ffffff", color_cta: "#ff99c8" },
  { color_bg: "#022b3a", color_nav: "#022b3a", color_cta: "#fcf6bd" },
  { color_bg: "#767676", color_nav: "#808080", color_cta: "#767676" },
];

async function inspect(page: Page, scope = ".catalogue-page") {
  const checks = await page.locator(scope).evaluate(root => {
    const cards = Array.from(root.querySelectorAll<HTMLElement>(".catalogue-card"));
    const header = root.classList.contains("catalogue-page") ? document.querySelector(".catalogue-header") : root.querySelector(".catalogue-header");
    return {
      overflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth,
      clipped: cards.flatMap(card => Array.from(card.querySelectorAll<HTMLElement>("h3, .catalogue-description, .catalogue-price, .catalogue-action")))
        .filter(element => element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1).map(element => element.textContent),
      targets: cards.map(card => card.querySelector(".catalogue-action")!.getBoundingClientRect().height),
      contrast: cards.flatMap(card => Array.from(card.querySelectorAll<HTMLElement>("h3, .catalogue-supporting, .catalogue-description, .catalogue-price, .catalogue-price span, .catalogue-action"))).map(element => ({
        text: element.textContent,
        ink: getComputedStyle(element).color,
        surface: getComputedStyle(element.classList.contains("catalogue-action") ? element : element.closest(".catalogue-card")!).backgroundColor,
        overlay: element.classList.contains("catalogue-action") ? getComputedStyle(element).backgroundImage : "none",
      })).concat(Array.from(header?.querySelectorAll<HTMLElement>("h1, .catalogue-brand-name, .catalogue-brand p, .catalogue-nav a") || []).map(element => ({
        text: element.textContent, ink: getComputedStyle(element).color,
        surface: getComputedStyle(header!).backgroundColor, overlay: "none",
      }))),
      phoneLauncher: (() => {
        if (!root.classList.contains("catalogue-page") || innerWidth >= 480) return null;
        const launcher = document.querySelector('[aria-label="Open chat"]');
        if (!launcher) return null;
        const box = launcher.getBoundingClientRect();
        const headerBox = header!.getBoundingClientRect();
        return {
          width: box.width, height: box.height,
          withinHeader: box.top >= headerBox.top && box.bottom <= headerBox.bottom,
          collisions: Array.from(document.querySelectorAll(".catalogue-brand, .catalogue-nav a, .catalogue-card h3, .catalogue-price, .catalogue-action"))
            .filter(element => {
              const target = element.getBoundingClientRect();
              // The opaque sticky header hides card content that scrolls beneath it.
              const visibleTop = element.closest(".catalogue-card") ? Math.max(target.top, headerBox.bottom) : target.top;
              return box.left < target.right && box.right > target.left && box.top < target.bottom && box.bottom > visibleTop;
            }).map(element => element.textContent),
        };
      })(),
      bottoms: cards.map(card => card.querySelector(".catalogue-action")!.getBoundingClientRect().bottom),
    };
  });
  expect(checks.overflow).toBeLessThanOrEqual(1);
  expect(checks.clipped).toEqual([]);
  expect(checks.targets.every(height => height >= 44)).toBe(true);
  if (checks.phoneLauncher) {
    expect(checks.phoneLauncher.width).toBeGreaterThanOrEqual(44);
    expect(checks.phoneLauncher.height).toBeGreaterThanOrEqual(44);
    expect(checks.phoneLauncher.withinHeader).toBe(true);
    expect(checks.phoneLauncher.collisions).toEqual([]);
  }
  const rgb = (value: string) => value.match(/[\d.]+/g)!.slice(0, 3).map(Number) as RGB;
  for (const row of checks.contrast) {
    const base = rgb(row.surface);
    const alpha = Number(row.ink.match(/[\d.]+/g)![3] || 1);
    const ink = rgb(row.ink).map((channel, i) => channel * alpha + base[i] * (1 - alpha)) as RGB;
    let surface = base;
    const overlay = row.overlay.match(/rgba\(([^)]+)\)/);
    if (overlay) {
      const channels = overlay[1].split(",").map(Number);
      surface = base.map((channel, i) => channels[i] * channels[3] + channel * (1 - channels[3])) as RGB;
    }
    expect(contrast(ink, surface), row.text || "Catalogue text").toBeGreaterThanOrEqual(4.49);
  }
  return checks;
}

async function ready(page: Page, count: number) {
  await expect(page.locator(".catalogue-page .catalogue-card")).toHaveCount(count);
  await page.evaluate(() => document.fonts.ready);
  for (const image of await page.locator(".catalogue-photo img").all()) await image.scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator(".catalogue-photo img").evaluateAll(images => images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0))).toBe(true);
  await page.evaluate(() => scrollTo(0, 0));
}

async function photographPreview(page: Page, path: string) {
  const preview = page.locator("[data-booking-preview]");
  const viewport = page.viewportSize()!;
  // The admin scrolls inside its app shell. Fit the complete preview in the
  // capture viewport so sticky admin chrome cannot obscure its top rows.
  await page.setViewportSize({ width: viewport.width, height: Math.ceil((await preview.boundingBox())!.height) + 240 });
  await preview.scrollIntoViewIfNeeded();
  await preview.screenshot({ path });
  await page.setViewportSize(viewport);
}

test.beforeEach(async ({ page, request }) => {
  await request.post(`${backend}/__fixture/reset`, { data: { theme, tours } });
  await page.clock.install({ time: new Date(fixtureNow) });
  await page.clock.setFixedTime(new Date(fixtureNow));
  await page.addInitScript(() => localStorage.setItem("cookie-consent-accepted", "true"));
  await page.routeWebSocket(/supabase|realtime/i, () => {});
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "127.0.0.1") return route.abort();
    if (!["GET", "HEAD", "OPTIONS"].includes(route.request().method())) return route.fulfill({ status: 403, json: { error: "Submissions disabled for visual verification" } });
    if (url.pathname.startsWith("/__catalogue_photos/")) return route.fulfill({ contentType: "image/jpeg", body: readFileSync("/private/tmp/capekayak-kayak-demo-photos/" + url.pathname.split("/").pop()) });
    if (url.pathname.startsWith("/api/")) return route.fulfill({ status: 403, json: { error: "Other actions disabled in this fixture" } });
    return route.continue();
  });
});

test.afterEach(async ({ request }) => {
  const state = await (await request.get(`${backend}/__fixture/state`)).json();
  expect(state.bookings).toEqual([]);
  expect(state.providerCalls).toBe(0);
  expect(state.prepareCalls).toBe(0);
});

test("current three tours show shallower photos, authoritative text prices and one action", async ({ page }, info) => {
  await page.goto("/");
  await ready(page, 3);
  await expect(page.locator(".catalogue-intro")).toHaveCount(0);
  const checks = await inspect(page);
  for (let i = 0; i < tours.length; i++) {
    const card = page.locator(".catalogue-card").nth(i);
    await expect(card.getByRole("heading")).toHaveText(tours[i].name);
    await expect(card.locator(".catalogue-price")).toHaveText(`R${tours[i].base_price_per_person}per person`);
    await expect(card.getByRole("link")).toHaveCount(1);
    await expect(card.getByRole("link")).toHaveAttribute("href", "/book?tour=" + tours[i].id);
    const box = (await card.locator(".catalogue-photo").boundingBox())!;
    expect(box.width / box.height).toBeCloseTo(16 / 9, 1);
    await expect(card.locator(".catalogue-photo")).not.toContainText(/R\d+/);
  }
  if (info.project.name === "desktop-chrome") expect(Math.max(...checks.bottoms) - Math.min(...checks.bottoms)).toBeLessThanOrEqual(1);
  for (const label of ["Gift Voucher", "My Bookings"]) await expect(page.locator(".catalogue-header").getByRole("link", { name: label, exact: true })).toBeVisible();
  await page.screenshot({ path: `/private/tmp/capekayak-catalogue-${info.project.name}.png`, fullPage: true });
  await page.setViewportSize({ width: 320, height: 844 });
  await inspect(page);
  await page.screenshot({ path: `/private/tmp/capekayak-catalogue-320-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Open chat", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Close chat", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await inspect(page);
});

test("six tours, long titles, saved palettes, busy backgrounds and differing font metrics reflow", async ({ page, request }, info) => {
  const width = info.project.name === "desktop-chrome" ? 1440 : 320;
  await page.setViewportSize({ width, height: 900 });
  for (let i = 0; i < palettes.length; i++) {
    const chosenTheme = { ...theme, ...palettes[i], business_name: "Coastal & Mountain Adventures", hero_image: i % 2 ? tours[i % 3].image_url : null };
    await request.post(`${backend}/__fixture/reset`, { data: { theme: chosenTheme, tours: longTours } });
    await page.goto("/");
    await ready(page, 6);
    const family = ["Arial, sans-serif", "Georgia, serif", "Courier New, monospace"][i % 3];
    await page.locator("body").evaluate((body, family) => {
      body.style.fontFamily = family;
      body.style.setProperty("--font-display", family);
    }, family);
    await inspect(page);
    expect(await page.locator(".catalogue-card h3").last().evaluate(element => getComputedStyle(element).fontFamily)).toContain(family.split(",")[0]);
    await expect(page.locator(".glass-backdrop > img")).toHaveCount(chosenTheme.hero_image ? 1 : 0);
    if (chosenTheme.hero_image) await expect(page.locator(".glass-backdrop > img")).toHaveAttribute("src", chosenTheme.hero_image);
    if (i === 2) await page.screenshot({ path: `/private/tmp/capekayak-catalogue-six-${info.project.name}.png`, fullPage: true });
    if (i === 4) await page.screenshot({ path: `/private/tmp/capekayak-catalogue-dark-${info.project.name}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 768, height: 1024 });
  await inspect(page);
  await page.setViewportSize({ width: 320, height: 844 });
  await page.addStyleTag({ content: "html { font-size: 200%; }" });
  await inspect(page);
  await page.screenshot({ path: `/private/tmp/capekayak-catalogue-zoom-${info.project.name}.png`, fullPage: true });
  await page.screenshot({ path: `/private/tmp/capekayak-catalogue-zoom-viewport-${info.project.name}.png` });
});

test("absent prices and photographs stay absent; zero remains a real price", async ({ page, request }) => {
  await request.post(`${backend}/__fixture/reset`, { data: { theme, tours: tours.map((tour, i) => ({ ...tour, base_price_per_person: i === 0 ? null : i === 1 ? 0 : 700, image_url: i === 0 ? null : tour.image_url })) } });
  await page.goto("/");
  await ready(page, 3);
  await expect(page.locator(".catalogue-card").first().locator(".catalogue-price, .catalogue-photo")).toHaveCount(0);
  await expect(page.locator(".catalogue-card").nth(1).locator(".catalogue-price")).toHaveText("R0per person");
  await inspect(page);
});

test("keyboard focus, whole-card navigation, voucher/bookings links and slot deep links retain destinations", async ({ page, request, browserName }) => {
  await page.goto("/");
  await ready(page, 3);
  for (const target of [".catalogue-brand", '.catalogue-nav a[href="/voucher"]', '.catalogue-nav a[href="/my-bookings"]', ".catalogue-card .catalogue-action"]) {
    // WebKit on macOS uses Option-Tab to include links in keyboard navigation.
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    await expect(page.locator(target).first()).toBeFocused();
    expect(await page.locator(target).first().evaluate(element => getComputedStyle(element).outlineStyle)).toBe("solid");
  }
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(new RegExp("/book\\?tour=" + tours[0].id));
  await page.goto("/");
  await ready(page, 3);
  await page.locator(".catalogue-card").nth(1).click();
  await expect(page).toHaveURL(new RegExp("/book\\?tour=" + tours[1].id));
  for (const [label, path] of [["Gift Voucher", "/voucher"], ["My Bookings", "/my-bookings"]]) {
    await page.goto("/");
    await ready(page, 3);
    await page.locator(".catalogue-header").getByRole("link", { name: label, exact: true }).click();
    await expect(page).toHaveURL(guest + path);
  }
  const fixtureSlot = { ...slots[0], tour_id: tours[0].id };
  await request.post(`${backend}/__fixture/reset`, { data: { theme, tours, slots: [fixtureSlot] } });
  await page.goto(`/book?tour=${tours[0].id}&slot=${fixtureSlot.id}&date=${encodeURIComponent(fixtureSlot.start_time)}`);
  await expect(page.locator("[data-selected-tour]")).toContainText(tours[0].name);
  await expect(page.getByText("R625").first()).toBeVisible();
  await expect(page.getByRole("button", { name: /Continue to details/i }).filter({ visible: true })).toBeEnabled();
});

test("Booking Page Preview shares tours, styling, background and unsaved configuration changes", async ({ page, request }, info) => {
  const user = { id: "50000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "operator@example.invalid", app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, created_at: fixtureNow };
  const exp = Math.floor(Date.parse(fixtureNow) / 1000) + 86400;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const session = { access_token: `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ aud: "authenticated", sub: user.id, role: "authenticated", exp })}.mock-signature`, refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 86400, expires_at: exp, user };
  await page.context().addCookies([{ name: "ck_session_hint", value: "1", url: "http://127.0.0.1:3148" }, { name: "ck_admin_role", value: "MAIN_ADMIN", url: "http://127.0.0.1:3148" }]);
  await page.addInitScript(({ session, businessId }) => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify(session));
    for (const [key, value] of Object.entries({ ck_admin_email: "operator@example.invalid", ck_admin_time: String(Date.now()), ck_admin_auth: "true", ck_admin_role: "MAIN_ADMIN", ck_admin_business_id: businessId, ck_admin_settings_perms: "{}", ck_welcome_done: "1" })) localStorage.setItem(key, value);
  }, { session, businessId });
  await page.goto("http://127.0.0.1:3148/settings#site");
  const preview = page.locator("[data-booking-preview]");
  await expect(preview.locator(".catalogue-card")).toHaveCount(3);
  await expect(preview.locator(".catalogue-intro")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Open booking page" })).toHaveAttribute("href", guest);
  await expect(preview.locator(".catalogue-price").first()).toHaveText("R600per person");
  await expect(preview.locator(".catalogue-action").first()).toHaveAttribute("href", guest + "/book?tour=" + tours[0].id);
  await inspect(page, "[data-booking-preview]");
  const settings = page.locator("#site");
  await settings.getByPlaceholder("Book Now", { exact: true }).fill("Choose a departure");
  await expect(preview.locator(".catalogue-action").first()).toHaveText("Choose a departure");
  await settings.getByPlaceholder("Gift Voucher", { exact: true }).fill("Gift an adventure");
  await expect(preview.getByRole("link", { name: "Gift an adventure", exact: true })).toHaveAttribute("href", guest + "/voucher");
  await settings.getByPlaceholder("My Bookings", { exact: true }).fill("View your bookings");
  await expect(preview.getByRole("link", { name: "View your bookings", exact: true })).toHaveAttribute("href", guest + "/my-bookings");
  await settings.getByPlaceholder("Find Your Perfect Paddle", { exact: true }).fill("Choose your next adventure");
  await expect(preview.getByRole("heading", { name: "Choose your next adventure" })).toBeVisible();
  await settings.locator('input[type="text"][value="#e1e5f2"]').fill("#022b3a");
  await expect(preview.locator(".catalogue-card").first()).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(preview).toHaveCSS("background-color", "rgb(2, 43, 58)");
  await inspect(page, "[data-booking-preview]");
  await photographPreview(page, `/private/tmp/capekayak-catalogue-settings-${info.project.name}.png`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  // A saved busy background and six real-shaped tours reload through the
  // existing settings reads; no upload or save action is performed.
  await request.post(`${backend}/__fixture/reset`, { data: { theme: { ...theme, hero_image: tours[0].image_url }, tours: longTours } });
  await page.reload();
  await expect(preview.locator(".catalogue-card")).toHaveCount(6);
  await expect(preview.locator(".catalogue-backdrop img")).toHaveAttribute("src", tours[0].image_url);
  await expect(preview.locator(".catalogue-card h3").last()).toHaveText(longTours[5].name);
  await expect(preview).toHaveCSS("background-color", "rgb(2, 43, 58)");
  await inspect(page, "[data-booking-preview]");
  await photographPreview(page, `/private/tmp/capekayak-catalogue-settings-six-${info.project.name}.png`);
});
