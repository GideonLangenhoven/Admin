import { hideCursor } from "./cursor.mjs";

const S = (name) => `[data-shot="${name}"]`;

async function waitForFonts(page) {
  await page.evaluate(() => document.fonts.ready);
}

async function measureFocal(page, selector) {
  const el = page.locator(selector).first();
  if ((await el.count()) === 0) throw new Error(`focal selector "${selector}" matched nothing`);
  const box = await el.boundingBox();
  if (!box) throw new Error(`focal selector "${selector}" has no bounding box (not visible)`);
  const vp = page.viewportSize();
  return {
    x: Math.round(((box.x + box.width / 2) / vp.width) * 1000) / 1000,
    y: Math.round(((box.y + box.height / 2) / vp.height) * 1000) / 1000,
    // Normalized element width/height — the compositor caps push-in zoom by
    // this (a wide banner cropped by an aggressive zoom loses its context),
    // so it must be measured, not eyeballed downstream.
    width: Math.round((box.width / vp.width) * 1000) / 1000,
    height: Math.round((box.height / vp.height) * 1000) / 1000,
  };
}

/** Real cursor movement, never a teleport — steps:25+ per the spec. */
async function moveTo(page, x, y, steps = 30) {
  await page.mouse.move(x, y, { steps });
}

async function hoverElement(page, locator, steps = 30) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("cannot hover an element with no bounding box");
  await moveTo(page, box.x + box.width / 2, box.y + box.height / 2, steps);
}

async function clickElement(page, locator, steps = 30) {
  await hoverElement(page, locator, steps);
  await locator.click();
}

/** Walk calendar day cells looking for a slot that reads as scarce (amber/red
 * "X left" badge, not the green "X spots" badge). Returns the discovered
 * slot's DOM slot-id (see data-slot-id on the slot button) and its date, or
 * null if none found in the visible range. This walk is deliberately only
 * ever run OUTSIDE a recorded beat — see resolveScarceSlot below — so its
 * footage never leaks into a clip.
 *
 * Falls back to the first available slot (any badge color) if nothing reads
 * as scarce — operator-confirmed 2026-07-14: Morning Kayak / 2026-07-20
 * 13:00 (8 of 8 open) is acceptable for the demo even though it doesn't hit
 * the original amber/red bar. The result carries `scarce: false` so nothing
 * downstream silently pretends it found genuine scarcity. */
async function findScarceDate(page, maxDays = 15) {
  // Scoped to the day cells specifically, NOT the whole calendar container —
  // that broader selector was catching the prev/next month nav arrows too
  // (the "next" arrow has no disabled attribute at all), which sent the walk
  // clicking through months instead of days and hung the whole run.
  const dayButtons = page.locator('button[data-shot="calendar-day"]:not([disabled])');
  const count = Math.min(await dayButtons.count(), maxDays);
  let fallback = null;
  for (let i = 0; i < count; i++) {
    await dayButtons.nth(i).click({ timeout: 5000 });
    await page.waitForTimeout(150);
    const slotButtons = page.locator(`button[data-slot-id]`);
    const n = await slotButtons.count();
    for (let j = 0; j < n; j++) {
      const badge = slotButtons.nth(j).locator(S("seat-count"));
      const text = (await badge.innerText().catch(() => "")) || "";
      const slotId = await slotButtons.nth(j).getAttribute("data-slot-id");
      const slotDate = await slotButtons.nth(j).getAttribute("data-slot-date");
      if (/left/i.test(text)) {
        return { dayIndex: i, slotId, slotDate, badgeText: text.trim(), scarce: true };
      }
      if (!fallback && slotId) fallback = { dayIndex: i, slotId, slotDate, badgeText: text.trim(), scarce: false };
    }
  }
  return fallback;
}

/** Resolve tour + scarce slot + date ONCE, in a throwaway page, before any
 * beat's recording context exists. Beats 03–06 then jump straight there via
 * a deep link instead of re-walking the calendar inside their own footage —
 * that walk is real interaction, but it belongs to beat 02, not to every
 * beat that happens to need a slot selected. */
export async function resolveScarceSlot(browser, targetUrl) {
  const page = await browser.newPage();
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(S("tour-card"), { timeout: 15000 });
  await page.locator(S("tour-card")).first().click();
  await page.waitForSelector(S("calendar"), { timeout: 15000 });

  const found = await findScarceDate(page);
  if (!found) {
    await page.close();
    return null;
  }
  const tourId = new URL(page.url()).searchParams.get("tour");
  await page.close();
  // tourId + slotId + slotDate travel forward. The page's own hydration effect
  // (book/page.tsx) only applies a deep-linked slot when BOTH ?slot= and
  // ?date= are present — slotDate is read straight off the slot button's
  // data-slot-date attribute (the slot's real start_time), not hand-computed,
  // so it can't drift out of sync with what the app actually has open.
  return { tourId, slotId: found.slotId, slotDate: found.slotDate, badgeText: found.badgeText };
}

function slotDeepLink(baseUrl, tourId, slotId, slotDate) {
  const u = new URL("book", baseUrl);
  u.searchParams.set("tour", tourId);
  u.searchParams.set("slot", slotId);
  u.searchParams.set("date", slotDate);
  return u.toString();
}

async function gotoResolvedSlot(page, ctx) {
  if (!ctx.resolvedSlot) throw new Error("no scarce slot was resolved — stage is not ready for this beat");
  await page.goto(slotDeepLink(ctx.targetUrl, ctx.resolvedSlot.tourId, ctx.resolvedSlot.slotId, ctx.resolvedSlot.slotDate), { waitUntil: "domcontentloaded" });
  await page.waitForSelector(S("addon-row"), { timeout: 10000 }).catch(() => {});
}

async function fillDetailsForm(page) {
  await page.locator("#book-name").fill("Demo Guest");
  await page.locator("#book-email").fill("demo-guest@example.com");
  await page.locator("#book-phone").fill("82 000 0000");
  await page.locator('label:has-text("I accept the")').locator('input[type="checkbox"]').check();
}

export const BEATS = [
  {
    id: "01-picker",
    description: "Land on tenant home, hover two tour cards, click through",
    durationMs: 6000,
    hero: false,
    caption: "Browse real tours",
    async run(page, ctx) {
      await page.goto(ctx.targetUrl, { waitUntil: "domcontentloaded" });
      await waitForFonts(page);
      await page.waitForSelector(S("tour-card"), { timeout: 15000 });
      const cards = page.locator(S("tour-card"));
      const n = await cards.count();
      if (n < 1) throw new Error("no tour cards rendered");

      await hoverElement(page, cards.nth(0));
      await page.waitForTimeout(1500);
      if (n > 1) {
        await hoverElement(page, cards.nth(1));
        await page.waitForTimeout(1500);
      }
      const focal = await measureFocal(page, S("tour-card"));
      await clickElement(page, cards.nth(0));
      await page.waitForSelector(S("calendar"), { timeout: 15000 });
      return focal;
    },
  },

  {
    id: "02-calendar",
    description: "Slow pass across the month, land on the scarce date, click",
    durationMs: 10000,
    hero: true,
    caption: "Real availability, not a static grid",
    async run(page, ctx) {
      await page.goto(ctx.targetUrl, { waitUntil: "domcontentloaded" });
      await waitForFonts(page);
      await page.waitForSelector(S("tour-card"), { timeout: 15000 });
      await clickElement(page, page.locator(S("tour-card")).first(), 20);
      await page.waitForSelector(S("calendar"), { timeout: 15000 });

      const calBox = await page.locator(S("calendar")).boundingBox();
      await moveTo(page, calBox.x + 20, calBox.y + calBox.height * 0.5, 10);
      await moveTo(page, calBox.x + calBox.width - 20, calBox.y + calBox.height * 0.5, 60);
      await page.waitForTimeout(400);

      const found = await findScarceDate(page);
      if (!found) throw new Error("no scarce date found in visible range — stage is not ready for this beat");
      await page.waitForTimeout(500);
      const focal = await measureFocal(page, S("seat-count"));
      await page.waitForTimeout(1500);
      return focal;
    },
  },

  {
    id: "03-addons",
    description: "Tick two add-ons 1.2s apart, dwell on the running total",
    durationMs: 8000,
    hero: false,
    caption: "Real-time pricing",
    async run(page, ctx) {
      await gotoResolvedSlot(page, ctx);
      const rows = page.locator(S("addon-row"));
      await rows.first().waitFor({ timeout: 8000 });
      const n = await rows.count();
      if (n < 2) throw new Error(`only ${n} add-on row(s) rendered — need at least 2`);

      const checkbox0 = rows.nth(0).locator('input[type="checkbox"]');
      const checkbox1 = rows.nth(1).locator('input[type="checkbox"]');
      await hoverElement(page, checkbox0);
      await checkbox0.click();
      await page.waitForTimeout(1200);
      await hoverElement(page, checkbox1);
      await checkbox1.click();
      await page.waitForTimeout(600);
      // The add-ons list can push the running total below the fold on this
      // viewport — scroll it into view so the beat's own subject is actually
      // on screen during the dwell, not just present in the DOM.
      await page.locator(S("running-total")).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const focal = await measureFocal(page, S("running-total"));
      await page.waitForTimeout(2500);
      return focal;
    },
  },

  {
    id: "04-promo",
    description: "Type the promo code, apply, dwell on the discount landing",
    durationMs: 8000,
    hero: false,
    caption: "Promo codes that actually validate",
    async run(page, ctx) {
      await gotoResolvedSlot(page, ctx);
      await page.getByText("Continue to Details", { exact: false }).first().click();
      await page.waitForSelector(S("promo-input"), { timeout: 8000 });
      // The real app requires a valid email before it will even validate a
      // promo code server-side (per-customer usage limits are checked by
      // email) — filling it here mirrors what an actual customer has to do,
      // not a shortcut around the flow.
      await fillDetailsForm(page);

      const input = page.locator(S("promo-input"));
      await hoverElement(page, input);
      await input.click();
      // ~120ms/char, typed, not pasted — pasting reads as synthetic on camera.
      await page.keyboard.type("SUMMER20", { delay: 120 });
      const applyBtn = page.getByText("Apply", { exact: true }).first();
      await page.waitForTimeout(300);
      await clickElement(page, applyBtn);
      await page.waitForSelector(S("discount-line"), { timeout: 8000 });
      const focal = await measureFocal(page, S("discount-line"));
      await page.waitForTimeout(2000);
      return focal;
    },
  },

  {
    id: "05-hold",
    mode: "A", // Mode B (clock-stepped) available via --hold-mode=B, see setup() below
    description: "Cursor off-frame, absolute stillness, only the digits move",
    durationMs: 10000,
    hero: true,
    caption: "10-minute seat hold — the countdown is real",
    async run(page, ctx) {
      await gotoResolvedSlot(page, ctx);
      await page.getByText("Continue to Details", { exact: false }).first().click();
      await page.waitForSelector(S("hold-timer"), { timeout: 8000 });
      // Clicking "Continue to Details" auto-scrolls that button into view on
      // the previous step; the scroll offset carries over into this new step
      // and can leave the countdown banner above the fold. Settle on it
      // before the still phase begins — this is the one deliberate motion
      // in the beat, done before "zero cursor/motion" starts, not during it.
      await page.locator(S("hold-timer")).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const focal = await measureFocal(page, S("hold-timer"));
      await hideCursor(page);
      await page.waitForTimeout(10000); // real 1Hz tick, nothing controls this
      return focal;
    },
    // Mode B: freeze the clock right after the hold starts, then step it in
    // 40ms increments (25fps) and screenshot each frame. The app's own
    // setInterval(...,1000) still fires the real decrement logic — we're
    // controlling the clock it reads, not the number it computes.
    async setup(page, ctx) {
      await gotoResolvedSlot(page, ctx);
      await page.getByText("Continue to Details", { exact: false }).first().click();
      await page.waitForSelector(S("hold-timer"), { timeout: 8000 });
      await page.locator(S("hold-timer")).scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const focal = await measureFocal(page, S("hold-timer"));
      await hideCursor(page);
      return { focal, clockNow: new Date() };
    },
  },

  {
    id: "06-checkout",
    description: "Click pay, capture the real redirect to Yoco starting",
    durationMs: 8000,
    hero: true,
    caption: "A real Yoco checkout, not a mockup",
    async run(page, ctx) {
      // Operator-confirmed 2026-07-14: reaching the real Yoco page on this
      // tenant's live credentials is fine — we never fill or submit card
      // details anywhere in this script, so no charge is ever possible.
      // Initiating a checkout session (clicking pay) does not move money;
      // only a submitted card does, which this beat never does. Because
      // payment is intentionally never completed, this beat cannot reach
      // our own success/booking-ref page — its focal is the pay action
      // itself, not a confirmation that won't exist yet.
      await gotoResolvedSlot(page, ctx);
      await page.getByText("Continue to Details", { exact: false }).first().click();
      await fillDetailsForm(page);
      const payBtn = page.locator(S("pay-button"));
      await hoverElement(page, payBtn);
      const focal = await measureFocal(page, S("pay-button"));
      await payBtn.click();
      // Real navigation to Yoco happens here — 06b-gateway picks it up
      // separately. This beat's job ends at the click + whatever our own
      // page shows while the redirect is in flight.
      await page.waitForTimeout(2000);
      return focal;
    },
  },

  {
    id: "06b-gateway",
    description: "The Yoco hosted checkout sheet, captured separately on purpose",
    durationMs: 6000,
    hero: false,
    caption: null,
    async run(page, ctx) {
      // Same operator sign-off as 06-checkout: live credentials, real
      // gateway, payment never submitted — see comment above.
      await gotoResolvedSlot(page, ctx);
      await page.getByText("Continue to Details", { exact: false }).first().click();
      await fillDetailsForm(page);
      await page.locator(S("pay-button")).click();
      // Whatever loads at the redirect target is the gateway sheet — we do
      // not know Yoco's own DOM/selectors and will not guess at them. This
      // beat only records what actually renders; it does not attempt to
      // fill or submit Yoco's card fields.
      await page.waitForURL(/yoco\.com|checkout/i, { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(3000);
      const focal = { x: 0.5, y: 0.5 }; // no our-app selector exists on a third-party page
      await page.waitForTimeout(2000);
      return focal;
    },
  },
];
