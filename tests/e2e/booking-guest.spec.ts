import { expect, test, type Page } from "@playwright/test";
import { fixtureNow, otherTourId, slots, theme, tourId, tours } from "../helpers/booking-guest-fixture.cjs";

const fixtureUrl = "http://127.0.0.1:3117";
const evidence = "/private/tmp/capekayak-booking-guest-evidence";
const continueButton = (page: Page) => page.getByRole("button", { name: /Continue to details/i }).filter({ visible: true });
async function noOverflow(page: Page) {
  expect(await page.evaluate(() => Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth)).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page, request }) => {
  await request.post(`${fixtureUrl}/__fixture/reset`, { data: {} });
  await page.clock.install({ time: new Date(fixtureNow) });
  await page.clock.setFixedTime(new Date(fixtureNow));
  await page.addInitScript(() => localStorage.setItem("cookie-consent-accepted", "true"));
  await page.route("**/*", route => new URL(route.request().url()).hostname === "127.0.0.1" ? route.continue() : route.abort());
});

for (const viewport of [{ width: 1366, height: 768 }, { width: 1440, height: 900 }, { width: 320, height: 568 }, { width: 390, height: 844 }]) {
  test(`catalogue first screen ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.slow(); // The isolated Next.js preview may compile routes on first use.
    await page.setViewportSize(viewport);
    await page.goto("/");
    const cards = page.locator('[data-shot="tour-card"]');
    await expect(cards).toHaveCount(3);
    await expect(page.getByRole("heading", { name: theme.hero_title })).toBeVisible();
    for (const image of await cards.locator("img").all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    }
    await page.evaluate(() => scrollTo(0, 0));
    await noOverflow(page);
    const stage = process.env.BOOKING_GUEST_CAPTURE || "after";
    await page.screenshot({ path: `${evidence}/catalogue-${stage}-${viewport.width}x${viewport.height}.png` });
    const name = cards.first().getByRole("heading");
    const box = await name.boundingBox();
    console.log(`${stage} ${viewport.width}x${viewport.height}: first tour name bottom=${Math.round((box?.y || 0) + (box?.height || 0))}`);
    // The restored hero allows long tour titles to wrap below the first screen.
    if (stage !== "before" && viewport.width >= 1024) await expect(cards.first()).toBeInViewport();
    await cards.first().scrollIntoViewIfNeeded();
    await expect(name).toBeInViewport({ ratio: 1 });
    await cards.first().focus();
    await expect(cards.first()).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("[data-selected-tour]")).toContainText(tours[0].name);
  });
}

test("calendar browsing retains the departure, distinguishes the booking horizon and returns to its month", async ({ page }) => {
  await page.goto(`/book?tour=${tourId}`);
  const selected = page.locator("[data-selected-departure]");
  await expect(selected).toContainText("3 October 2026");
  await expect(selected).toContainText("10:00");
  await expect(page.getByText(/All times shown in/)).toContainText("America/New_York");
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByText(/No bookable departures in November 2026/)).toBeVisible();
  await expect(page.getByText("Your selection is outside the displayed month.")).toBeVisible();
  await expect(continueButton(page)).toBeEnabled();
  await expect(selected).toContainText("3 October 2026");
  await page.getByRole("button", { name: "Next month" }).click();
  await expect(page.getByText(/Availability is currently shown through/)).toBeVisible();
  await expect(page.getByText(/No bookable departures in December/)).toHaveCount(0);
  await page.getByRole("button", { name: "Show selected month" }).click();
  await expect(page.locator("#booking-calendar-month")).toHaveText("October 2026");
  await expect(page.locator("#booking-calendar-month")).toBeFocused();
  await expect(page.getByRole("button", { name: /Saturday, 3 October 2026/ })).toHaveAttribute("aria-pressed", "true");
});

test("date-only and unavailable deep links never silently choose another departure", async ({ page }) => {
  await page.goto(`/book?tour=${tourId}&date=2026-10-03`);
  await expect(page.getByText("Choose a departure to see its cancellation deadline.")).toHaveCount(0); // published wording is shown before selection
  await expect(page.locator("[data-selected-departure]")).toHaveCount(0);
  await expect(page.locator("[data-slot-id]").first()).toHaveAttribute("aria-pressed", "false");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(continueButton(page)).toBeDisabled();
  await page.locator("[data-slot-id]").first().click();
  await expect(continueButton(page)).toBeEnabled();
  await page.goto(`/book?tour=${tourId}&slot=30000000-0000-4000-8000-000000000099&date=2026-10-03&source=widget`);
  await expect(page.getByText(/The linked departure is no longer available/)).toBeVisible();
  await expect(page.locator("[data-selected-departure]")).toHaveCount(0);
  await expect(page.locator("[data-slot-id]").first()).toHaveAttribute("aria-pressed", "false");
});

test("availability failure has a retry and never claims an empty month", async ({ page }) => {
  await page.route("**/rest/v1/slots?**", route => route.fulfill({ status: 503, json: { message: "Fixture request failure" } }));
  await page.goto(`/book?tour=${tourId}`);
  await expect(page.getByText("We couldn't load availability. Please try again.")).toBeVisible();
  await expect(page.getByText(/No bookable departures/)).toHaveCount(0);
  await expect(page.locator("[data-slot-id]")).toHaveCount(0);
  await page.unroute("**/rest/v1/slots?**");
  await page.getByRole("button", { name: "Retry availability" }).click();
  await expect(page.locator("[data-selected-departure]")).toContainText("3 October 2026");
});

test("a new tour link shows a loading state without the previous summary or deadline", async ({ page }) => {
  await page.goto(`/book?tour=${tourId}`);
  await expect(page.locator("[data-selected-tour]")).toContainText(tours[0].name);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/rest/v1/tours?**", async route => {
    if (new URL(route.request().url()).searchParams.get("id") === `eq.${otherTourId}`) await pending;
    await route.continue();
  });
  await page.evaluate(id => history.pushState(null, "", `/book?tour=${id}`), otherTourId);
  await expect(page.locator("[data-selected-tour]")).toHaveCount(0);
  await expect(page.locator("[data-cancellation-disclosure]")).toHaveCount(0);
  release();
  await expect(page.locator("[data-selected-tour]")).toContainText("Forest trail");
  await expect(page.locator("[data-selected-departure]")).toContainText("4 November 2026");
  await expect(page.locator("[data-selected-departure]")).toContainText("09:00");
});

test("missing, invalid and withdrawn tours present no bookable content", async ({ page, request }) => {
  await page.goto("/book");
  await expect(page.getByRole("heading", { name: "Choose a tour to book" })).toBeVisible();
  await page.goto("/book?tour=20000000-0000-4000-8000-000000000099");
  await expect(page.getByRole("heading", { name: "This tour is no longer available" })).toBeVisible();
  await expect(page.locator("[data-selected-tour], [data-slot-id], [data-cancellation-disclosure]")).toHaveCount(0);
  await page.goto(`/book?tour=${tourId}`);
  await expect(continueButton(page)).toBeEnabled();
  await request.post(`${fixtureUrl}/__fixture/reset`, { data: { tours: tours.map(tour => ({ ...tour, active: false })) } });
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "This tour is no longer available" })).toBeVisible();
});

test("sold-out and reduced capacity are revalidated without changing the selected date or quantity", async ({ page, request }) => {
  await page.goto(`/book?tour=${tourId}`);
  await page.getByRole("button", { name: "Add one guest" }).click();
  await request.post(`${fixtureUrl}/__fixture/reset`, { data: { slots: slots.map(slot => ({ ...slot, capacity_total: 1, booked: 0, held: 0 })) } });
  await continueButton(page).click();
  await expect(page.getByText(/Only 1 place is available/)).toBeVisible();
  await expect(page.locator("[data-selected-departure]")).toContainText("3 October 2026");
  await expect(continueButton(page)).toBeDisabled();
  await page.getByRole("button", { name: "Remove one guest" }).click();
  await expect(continueButton(page)).toBeEnabled();
  await request.post(`${fixtureUrl}/__fixture/reset`, { data: { slots: slots.map(slot => ({ ...slot, booked: slot.capacity_total })) } });
  await continueButton(page).click();
  await expect(page.getByText("Departure unavailable. Choose another time.")).toBeVisible();
  await expect(page.locator("[data-selected-departure]")).toContainText("3 October 2026");
});

test("policy follows a changed departure and retains keyboard access to full wording", async ({ page }) => {
  await page.goto(`/book?tour=${tourId}`);
  const policy = page.locator("#date-cancellation-policy");
  await expect(policy).toContainText("75% refund");
  await expect(policy).toContainText("1 October 2026 at 10:00");
  await page.getByRole("button", { name: /Sunday, 4 October 2026/ }).click();
  await page.locator("[data-slot-id]").first().click();
  await expect(policy).toContainText("2 October 2026 at 13:00");
  const fullPolicy = policy.locator("summary");
  await fullPolicy.focus();
  await page.keyboard.press("Enter");
  await expect(policy.getByText(theme.refund_policy_text, { exact: true })).toBeVisible();
  await expect(policy.getByRole("link", { name: "Booking terms" })).toHaveAttribute("href", "/terms");
  await expect(page.getByText("Flexible cancellation policy")).toHaveCount(0);
});

test("policy is correct before, at and after each boundary and updates without a reload", async ({ page, request }) => {
  for (const [hours, before, at, after] of [[48, 75, 75, 25], [6, 25, 25, 0]]) {
    const start = Date.parse(fixtureNow) + hours * 3_600_000;
    await request.post(`${fixtureUrl}/__fixture/reset`, { data: { slots: [{ ...slots[0], start_time: new Date(start).toISOString() }] } });
    await page.clock.setFixedTime(new Date(Date.parse(fixtureNow) - 1));
    await page.goto(`/book?tour=${tourId}`);
    const policy = page.locator("#date-cancellation-policy");
    await expect(policy).toContainText(`${before}% refund`);
    await page.clock.setFixedTime(new Date(fixtureNow));
    await page.clock.runFor(1000);
    await expect(policy).toContainText(`${at}% refund`);
    await page.clock.setFixedTime(new Date(Date.parse(fixtureNow) + 1));
    await page.clock.runFor(1000);
    await expect(policy).toContainText(after > 0 ? `${after}% refund` : "No cash refund for cancellation.");
    await expect(policy).toContainText(after > 0 ? "already inside a reduced-refund window" : "already inside the non-refundable cash-payment window");
  }
});

test("free-text and missing policies have no invented deadlines or reassurance", async ({ page, request }) => {
  const actual = "Please contact the operator about cancellations. Approved requests receive credit toward another departure.";
  await request.post(`${fixtureUrl}/__fixture/reset`, { data: { theme: { refund_policy_tiers: null, refund_policy_text: actual } } });
  await page.goto(`/book?tour=${tourId}`);
  await expect(page.locator("#date-cancellation-policy > p")).toHaveText(actual);
  await expect(page.locator("#date-cancellation-policy")).not.toContainText("the cash refund becomes");
  await request.post(`${fixtureUrl}/__fixture/reset`, { data: { theme: { refund_policy_tiers: null, refund_policy_text: null } } });
  await page.reload();
  await expect(page.locator("#date-cancellation-policy")).toContainText("Cancellation policy unavailable.");
});

for (const width of [320, 390]) {
  test(`mobile ${width}: long name, reading order, retained state and final total policy`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/book?tour=${tourId}&slot=${slots[0].id}&date=2026-10-03&source=widget`);
    await expect(page.locator("[data-selected-tour]")).toContainText(tours[0].name);
    await expect(page.locator("[data-selected-tour]")).toContainText("2 hours");
    await expect(page.locator("[data-selected-tour]")).toContainText("Visitor centre entrance");
    expect(await page.evaluate(() => !!(document.querySelector("[data-selected-tour]")!.compareDocumentPosition(document.querySelector('[data-shot="calendar"]')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await noOverflow(page);
    await page.getByRole("button", { name: "Next month" }).click();
    const retained = page.locator('[data-shot="calendar"] [role="status"]').first();
    await expect(retained).toContainText("3 October 2026 at 10:00 America/New_York");
    await expect(retained).toContainText("outside the displayed month");
    await page.getByRole("button", { name: "Show selected month" }).click();
    await page.screenshot({ path: `${evidence}/date-${width}.png`, fullPage: true });
    await continueButton(page).click();
    await expect(page.locator("#booking-step-heading")).toBeFocused();
    await expect(page.locator("#booking-cancellation-policy")).toContainText("75% refund");
    await expect(page.locator('[data-mobile-booking-bar="details"]')).toContainText("75% refund");
    await expect(page.locator('[data-mobile-booking-bar="details"]')).toContainText("R625");
    await noOverflow(page);
    await page.screenshot({ path: `${evidence}/details-${width}.png`, fullPage: true });
    await page.getByRole("button", { name: "Back to calendar" }).click();
    await expect(page.locator("[data-selected-departure]")).toContainText("3 October 2026");
    await expect(page.locator('[data-mobile-booking-bar="calendar"]')).toContainText("R625");
  });
}

test("departure day follows the operator timezone and the booking cutoff expires visibly", async ({ page, request }) => {
  const slot = { ...slots[0], start_time: "2026-10-03T01:00:00Z" };
  await request.post(`${fixtureUrl}/__fixture/reset`, { data: { slots: [slot] } });
  await page.goto(`/book?tour=${tourId}&slot=${slot.id}&date=2026-10-03`);
  await expect(page.locator("[data-selected-departure]")).toContainText("2 October 2026 at 21:00");
  await page.clock.setFixedTime(new Date(Date.parse(slot.start_time) - 3_600_000));
  await page.clock.runFor(1000);
  await expect(page.getByText("Departure unavailable. Choose another time.")).toBeVisible();
});

test("long catalogue headline wraps without overflow", async ({ page, request }) => {
  const headline = "Take the scenic route and discover a new perspective on the mountains, forests and coast with your local guides";
  await request.post(`${fixtureUrl}/__fixture/reset`, { data: { theme: { hero_title: headline } } });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: headline })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: `${evidence}/catalogue-long-headline-320.png`, fullPage: true });
});

test("checkout preserves departure, peak price and quantity", async ({ page, request }) => {
  await page.goto(`/book?tour=${tourId}`);
  await page.getByRole("button", { name: "Add one guest" }).click();
  await continueButton(page).click();
  await page.locator("#book-name").fill("Fixture guest");
  await page.locator("#book-email").fill("guest@example.invalid");
  await page.locator("#book-phone").fill("000000001");
  await page.locator("#book-terms").check();
  await page.getByRole("button", { name: /Pay R1250 now/ }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/fixture-payment/);
  const state = await (await request.get(`${fixtureUrl}/__fixture/state`)).json();
  expect(state.bookings).toHaveLength(1);
  expect(state.bookings[0]).toMatchObject({ tour_id: tourId, slot_id: slots[0].id, qty: 2, unit_price: 625, total_amount: 1250 });
});

test("a held checkout can still retry when its own seats fill the departure", async ({ page, request }) => {
  await request.post(`${fixtureUrl}/__fixture/reset`, { data: { slots: [{ ...slots[0], capacity_total: 1, booked: 0, held: 0 }], checkoutErrorOnce: true } });
  await page.goto(`/book?tour=${tourId}`);
  await continueButton(page).click();
  await page.locator("#book-name").fill("Fixture guest");
  await page.locator("#book-email").fill("guest@example.invalid");
  await page.locator("#book-phone").fill("000000001");
  await page.locator("#book-terms").check();
  const pay = page.getByRole("button", { name: /Pay R625 now/ }).filter({ visible: true });
  await pay.click();
  await expect(page.getByText("Fixture payment provider unavailable. Please retry.")).toBeVisible();
  const refreshed = page.waitForResponse(response => response.url().includes("/rest/v1/slots?"));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await refreshed;
  await expect(page.locator("#booking-cancellation-policy")).toContainText("75% refund");
  await expect(pay).toBeEnabled();
  await pay.click();
  await expect(page).toHaveURL(/fixture-payment/);
  expect((await (await request.get(`${fixtureUrl}/__fixture/state`)).json()).bookings).toHaveLength(1);
});

test("payment fallback retains the cancellation disclosure beside the server total", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`/book?tour=${tourId}`);
  await continueButton(page).click();
  await page.locator("#book-name").fill("Fixture guest");
  await page.locator("#book-email").fill("guest@example.invalid");
  await page.locator("#book-phone").fill("000000001");
  await page.locator("#book-terms").check();
  await page.route("**/functions/v1/create-checkout", route => route.fulfill({ json: { redirectUrl: "http://127.0.0.1:3116/fixture-payment", amount: 700, expires_at: "2026-10-01T08:15:00Z" } }));
  await page.getByRole("button", { name: /Pay R625 now/ }).filter({ visible: true }).click();
  await expect(page.getByRole("heading", { name: "Finalizing Checkout" })).toBeFocused();
  await expect(page.getByText("R700", { exact: true })).toBeVisible();
  await expect(page.locator("#payment-cancellation-policy")).toContainText("75% refund");
  await noOverflow(page);
});

for (const singleTour of [false, true]) {
  test(`embed starts compact with ${singleTour ? "one experience" : "multiple experiences"} and expands on request`, async ({ page, request }) => {
    test.slow();
    const visibleTours = singleTour ? tours.slice(0, 1) : tours;
    const now = new Date();
    await page.clock.setFixedTime(now);
    const upcomingSlots = slots.map((slot, index) => ({ ...slot, start_time: new Date(now.getTime() + (index + 1) * 86_400_000).toISOString() }));
    await request.post(`${fixtureUrl}/__fixture/reset`, { data: { tours: visibleTours, slots: upcomingSlots } });
    await page.setViewportSize({ width: singleTour ? 320 : 1366, height: 768 });
    await page.route("**/widget-preview", route => route.fulfill({
      contentType: "text/html",
      body: '<div id="bookingtours-widget" data-tenant="guest-fixture" data-host="http://127.0.0.1:3116"></div><script src="/widget.js"></script>',
    }));
    await page.goto("/widget-preview");
    const iframe = page.locator("#bookingtours-widget iframe");
    const widget = page.frameLocator("#bookingtours-widget iframe");
    const experience = widget.getByRole("button", { name: /Experience Choose an experience/ });
    await expect(experience).toBeVisible();
    await expect(experience).toHaveAttribute("aria-expanded", "false");
    await expect(widget.getByRole("listbox")).toHaveCount(0);
    await expect(widget.getByRole("link", { name: "Full calendar" })).toHaveCount(0);
    await expect(widget.getByText("Secure checkout", { exact: true })).toBeVisible();
    await expect(widget.getByRole("link", { name: "BookingTours", exact: true })).toBeVisible();
    await expect.poll(async () => (await iframe.boundingBox())!.height).toBeLessThan(300);
    expect(await widget.locator("body").evaluate(element => element.scrollWidth <= innerWidth)).toBe(true);
    await iframe.screenshot({ path: `${evidence}/widget-default-${singleTour ? "mobile" : "desktop"}.png` });

    await experience.focus();
    await page.keyboard.press("Enter");
    await expect(widget.getByRole("option")).toHaveCount(visibleTours.length);
    if (!singleTour) await expect.poll(async () => (await iframe.boundingBox())!.height).toBeGreaterThan(300);
    await widget.getByRole("option", { name: new RegExp(tours[0].name) }).click();
    await expect(widget.getByRole("listbox")).toHaveCount(0);
    await expect(widget.getByRole("link", { name: /^Book / }).first()).toBeVisible();
    await expect.poll(async () => (await iframe.boundingBox())!.height).toBeGreaterThan(300);
  });
}

test("embed calendar links resolve the same tour and departure", async ({ page }) => {
  test.slow(); // Both routes may compile on the isolated preview's first use.
  await page.goto(`/embed?tour=${tourId}`, { waitUntil: "domcontentloaded" });
  const fullCalendar = page.getByRole("link", { name: "Full calendar" });
  await expect(fullCalendar).toHaveAttribute("href", new RegExp(`/book\\?tour=${tourId}&source=widget`));
  const link = page.getByRole("link", { name: /Book .* at 10:00/ }).first();
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  await page.goto(href!, { waitUntil: "domcontentloaded" });
  await expect(page.locator("[data-selected-tour]")).toContainText(tours[0].name);
  await expect(page.locator("[data-selected-departure]")).toContainText("3 October 2026 at 10:00");
});

test("missing optional tour content is omitted and unbroken names wrap", async ({ page, request }) => {
  const name = "LongTourName".repeat(12);
  await request.post(`${fixtureUrl}/__fixture/reset`, { data: { tours: [{ ...tours[0], name, description: null, duration_minutes: null, meeting_point: null }] } });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto(`/book?tour=${tourId}`);
  const summary = page.locator("[data-selected-tour]");
  await expect(summary).toContainText(name);
  await expect(summary).not.toContainText("Meeting point:");
  await expect(summary).not.toContainText("0 min");
  await noOverflow(page);
});

test("a retimed departure is never silently substituted", async ({ page, request }) => {
  await page.goto(`/book?tour=${tourId}`);
  await expect(continueButton(page)).toBeEnabled();
  await request.post(`${fixtureUrl}/__fixture/reset`, { data: { slots: slots.map(slot => slot.id === slots[0].id ? { ...slot, start_time: "2026-10-04T14:00:00Z" } : slot) } });
  await continueButton(page).click();
  await expect(page.getByText("Departure time changed. Choose a departure again.")).toBeVisible();
  await expect(page.locator("[data-selected-departure]")).toContainText("3 October 2026 at 10:00");
  await page.getByRole("button", { name: /Sunday, 4 October 2026/ }).click();
  const updated = page.locator(`[data-slot-id="${slots[0].id}"]`);
  await expect(updated).toHaveAttribute("aria-pressed", "false");
  await updated.click();
  await expect(page.locator("[data-selected-departure]")).toContainText("4 October 2026 at 10:00");
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Complete Booking" })).toBeVisible();
});

test("guest calendar stays aligned without collisions and keeps keyboard departure selection", async ({ page }) => {
  await page.goto(`/book?tour=${tourId}&slot=${slots[0].id}&date=2026-10-03`);
  const calendar = page.locator('[data-shot="calendar"]');
  const selected = calendar.getByRole("button", { name: /Saturday, 3 October 2026/ });
  await expect(selected).toHaveAttribute("aria-pressed", "true");
  await expect(calendar.getByRole("button", { name: /Friday, 2 October 2026/ })).toBeDisabled();
  await expect(calendar.locator('[aria-current="date"]')).toHaveAccessibleName(/today/);

  for (const width of [1440, 1024, 768, 640, 600, 390, 360, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await noOverflow(page);
    const geometry = await calendar.evaluate(element => {
      const dates = Array.from(element.querySelectorAll<HTMLButtonElement>('[data-shot="calendar-day"]'));
      const grid = dates[0].parentElement!;
      const weekdays = Array.from(grid.previousElementSibling!.children, label => label.getBoundingClientRect());
      const cells = dates.map(date => date.getBoundingClientRect());
      const firstColumn = new Date(2026, 9, 1).getDay();
      return {
        aligned: cells.every((cell, i) => Math.abs(cell.x + cell.width / 2 - weekdays[(firstColumn + i) % 7].x - weekdays[(firstColumn + i) % 7].width / 2) < 1),
        colliding: cells.some((cell, i) => cells.slice(i + 1).some(other => Math.min(cell.right, other.right) - Math.max(cell.x, other.x) > 0.1 && Math.min(cell.bottom, other.bottom) - Math.max(cell.y, other.y) > 0.1)),
        usable: cells.every(cell => cell.width >= 40 && cell.height >= 44),
        textFits: dates.every(date => date.scrollWidth <= date.clientWidth),
        gap: parseFloat(getComputedStyle(grid).columnGap),
      };
    });
    expect(geometry).toMatchObject({ aligned: true, colliding: false, usable: true, textFits: true });
    expect(geometry.gap).toBeGreaterThan(0);
    await expect(page.locator(`[data-slot-id="${slots[0].id}"]`)).toHaveAttribute("aria-pressed", "true");
  }

  const available = calendar.getByRole("button", { name: /Sunday, 4 October 2026/ });
  await selected.focus();
  await page.keyboard.press("Tab");
  await expect(available).toBeFocused();
  expect(await available.evaluate(button => button.matches(":focus-visible") && getComputedStyle(button).outlineStyle !== "none")).toBe(true);
  await page.keyboard.press("Enter");
  await expect(available).toHaveAttribute("aria-pressed", "true");
  await expect(continueButton(page)).toBeDisabled();
  const departure = page.locator(`[data-slot-id="${slots[1].id}"]`);
  await departure.focus();
  await page.keyboard.press("Enter");
  await expect(departure).toHaveAttribute("aria-pressed", "true");
  await expect(departure).toHaveAttribute("data-slot-date", slots[1].start_time);
  await expect(departure).toContainText("Selected");
  await expect(continueButton(page)).toBeEnabled();
});

for (const width of [320, 768, 1366]) test(`polish: customer touchpoints at ${width}px`, async ({page}) => {
 test.slow(); await page.setViewportSize({width,height:900});
 for (const path of ['/voucher','/my-bookings','/waiver','/success','/voucher-success','/voucher-confirmed','/cancelled','/terms','/privacy','/cookies','/popia']) {
  await page.goto(path); await expect(page.locator('footer')).toBeVisible(); await noOverflow(page);
  await page.screenshot({path:`${evidence}/polish-${path.slice(1)}-${width}.png`});
 }
 await page.goto('/voucher'); await page.getByRole('button',{name:'R500',exact:true}).click();
 await expect(page.getByRole('button',{name:'R500',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Continue: R500'}).click();
 await expect(page.getByLabel('Recipient Name')).toBeVisible(); await noOverflow(page);
 await page.screenshot({path:`${evidence}/polish-voucher-details-${width}.png`});
 await page.addInitScript(()=>{localStorage.setItem('mb_customer_session','synthetic');localStorage.setItem('mb_customer_email','guest@example.invalid');});
 await page.route('**/functions/v1/my-bookings-lookup',route=>route.fulfill({json:{success:true,bookings:[]}}));
 await page.goto('/my-bookings');
 const trigger=page.getByRole('button',{name:/Need a hand/}); await trigger.click();
 const dialog=page.getByRole('dialog'); await expect(dialog).toBeVisible();
 await dialog.screenshot({path:`${evidence}/polish-contact-${width}.png`});
 await dialog.getByRole('button',{name:'Close',exact:true}).focus(); await page.keyboard.press('Shift+Tab');
 expect(await page.evaluate(()=>document.activeElement===document.body||!!document.activeElement?.closest('dialog'))).toBe(true);
 await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(trigger).toBeFocused();
});

test('polish: review submission keeps the draft after a network failure', async ({page}) => {
 await page.setViewportSize({width:390,height:844});
 await page.route('**/api/review-token/**',route=>route.fulfill({json:{tourName:'Harbour paddle',businessName:'Trail Adventures',reviewerName:'Alex'}}));
 await page.route('**/api/review-submit',route=>route.abort('failed'));
 await page.goto('/review/synthetic');
 await page.getByRole('heading',{name:'How was your trip?'}).waitFor();
 await page.screenshot({path:`${evidence}/polish-review-before.png`});
 await page.getByRole('button',{name:'4 stars',exact:true}).click();
 await expect(page.getByRole('button',{name:'4 stars',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByLabel('Your review').fill('A memorable morning on the water.');
 await page.getByRole('button',{name:'Submit Review'}).click();
 await expect(page.locator('main').getByRole('alert')).toContainText('Please try again');
 await expect(page.getByLabel('Your review')).toHaveValue('A memorable morning on the water.');
 await expect(page.getByRole('button',{name:'Submit Review'})).toBeEnabled();
 await page.route('**/api/review-submit',route=>route.fulfill({json:{success:true}}));
 await page.getByRole('button',{name:'Submit Review'}).click();
 await expect(page.getByRole('heading',{name:'Thank You!'})).toBeVisible();
});
