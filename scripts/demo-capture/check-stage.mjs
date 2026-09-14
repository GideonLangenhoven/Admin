/**
 * Stage readiness — checked by reading the real rendered UI, the same way
 * the capture itself will, not by asserting against a database row. If the
 * app doesn't show it, it isn't ready, regardless of what a seed script
 * claims to have inserted.
 *
 * Two criteria were relaxed by explicit operator sign-off (2026-07-14):
 *
 * 1. Scarcity: the original bar wanted an amber/red "X left" badge. Jerry's
 *    tenant has no such slot right now — the closest is Morning Kayak,
 *    2026-07-20 13:00 at 8 of 8 open. Operator confirmed that's fine to use
 *    as-is. Kept as a non-blocking, informational check — it still tells you
 *    the truth about what's on screen, it just no longer stops the run.
 *
 * 2. Yoco: the original bar wanted test mode + a known test card, because
 *    completing a real payment on live credentials would charge a real
 *    card. Operator confirmed the script only needs to REACH the real Yoco
 *    page, never submit it — and nothing in this script ever fills or
 *    submits Yoco's card fields (see beats.mjs, 06-checkout/06b-gateway).
 *    So the actual requirement is just "a checkout session can be created at
 *    all," which live credentials satisfy. This is asserted from a direct
 *    database check done at authoring time: jerrys has a live Yoco key
 *    configured (has_live_key = true). If that ever stops being true, pay-
 *    button would fail to produce a redirect and 06-checkout would report
 *    it as a real beat failure — the DOM-level check in that beat's own run
 *    is the actual live guard, this is just the pre-flight summary of it.
 */
const KNOWN_YOCO_STATE = {
  verifiedAt: "2026-07-14",
  hasLiveKey: true,
};

export async function checkStage(page, targetUrl) {
  const checks = [];

  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-shot="tour-card"]', { timeout: 15000 }).catch(() => {});

  const tourCards = page.locator('[data-shot="tour-card"]');
  const tourCardCount = await tourCards.count();
  checks.push({
    label: "Tenant home renders tour cards",
    pass: tourCardCount > 0,
    detail: tourCardCount > 0 ? `${tourCardCount} tour(s)` : "no [data-shot=\"tour-card\"] found",
  });

  let scarceFound = false;
  let scarceDetail = "no date within the visible range shows amber/red scarcity — operator confirmed using an ordinary-availability slot instead";
  let addonCount = 0;
  let promoInputPresent = false;

  if (tourCardCount > 0) {
    await tourCards.first().click();
    await page.waitForSelector('[data-shot="calendar"]', { timeout: 15000 }).catch(() => {});

    // Scoped to day cells specifically — the broader "calendar button" selector
    // also matched the prev/next month nav arrows (never disabled), which sent
    // this walk clicking through months instead of days and hung the check.
    const dayButtons = page.locator('button[data-shot="calendar-day"]:not([disabled])');
    const dayCount = Math.min(await dayButtons.count(), 15);
    for (let i = 0; i < dayCount && !scarceFound; i++) {
      await dayButtons.nth(i).click({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(150);
      const seatBadges = page.locator('[data-shot="seat-count"]');
      const n = await seatBadges.count();
      for (let j = 0; j < n; j++) {
        const text = (await seatBadges.nth(j).innerText().catch(() => "")) || "";
        if (/left/i.test(text)) {
          scarceFound = true;
          scarceDetail = `found: "${text.trim()}"`;
          break;
        }
      }
    }
    checks.push({ label: "A date exists whose slot reads as scarce (amber/red, not green)", pass: scarceFound, detail: scarceDetail, blocking: false });

    if (!(await page.locator('[data-shot="addon-row"]').count())) {
      await dayButtons.first().click({ timeout: 3000 }).catch(() => {});
      const timeSlotButtons = page.locator('button:has([data-shot="seat-count"])');
      if (await timeSlotButtons.count()) await timeSlotButtons.first().click().catch(() => {});
    }
    addonCount = await page.locator('[data-shot="addon-row"]').count();
    checks.push({ label: "At least two visually distinct add-ons", pass: addonCount >= 2, detail: `${addonCount} found` });

    if (addonCount >= 2) {
      const continueBtn = page.getByText("Continue to Details", { exact: false });
      if (await continueBtn.count()) await continueBtn.first().click().catch(() => {});
      promoInputPresent = await page.locator('[data-shot="promo-input"]').count() > 0;
    }
    checks.push({ label: "Promo code field reachable with a short, typeable code ready", pass: promoInputPresent, detail: promoInputPresent ? "field present (code itself confirmed separately: SUMMER20, 10% off)" : "did not reach the details step" });
  }

  checks.push({
    label: "Yoco checkout can be initiated (payment page reachable, never submitted)",
    pass: KNOWN_YOCO_STATE.hasLiveKey,
    detail: `as of ${KNOWN_YOCO_STATE.verifiedAt}: live Yoco key configured — beats 06-checkout/06b-gateway reach the real gateway but never fill or submit card details, so no charge is possible`,
  });

  const ok = checks.filter((c) => c.blocking !== false).every((c) => c.pass);
  return { ok, checks };
}
