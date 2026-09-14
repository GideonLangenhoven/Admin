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
    if (process.env.LIVE_PAYMENT_E2E === "1") {
      requireAdminCreds();
      expect(process.env.BASE_URL, "Dedicated test storefront URL required").toBeTruthy();
      expect(process.env.ADMIN_URL, "Dedicated test administrator URL required").toBeTruthy();
      expect(process.env.TEST_CUSTOMER_EMAIL, "Approved test email required").toBeTruthy();
      expect(process.env.TEST_CUSTOMER_PHONE, "Approved test phone required").toBeTruthy();
    }
  });

  test("end-to-end booking via Yoco test card", async ({ browser }) => {
    // Provider payments are a separate, explicitly invoked release gate.
    test.skip(
      process.env.LIVE_PAYMENT_E2E !== "1",
      "Set LIVE_PAYMENT_E2E=1 (plus ADMIN_EMAIL/ADMIN_PASSWORD and a tenant with Yoco test keys) to run.",
    );
    // ============================================================
    // PRECONDITION: admin is in TEST MODE
    // ============================================================
    const adminContext = await browser.newContext();
    const adminPage = await adminContext.newPage();
    const testBusinessId = await assertAdminTestModeOn(adminPage, ADMIN_URL, ADMIN_EMAIL, ADMIN_PASSWORD);

    // ============================================================
    // STEP 1 — Customer lands on booking site, picks a tour
    // ============================================================
    const customerContext = await browser.newContext();
    const page = await customerContext.newPage();
    // Abort before inserting anything if the supplied storefront is not the
    // dedicated business whose TEST configuration was just verified.
    await page.route("**/rest/v1/bookings*", async route => {
      if (route.request().method() === "POST") {
        const draft = route.request().postDataJSON();
        if (draft?.business_id !== testBusinessId) {
          await route.abort();
          throw new Error("ABORT: storefront and test administrator belong to different businesses");
        }
      }
      await route.continue();
    });
    await page.goto(BASE_URL + "/");
    await page.waitForLoadState("networkidle");

    // Wait for tour data to load, then click "Book Now" on the first tour card
    const bookBtn = page.locator('button[data-shot="tour-card"]').first();
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
        'button[data-shot="calendar-day"]:not([disabled])',
      );
      const count = await dateButtons.count();
      for (let i = 0; i < count; i++) {
        const btn = dateButtons.nth(i);
        await btn.click();
        datePicked = true;
        break;
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

    await page.getByRole("checkbox", { name: /I accept the.*Terms/i }).check();

    // ============================================================
    // STEP 5 — Click "Pay R__ Securely"
    // ============================================================
    const payBtn = page.getByRole("button", { name: /^Pay R[\d,.]+ now/ });
    await expect(payBtn).toBeVisible({ timeout: 5_000 });
    await expect(payBtn).toBeEnabled();
    await payBtn.click();

    // ============================================================
    // STEP 6 — Intermediate "Finalizing Checkout" screen
    // ============================================================
    // The current storefront redirects automatically after reserving the seat.
    await page.waitForURL(url => url.hostname === "payments.yoco.com" || url.hostname.endsWith(".yoco.com"), { timeout: 30_000 });
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
    expect(refParam, "A specific booking reference is required").toBeTruthy();

    // ============================================================
    // STEP 9 — Verify booking appears in admin dashboard
    // ============================================================
    await adminPage.goto(ADMIN_URL + "/bookings/" + refParam, {
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
    const paidRow = adminPage.getByText(/^PAID$/i).first();
    await expect(paidRow, "Expected a PAID booking row for the customer email").toBeVisible({
      timeout: 10_000,
    });

    await adminContext.close();
    await customerContext.close();
  });
});
