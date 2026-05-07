import { test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { ADMIN_URL, ADMIN_EMAIL, ADMIN_PASSWORD } from "./helpers/env";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function debugLog(location: string, hypothesisId: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  await fetch('http://127.0.0.1:7858/ingest/7b468403-1c25-45de-8336-98a736ea268e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5ba132'},body:JSON.stringify({sessionId:'5ba132',runId:'section-e',hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

test.describe("Section E: Manual/Admin Booking Probe", () => {
  test.setTimeout(120_000);

  test("probe E1-E11 paths with runtime evidence", async ({ page }) => {
    const businessId = "c8b439f5-c11e-4d46-b347-943df6f172b4";
    await page.goto(ADMIN_URL + "/", { waitUntil: "domcontentloaded" });
    await page.goto(ADMIN_URL + "/new-booking", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await debugLog("tests/e2e/section-e-admin-probe.spec.ts:30", "HE1", "Opened admin new-booking", { url: page.url() });

    const uiSnapshot = await page.evaluate(() => {
      const headings = Array.from(document.querySelectorAll("h1,h2,h3")).map((n) => (n.textContent || "").trim()).filter(Boolean).slice(0, 12);
      const buttons = Array.from(document.querySelectorAll("button")).map((n) => (n.textContent || "").trim()).filter(Boolean).slice(0, 20);
      const placeholders = Array.from(document.querySelectorAll("input[placeholder]")).map((n) => (n.getAttribute("placeholder") || "").trim()).filter(Boolean).slice(0, 20);
      return { headings, buttons, placeholders };
    });
    await debugLog("tests/e2e/section-e-admin-probe.spec.ts:35", "HE5", "New booking UI snapshot", uiSnapshot);
    const loginVisible = uiSnapshot.headings.some((h) => /admin dashboard/i.test(h)) && uiSnapshot.buttons.some((b) => /sign in/i.test(b));
    await debugLog("tests/e2e/section-e-admin-probe.spec.ts:38", "HE1", "Login-gate detection", { loginVisible });
    if (loginVisible && ADMIN_EMAIL && ADMIN_PASSWORD) {
      const programmaticLogin = await page.evaluate(async ({ email, password }) => {
        try {
          const res = await fetch("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password }),
          });
          const data: any = await res.json().catch(() => ({}));
          if (!res.ok || !data?.session?.access_token || !data?.admin?.email) {
            return { ok: false, error: data?.error || "login api failed", status: res.status };
          }
          const projectRef = "ukdsrndqhsatjkmxijuj";
          const storageKey = "sb-" + projectRef + "-auth-token";
          localStorage.setItem(storageKey, JSON.stringify(data.session));
          localStorage.setItem("ck_admin_auth", "true");
          localStorage.setItem("ck_admin_role", data.admin.role || "");
          localStorage.setItem("ck_admin_email", data.admin.email || "");
          localStorage.setItem("ck_admin_time", String(Date.now()));
          localStorage.setItem("ck_admin_name", data.admin.name || "");
          localStorage.setItem("ck_admin_settings_perms", JSON.stringify(data.admin.settings_permissions || {}));
          if (data.admin.business_id) localStorage.setItem("ck_admin_business_id", data.admin.business_id);
          document.cookie = "ck_session_hint=1;path=/;max-age=86400;SameSite=Lax";
          return { ok: true };
        } catch (e: any) {
          return { ok: false, error: String(e?.message || e) };
        }
      }, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      await debugLog("tests/e2e/section-e-admin-probe.spec.ts:44", "HE1", "Programmatic login result", programmaticLogin as Record<string, unknown>);
      await page.waitForTimeout(1200);
      const loginDiag = await page.evaluate(() => {
        const err = Array.from(document.querySelectorAll("p")).map((n) => (n.textContent || "").trim()).find((t) =>
          /incorrect|invalid|failed|locked|required|error/i.test(t)
        ) || "";
        return {
          ckAdminEmail: localStorage.getItem("ck_admin_email") || "",
          ckAdminRole: localStorage.getItem("ck_admin_role") || "",
          hasSessionHint: document.cookie.includes("ck_session_hint=1"),
          err,
        };
      });
      await debugLog("tests/e2e/section-e-admin-probe.spec.ts:44", "HE1", "Post sign-in diagnostics", loginDiag);
      await page.goto(ADMIN_URL + "/new-booking", { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1000);
      await debugLog("tests/e2e/section-e-admin-probe.spec.ts:47", "HE1", "Performed UI login retry", { url: page.url() });
      const postLoginSnapshot = await page.evaluate(() => {
        const headings = Array.from(document.querySelectorAll("h1,h2,h3")).map((n) => (n.textContent || "").trim()).filter(Boolean).slice(0, 16);
        const buttons = Array.from(document.querySelectorAll("button")).map((n) => (n.textContent || "").trim()).filter(Boolean).slice(0, 30);
        const placeholders = Array.from(document.querySelectorAll("input[placeholder]")).map((n) => (n.getAttribute("placeholder") || "").trim()).filter(Boolean).slice(0, 30);
        return { headings, buttons, placeholders };
      });
      await debugLog("tests/e2e/section-e-admin-probe.spec.ts:51", "HE5", "Post-login new booking UI snapshot", postLoginSnapshot);
      const stillLogin = postLoginSnapshot.headings.includes("Admin Dashboard") && postLoginSnapshot.buttons.includes("Sign In");
      if (stillLogin) {
        await debugLog("tests/e2e/section-e-admin-probe.spec.ts:54", "HE1", "Login still not established after retry", { stillLogin: true });
        throw new Error("Admin login did not establish session in probe run.");
      }
    }

    // E2/E4/E5 visibility probe
    const manualDiscountVisible = await page.getByText(/manual price override|price adjustment/i).first().isVisible().catch(() => false);
    const promoInputVisible = await page.getByPlaceholder(/promo code|enter promo code/i).first().isVisible().catch(() => false);
    const addOnVisible = await page.getByText(/add-ons subtotal|add-ons/i).first().isVisible().catch(() => false);
    await debugLog("tests/e2e/section-e-admin-probe.spec.ts:36", "HE2", "Discount/promo/add-on controls", {
      manualDiscountVisible,
      promoInputVisible,
      addOnVisible,
    });

    // E1 create manual booking (best-effort)
    const chooseService = page.getByText(/choose a service/i).first();
    if (await chooseService.isVisible().catch(() => false)) {
      await chooseService.click();
      const morningOption = page.getByText(/morning kayak/i).first();
      if (await morningOption.isVisible().catch(() => false)) await morningOption.click();
    }
    const availableDate = page.locator("button:not([disabled])").filter({ hasText: /^\d{1,2}$/ }).first();
    const dateButtonCount = await page.locator("button:not([disabled])").filter({ hasText: /^\d{1,2}$/ }).count();
    await debugLog("tests/e2e/section-e-admin-probe.spec.ts:57", "HE5", "Date button count", { dateButtonCount });
    if (await availableDate.isVisible().catch(() => false)) await availableDate.click({ timeout: 3000 }).catch(() => {});
    await sleep(400);
    const slotBtn = page.locator("button").filter({ hasText: /remaining|spots|\b\d{1,2}:\d{2}\b/i }).first();
    if (await slotBtn.isVisible().catch(() => false)) await slotBtn.click({ timeout: 3000 }).catch(() => {});
    await sleep(300);
    const nameInput = page.getByPlaceholder(/name/i).first();
    const emailInput = page.getByPlaceholder(/email/i).first();
    const phoneInput = page.getByPlaceholder(/phone|mobile/i).first();
    if (await nameInput.isVisible().catch(() => false)) await nameInput.fill("Section E Admin");
    if (await emailInput.isVisible().catch(() => false)) await emailInput.fill("gidslang89@gmail.com");
    if (await phoneInput.isVisible().catch(() => false)) await phoneInput.fill("+27 82 123 4567");
    const customFieldInput = page.getByPlaceholder(/yes, no, or a little bit/i).first();
    if (await customFieldInput.isVisible().catch(() => false)) await customFieldInput.fill("No");
    const statusSelect = page.locator("select").first();
    if (await statusSelect.isVisible().catch(() => false)) await statusSelect.selectOption("PAID").catch(() => {});

    const createBtn = page.getByRole("button", { name: /create booking/i }).first();
    const createVisible = await createBtn.isVisible().catch(() => false);
    const createEnabled = createVisible ? await createBtn.isEnabled().catch(() => false) : false;
    await debugLog("tests/e2e/section-e-admin-probe.spec.ts:104", "HE1", "Create button state", { createVisible, createEnabled });
    if (createVisible && createEnabled) {
      await createBtn.click({ timeout: 5000 }).catch(() => {});
    }
    await sleep(2000);
    const possibleErrorText = await page.locator("p").filter({ hasText: /invalid|required|failed|could not|format/i }).first().innerText().catch(() => "");
    const postCreateButtons = await page.evaluate(() => Array.from(document.querySelectorAll("button")).map((n) => (n.textContent || "").trim()).filter(Boolean).slice(0, 20));
    await debugLog("tests/e2e/section-e-admin-probe.spec.ts:59", "HE1", "Create booking attempt", {
      createVisible,
      createEnabled,
      postCreateUrl: page.url(),
      possibleErrorText,
      postCreateButtons,
    });

    // Probe bookings page for E6/E8/E11 action availability
    await page.goto(ADMIN_URL + "/bookings", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    const firstRowToggle = page.locator("tr").first();
    if (await firstRowToggle.isVisible().catch(() => false)) await firstRowToggle.click().catch(() => {});
    await page.waitForTimeout(400);
    const payLinkVisible = await page.getByRole("button", { name: /pay link/i }).first().isVisible().catch(() => false);
    const markPaidVisible = await page.getByRole("button", { name: /mark paid/i }).first().isVisible().catch(() => false);
    const checkInVisible = await page.getByText(/present|check in/i).first().isVisible().catch(() => false);
    const bookingActionButtons = await page.evaluate(() => Array.from(document.querySelectorAll("button")).map((n) => (n.textContent || "").trim()).filter(Boolean).slice(0, 40));
    await debugLog("tests/e2e/section-e-admin-probe.spec.ts:70", "HE3", "Bookings actions visibility", {
      payLinkVisible,
      markPaidVisible,
      checkInVisible,
      bookingActionButtons,
    });

    // DB evidence snapshot for latest booking by probe email
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (supabaseUrl && serviceRole) {
      const db = createClient(supabaseUrl, serviceRole, { auth: { persistSession: false } });
      const latest = await db
        .from("bookings")
        .select("id,status,total_amount,original_total,discount_type,discount_amount,promo_code,created_at,business_id")
        .eq("email", "gidslang89@gmail.com")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      await debugLog("tests/e2e/section-e-admin-probe.spec.ts:85", "HE4", "Latest booking snapshot", {
        found: Boolean(latest.data?.id),
        status: latest.data?.status || null,
        total: latest.data?.total_amount ?? null,
        original: latest.data?.original_total ?? null,
        discountType: latest.data?.discount_type || null,
        promoCode: latest.data?.promo_code || null,
      });
    } else {
      await debugLog("tests/e2e/section-e-admin-probe.spec.ts:95", "HE4", "Skipped DB snapshot", { reason: "missing env" });
    }
  });
});
