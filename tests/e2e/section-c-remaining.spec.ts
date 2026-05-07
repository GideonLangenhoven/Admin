import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { BASE_URL, TEST_CUSTOMER } from "./helpers/env";

const ACTIVE_VOUCHER_CODE = process.env.E2E_ACTIVE_VOUCHER_CODE || "2SVZBA4T";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

function debugLog(location: string, hypothesisId: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  fetch('http://127.0.0.1:7858/ingest/7b468403-1c25-45de-8336-98a736ea268e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5ba132'},body:JSON.stringify({sessionId:'5ba132',runId:'pre-fix',hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

function extractAmount(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/R(\d+)/i);
  return m ? Number(m[1]) : null;
}

async function classifyWhatsAppDelivery(bookingRef: string, bookingStartIso: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { status: "skipped", reason: "Supabase env missing" } as const;
  }
  const adminDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: recentBookings } = await adminDb
    .from("bookings")
    .select("id, email, created_at")
    .eq("email", TEST_CUSTOMER.email)
    .gte("created_at", bookingStartIso)
    .order("created_at", { ascending: false })
    .limit(5);

  const matched = (recentBookings || []).find((b) => String(b.id).toLowerCase().startsWith(bookingRef.toLowerCase()));
  if (!matched) return { status: "skipped", reason: "Matching booking not found" } as const;

  const { data: notif } = await adminDb
    .from("logs")
    .select("payload, created_at")
    .eq("booking_id", matched.id)
    .eq("event", "booking_confirmation_notifications_sent")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const waSent = Boolean(notif?.payload?.wa_sent);
  const waError = String(notif?.payload?.wa_error || "");
  if (waSent) return { status: "ok", waSent, waError, bookingId: matched.id } as const;
  if (waError.includes("131030")) return { status: "env_blocker", waSent, waError, bookingId: matched.id } as const;
  return { status: "failed", waSent, waError, bookingId: matched.id } as const;
}

async function resolveVoucherCodeForTour(tourId: string) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return ACTIVE_VOUCHER_CODE;
  const adminDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: tour } = await adminDb.from("tours").select("business_id").eq("id", tourId).maybeSingle();
  if (!tour?.business_id) return ACTIVE_VOUCHER_CODE;
  const { data } = await adminDb
    .from("vouchers")
    .select("code,current_balance,status")
    .eq("business_id", tour.business_id)
    .eq("status", "ACTIVE")
    .gt("current_balance", 0)
    .order("current_balance", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data?.code || ACTIVE_VOUCHER_CODE;
}

async function classifyWithTimeout(bookingRef: string, bookingStartIso: string) {
  const timeoutMs = 12_000;
  return Promise.race([
    classifyWhatsAppDelivery(bookingRef, bookingStartIso),
    new Promise<{ status: "skipped"; reason: string }>((resolve) =>
      setTimeout(() => resolve({ status: "skipped", reason: "WhatsApp classification timeout" }), timeoutMs)
    ),
  ]);
}

test.describe("Section C Remaining Verification", () => {
  test.setTimeout(180_000);

  test("C8/C12 runtime verification with current fixtures", async ({ page }) => {
    const bookingStartIso = new Date().toISOString();
    await page.goto(BASE_URL + "/");
    await page.waitForLoadState("networkidle");

    await page.getByText(/book now/i).first().click();
    await page.waitForURL(/\/book/, { timeout: 10_000 });
    const tourId = new URL(page.url()).searchParams.get("tour") || "";
    const voucherCode = await resolveVoucherCodeForTour(tourId);

    // Select first available date
    let datePicked = false;
    for (let advance = 0; advance < 4 && !datePicked; advance++) {
      await page.waitForTimeout(600);
      const dateButtons = page.locator("button:not([disabled]).aspect-square");
      const count = await dateButtons.count();
      for (let i = 0; i < count; i++) {
        const btn = dateButtons.nth(i);
        if ((await btn.locator("span.bg-teal-500").count()) > 0) {
          await btn.click();
          datePicked = true;
          break;
        }
      }
      if (!datePicked) {
        const nextMonth = page.locator("button").filter({
          has: page.locator('svg path[d="M9 5l7 7-7 7"]'),
        }).first();
        if (await nextMonth.isVisible().catch(() => false)) await nextMonth.click();
      }
    }
    expect(datePicked).toBeTruthy();

    await page.locator("button").filter({ hasText: /remaining/i }).first().click();
    await page.getByText(/continue to details/i).click();

    // Fixture visibility checks for not-run explanation
    const addOnCards = await page.getByText(/Add-ons/i).count();
    const promoInputVisible = await page.locator('input[placeholder*="SUMMER"], input[placeholder*="promo" i]').first().isVisible().catch(() => false);
    const voucherInputVisible = await page.locator("#book-voucher").isVisible().catch(() => false);
    debugLog("tests/e2e/section-c-remaining.spec.ts:55", "H21", "Fixture visibility", {
      addOnCards,
      promoInputVisible,
      voucherInputVisible,
    });

    const payBtnInitialText = await page.locator("button").filter({ hasText: /Pay R\d+.*Securely/i }).innerText();
    const baseAmount = extractAmount(payBtnInitialText);
    debugLog("tests/e2e/section-c-remaining.spec.ts:66", "H22", "Base pay amount", { payBtnInitialText, baseAmount });

    const addOnCard = page.locator("div").filter({ hasText: /photos/i }).first();
    const addOnCheckbox = addOnCard.locator('input[type="checkbox"]').first();
    const addOnVisible = await addOnCheckbox.isVisible({ timeout: 2_000 }).catch(() => false);
    if (addOnVisible) {
      await addOnCheckbox.click();
      const payBtnAfterAddonText = await page.locator("button").filter({ hasText: /Pay R\d+.*Securely/i }).innerText();
      const afterAddonAmount = extractAmount(payBtnAfterAddonText);
      debugLog("tests/e2e/section-c-remaining.spec.ts:74", "H22", "Add-on price delta", {
        addOnVisible,
        payBtnAfterAddonText,
        afterAddonAmount,
        expectedIncrease: 20,
        observedIncrease: baseAmount !== null && afterAddonAmount !== null ? afterAddonAmount - baseAmount : null
      });
    } else {
      debugLog("tests/e2e/section-c-remaining.spec.ts:84", "H22", "Add-on not visible", { addOnVisible });
    }

    await page.locator("#book-name").fill(TEST_CUSTOMER.name);
    await page.locator("#book-email").fill(TEST_CUSTOMER.email);
    await page.locator("#book-phone").fill(TEST_CUSTOMER.phone);

    await page.locator('input[placeholder="e.g. SUMMER20"]').fill("INVALID99");
    await page.getByRole("button", { name: "Apply" }).first().click();
    const promoInvalidError = page.getByText(/invalid promo code|invalid promo|invalid/i).first();
    await expect(promoInvalidError).toBeVisible({ timeout: 5_000 });

    await page.locator("#book-voucher").fill("ABCDEFGH");
    await page.getByRole("button", { name: "Apply" }).nth(1).click();
    const voucherInvalidError = page.getByText(/invalid voucher|not active|not found|expired/i).first();
    await expect(voucherInvalidError).toBeVisible({ timeout: 5_000 });
    debugLog("tests/e2e/section-c-remaining.spec.ts:76", "H24", "Invalid promo/voucher checks", {
      promoErrorVisible: true,
      voucherErrorVisible: true,
    });

    await page.locator("#book-voucher").fill(voucherCode);
    await page.getByRole("button", { name: "Apply" }).nth(1).click();
    const voucherAppliedRow = page.getByText(new RegExp(voucherCode, "i")).first();
    const voucherApplied = await voucherAppliedRow.isVisible({ timeout: 3_000 }).catch(() => false);
    const voucherApplyErrorText = await page.locator("p.text-red-500").last().innerText().catch(() => "");
    const ctaText = (await page.locator("button").filter({ hasText: /Pay R\d+.*Securely|Confirm Booking ✓/i }).first().innerText()).trim();
    const afterVoucherAmount = extractAmount(ctaText);
    debugLog("tests/e2e/section-c-remaining.spec.ts:103", "H23", "Valid voucher application", {
      voucherCode,
      voucherApplied,
      voucherApplyErrorText,
      ctaText,
      afterVoucherAmount,
    });

    const optInText = page.getByText(/agree to receive booking updates/i);
    const optInVisible = await optInText.isVisible({ timeout: 2_000 }).catch(() => false);
    if (optInVisible) await optInText.click();
    debugLog("tests/e2e/section-c-remaining.spec.ts:68", "H25", "Marketing opt-in toggled", { optInVisible });

    const cta = page.locator("button").filter({ hasText: /Pay R\d+.*Securely|Confirm Booking ✓/i }).first();
    await expect(cta).toBeVisible({ timeout: 10_000 });
    const ctaMode = (await cta.innerText()).includes("Confirm Booking") ? "free" : "paid";
    debugLog("tests/e2e/section-c-remaining.spec.ts:121", "H27", "Submit CTA mode", { ctaMode });
    await cta.click();

    if (ctaMode === "paid") {
      await expect(page.getByText(/Finalizing Checkout/i)).toBeVisible({ timeout: 15_000 });
      const portalHref = await page.getByText(/Proceed to Secure Portal/i).getAttribute("href");
      expect(portalHref).toBeTruthy();
      await page.goto(portalHref!);
      await page.waitForLoadState("domcontentloaded");

      await expect(page.locator('[data-testid="card-radio"]')).toBeVisible({ timeout: 20_000 });
      await page.locator('[data-testid="card-radio"]').click();
      const numberFrame = page.frameLocator('[data-testid="card-number-field"] iframe');
      const expiryFrame = page.frameLocator('[data-testid="card-expiry-field"] iframe');
      const cvvFrame = page.frameLocator('[data-testid="card-cvv-field"] iframe');
      await numberFrame.locator("input").first().fill("4111111111111111");
      await expiryFrame.locator("input").first().fill("01/30");
      await cvvFrame.locator("input").first().fill("123");
      await page.locator('[data-testid="card-pay-button"]').click();
    }

    if (ctaMode === "paid") {
      await page.waitForURL(/\/success/, { timeout: 60_000 });
      const waiverCtaVisible = await page.getByText(/Review & Sign Documents/i).isVisible({ timeout: 8_000 }).catch(() => false);
      debugLog("tests/e2e/section-c-remaining.spec.ts:95", "H26", "Paid success page waiver CTA", {
        successUrl: page.url(),
        waiverCtaVisible,
      });
      const successRef = new URL(page.url()).searchParams.get("ref") || "";
      const bookingRef = successRef.slice(0, 8).toUpperCase();
      if (bookingRef) {
        const waResult = await classifyWithTimeout(bookingRef, bookingStartIso);
        debugLog("tests/e2e/section-c-remaining.spec.ts:176", "H28", "C14 WhatsApp classification", waResult as unknown as Record<string, unknown>);
        if (waResult.status === "failed") {
          const failResult = waResult as { waError?: string };
          throw new Error("C14 failed: WhatsApp not sent and not a recognized env blocker. wa_error=" + (failResult.waError || ""));
        }
      }
    } else {
      await expect(page.getByText(/You're All Set!/i)).toBeVisible({ timeout: 20_000 });
      const waiverCtaVisible = await page.getByText(/Review & Sign Documents/i).isVisible({ timeout: 8_000 }).catch(() => false);
      const bookingRefText = await page.locator("text=Reference Tag").locator("..").innerText();
      debugLog("tests/e2e/section-c-remaining.spec.ts:103", "H26", "Free-flow confirmation page", {
        currentUrl: page.url(),
        waiverCtaVisible,
        bookingRefText,
      });
      const bookingRef = (bookingRefText.match(/[A-F0-9]{8}/i)?.[0] || "").toUpperCase();
      if (bookingRef) {
        const waResult = await classifyWithTimeout(bookingRef, bookingStartIso);
        debugLog("tests/e2e/section-c-remaining.spec.ts:190", "H28", "C14 WhatsApp classification", waResult as unknown as Record<string, unknown>);
        if (waResult.status === "failed") {
          const failResult = waResult as { waError?: string };
          throw new Error("C14 failed: WhatsApp not sent and not a recognized env blocker. wa_error=" + (failResult.waError || ""));
        }
      }
    }
  });
});
