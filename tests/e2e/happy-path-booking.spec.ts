import { test, expect } from "@playwright/test";
import {
  BASE_URL,
  ADMIN_URL,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
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
    // STEP 7 — Pay via Yoco test card
    // ============================================================
    // Yoco hosted checkout uses custom buttons (NOT native radios) with
    // stable data-testid attributes:
    //   data-testid="card-radio"      — selects the Card payment method
    //   data-testid="card-pay-button" — submits the payment
    // In test mode, Yoco pre-fills the test card (4111…1111 / 01/30 / CVC),
    // so we don't need to fill any iframe inputs — just select Card and pay.
    const cardRadio = page.locator('[data-testid="card-radio"]');
    await expect(cardRadio, "Yoco card-radio button not visible — is checkout in test mode?")
      .toBeVisible({ timeout: 15_000 });
    await cardRadio.click();
    await page.waitForTimeout(500);

    // Yoco renders the card number / expiry / CVC inputs in 3 separate
    // PCI iframes (each empty-src), nested inside card-number-field /
    // card-expiry-field / card-cvv-field DIVs. Fill each via frameLocator.
    const numberFrame = page.frameLocator('[data-testid="card-number-field"] iframe');
    const expiryFrame = page.frameLocator('[data-testid="card-expiry-field"] iframe');
    const cvvFrame = page.frameLocator('[data-testid="card-cvv-field"] iframe');
    const numberInput = numberFrame.locator("input").first();
    const expiryInput = expiryFrame.locator("input").first();
    const cvvInput = cvvFrame.locator("input").first();
    await expect(numberInput, "Yoco card-number iframe input not visible").toBeVisible({ timeout: 15_000 });
    await numberInput.click();
    await numberInput.fill("4111111111111111");
    await expect(expiryInput).toBeVisible({ timeout: 5_000 });
    await expiryInput.click();
    await expiryInput.fill("01/30");
    await expect(cvvInput).toBeVisible({ timeout: 5_000 });
    await cvvInput.click();
    await cvvInput.fill("123");
    await page.waitForTimeout(500);

    const yocoPayBtn = page.locator('[data-testid="card-pay-button"]');
    await expect(yocoPayBtn).toBeVisible({ timeout: 10_000 });
    await expect(yocoPayBtn).toBeEnabled({ timeout: 10_000 });
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

    // Find the booking by customer email (unique identifier).
    // Note: the booking site dedupes customers by email, so the on-screen
    // name may be the existing customer record's name rather than what we
    // typed into the form. Email is the stable lookup key.
    const bookingRow = adminPage.getByText(TEST_CUSTOMER.email).first();
    await expect(
      bookingRow,
      "Booking with customer email '" + TEST_CUSTOMER.email + "' should appear in admin bookings",
    ).toBeVisible({ timeout: 15_000 });

    // Verify a PAID booking exists for this customer email.
    // (Other rows with the same email may be EXPIRED — filter for the one
    //  that is also PAID.)
    const paidRow = adminPage
      .locator("tr")
      .filter({ hasText: TEST_CUSTOMER.email })
      .filter({ hasText: /PAID/i })
      .first();
    await expect(paidRow, "Expected a PAID booking row for the customer email").toBeVisible({
      timeout: 10_000,
    });

    await adminContext.close();
    await customerContext.close();
  });
});
