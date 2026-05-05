import { test, expect } from "@playwright/test";
import {
  BASE_URL,
  ADMIN_URL,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_CARD,
  TEST_CUSTOMER,
  requireAdminCreds,
} from "./helpers/env";
import { assertAdminTestModeOn } from "./helpers/test-mode-guard";

test.describe("Happy path: customer books, admin sees, confirmation queued", () => {
  test.setTimeout(120_000);

  test.beforeAll(() => {
    requireAdminCreds();
  });

  test("end-to-end booking via Yoco test card", async ({ browser }) => {
    // ============================================================
    // PRECONDITION: admin is in TEST MODE
    // ============================================================
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    await assertAdminTestModeOn(adminPage, ADMIN_URL, ADMIN_EMAIL, ADMIN_PASSWORD);

    // ============================================================
    // STEP 1 — Customer lands on booking site, picks a tour
    // ============================================================
    const customerContext = await browser.newContext();
    const page = await customerContext.newPage();
    await page.goto(BASE_URL + "/");
    await page.waitForLoadState("networkidle");

    // Wait for tour data to load, then click "Book Now" on the first tour card
    const bookBtn = page.getByText(/book now/i).first();
    await expect(bookBtn).toBeVisible({ timeout: 20_000 });
    await bookBtn.click();

    // Should land on /book?tour=...
    await page.waitForURL(/\/book/, { timeout: 10_000 });

    // ============================================================
    // STEP 2 — Pick the first available date
    // ============================================================
    // Available dates are <button> elements that are NOT disabled, containing a
    // green teal dot (<span> with bg-teal-500). Advance months if needed.
    let datePicked = false;
    for (let advance = 0; advance < 4 && !datePicked; advance++) {
      // Wait for calendar to load
      await page.waitForTimeout(800);
      const dateButtons = page.locator(
        "button:not([disabled]).aspect-square",
      );
      const count = await dateButtons.count();
      for (let i = 0; i < count; i++) {
        const btn = dateButtons.nth(i);
        // Check the button has the green dot indicator (available date)
        const dot = btn.locator("span.bg-teal-500");
        if ((await dot.count()) > 0) {
          await btn.click();
          datePicked = true;
          break;
        }
      }
      if (!datePicked) {
        // Click next-month arrow
        const nextMonth = page.locator("button").filter({
          has: page.locator('svg path[d="M9 5l7 7-7 7"]'),
        });
        if ((await nextMonth.count()) > 0) {
          await nextMonth.first().click();
        }
      }
    }
    expect(datePicked, "No available date found in 4 months").toBeTruthy();

    // ============================================================
    // STEP 3 — Pick the first available time slot
    // ============================================================
    await page.waitForTimeout(600);
    const slotBtn = page.locator("button").filter({
      hasText: /remaining/i,
    }).first();
    await expect(slotBtn).toBeVisible({ timeout: 10_000 });
    await slotBtn.click();

    // Click "Continue to Details"
    const continueBtn = page.getByText(/continue to details/i);
    await expect(continueBtn).toBeVisible({ timeout: 5_000 });
    await continueBtn.click();

    // ============================================================
    // STEP 4 — Fill customer details
    // ============================================================
    await page.locator("#book-name").fill(TEST_CUSTOMER.name);
    await page.locator("#book-email").fill(TEST_CUSTOMER.email);
    await page.locator("#book-phone").fill(TEST_CUSTOMER.phone);

    // Check marketing opt-in if visible
    const optIn = page.getByText(/agree to receive/i);
    if (await optIn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await optIn.click();
    }

    // ============================================================
    // STEP 5 — Click "Pay R__ Securely"
    // ============================================================
    const payBtn = page.locator("button").filter({ hasText: /Pay R\d+.*Securely/i });
    await expect(payBtn).toBeVisible({ timeout: 5_000 });
    await expect(payBtn).toBeEnabled();
    await payBtn.click();

    // ============================================================
    // STEP 6 — Intermediate "Finalizing Checkout" screen
    // ============================================================
    await expect(page.getByText(/Finalizing Checkout/i)).toBeVisible({ timeout: 10_000 });
    const portalLink = page.getByText(/Proceed to Secure Portal/i);
    await expect(portalLink).toBeVisible({ timeout: 10_000 });

    // Navigate to Yoco hosted checkout
    const portalHref = await portalLink.getAttribute("href");
    expect(portalHref, "Yoco checkout URL should be present").toBeTruthy();

    // Follow the link — Yoco hosted checkout is on a different domain
    await page.goto(portalHref!);
    await page.waitForLoadState("domcontentloaded");

    // ============================================================
    // STEP 7 — Fill Yoco test card details
    // ============================================================
    // Yoco hosted checkout may use iframes for PCI compliance or direct inputs.
    // We try both approaches.
    const cardInput = page.locator(
      'input[name*="card"], input[placeholder*="card" i], input[data-testid*="card"], input[autocomplete="cc-number"]',
    ).first();

    const cardFrame = page.frameLocator("iframe").first();
    let usedFrame = false;

    if (await cardInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      // Direct inputs on the page
      await cardInput.fill(TEST_CARD);
      await page
        .locator('input[name*="exp"], input[placeholder*="MM" i], input[autocomplete="cc-exp"]')
        .first()
        .fill("1230");
      await page
        .locator('input[name*="cvv" i], input[name*="cvc" i], input[placeholder*="CVV" i], input[autocomplete="cc-csc"]')
        .first()
        .fill("123");
    } else {
      // Try inside an iframe
      usedFrame = true;
      const iframeCard = cardFrame.locator(
        'input[name*="card"], input[placeholder*="card" i], input[autocomplete="cc-number"]',
      ).first();
      await expect(iframeCard).toBeVisible({ timeout: 15_000 });
      await iframeCard.fill(TEST_CARD);
      await cardFrame
        .locator('input[name*="exp"], input[placeholder*="MM" i], input[autocomplete="cc-exp"]')
        .first()
        .fill("1230");
      await cardFrame
        .locator('input[name*="cvv" i], input[name*="cvc" i], input[placeholder*="CVV" i], input[autocomplete="cc-csc"]')
        .first()
        .fill("123");
    }

    // Click the Yoco pay/submit button
    const yocoPayBtn = page.locator("button[type='submit'], button").filter({
      hasText: /pay/i,
    }).first();
    await yocoPayBtn.click();

    // ============================================================
    // STEP 8 — Land on success page
    // ============================================================
    await page.waitForURL(/\/success/, { timeout: 60_000 });
    await expect(
      page.getByText(/confirmed|you're confirmed|all set/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Extract booking reference from URL or page content
    const successUrl = page.url();
    const refParam = new URL(successUrl).searchParams.get("ref");

    // ============================================================
    // STEP 9 — Verify booking appears in admin dashboard
    // ============================================================
    await adminPage.goto(ADMIN_URL + "/bookings", {
      waitUntil: "domcontentloaded",
    });
    await adminPage.waitForLoadState("networkidle");

    // The bookings page groups by day → slot → individual bookings.
    // Individual booking rows show customer_name and StatusBadge.
    // We need to find "Playwright Test" on the page. It may be inside
    // a collapsed slot row, so expand all slots first.
    await adminPage.waitForTimeout(3_000);

    // Look for "Expand All" checkboxes and check them
    const expandAll = adminPage.getByText(/expand all/i);
    const expandCount = await expandAll.count();
    for (let j = 0; j < expandCount; j++) {
      const cb = expandAll.nth(j);
      if (await cb.isVisible()) {
        await cb.click();
      }
    }
    await adminPage.waitForTimeout(1_000);

    // Find the booking by customer name
    const bookingRow = adminPage.getByText(TEST_CUSTOMER.name).first();
    await expect(
      bookingRow,
      "Booking with customer name '" + TEST_CUSTOMER.name + "' should appear in admin bookings",
    ).toBeVisible({ timeout: 15_000 });

    // Verify PAID status badge near the customer name
    const row = adminPage.locator("tr").filter({ hasText: TEST_CUSTOMER.name }).first();
    await expect(row.getByText(/PAID/i).first()).toBeVisible({ timeout: 5_000 });

    await adminContext.close();
    await customerContext.close();
  });
});
