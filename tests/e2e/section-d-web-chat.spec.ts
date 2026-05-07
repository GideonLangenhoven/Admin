import { test, expect } from "@playwright/test";
import { BASE_URL } from "./helpers/env";

async function debugLog(location: string, hypothesisId: string, message: string, data: Record<string, unknown>) {
  // #region agent log
  await fetch('http://127.0.0.1:7858/ingest/7b468403-1c25-45de-8336-98a736ea268e',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'5ba132'},body:JSON.stringify({sessionId:'5ba132',runId:'retry',hypothesisId,location,message,data,timestamp:Date.now()})}).catch(()=>{});
  // #endregion
}

async function openChat(page: import("@playwright/test").Page) {
  await page.goto(BASE_URL + "/", { waitUntil: "domcontentloaded", timeout: 45_000 });
  const okBtn = page.getByRole("button", { name: /^OK$/ });
  if (await okBtn.isVisible({ timeout: 3_000 }).catch(() => false)) await okBtn.click();
  const openBtn = page.getByRole("button", { name: /open chat/i });
  await expect(openBtn).toBeVisible({ timeout: 10_000 });
  await openBtn.click();
  await expect(page.getByRole("button", { name: /close chat/i })).toBeVisible({ timeout: 10_000 });
}

async function sendChat(page: import("@playwright/test").Page, message: string) {
  const chatPanel = page.locator("div.fixed.bottom-6.right-6.w-\\[22rem\\]").first();
  const input = chatPanel.getByLabel(/chat message/i);
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill(message);
  await chatPanel.getByRole("button", { name: /send message/i }).click();
}

test.describe("Section D: Customer Booking Flow (Web Chat)", () => {
  test.setTimeout(240_000);

  test("D1-D4 web chat flow", async ({ page, context }) => {
    // D1: Open chat widget + greeting
    await openChat(page);
    await expect(page.getByText(/hi there/i)).toBeVisible({ timeout: 12_000 });
    await debugLog("tests/e2e/section-d-web-chat.spec.ts:35", "HD1", "Chat opened and greeting visible", { d1: "pass" });

    // D2: Ask general question and verify tour/pricing style response
    await sendChat(page, "what tours do you offer?");
    const tourOrPriceReply = page
      .locator("div")
      .filter({ hasText: /tour|kayak|R\d+/i })
      .last();
    await expect(tourOrPriceReply).toBeVisible({ timeout: 20_000 });
    await debugLog("tests/e2e/section-d-web-chat.spec.ts:44", "HD2", "Tour question answered", { d2: "pass" });

    // D3: Start booking and follow bot prompts until payment link appears
    await sendChat(page, "I want to book");
    const chatPanel = page.locator("div.fixed.bottom-6.right-6.w-\\[22rem\\]").first();
    const paymentLink = chatPanel.getByRole("link", { name: /complete payment/i });
    const typingDots = chatPanel.locator("span.w-2.h-2.rounded-full.bg-gray-400");
    await expect(chatPanel.getByRole("button", { name: /morning kayak/i }).first()).toBeVisible({ timeout: 15_000 });
    await chatPanel.getByRole("button", { name: /morning kayak/i }).first().click();
    if (await typingDots.first().isVisible().catch(() => false)) await expect(typingDots.first()).toBeHidden({ timeout: 10_000 }).catch(() => {});

    let pickedSlot = false;
    const dayButtons = chatPanel.locator("button:not([disabled])").filter({ hasText: /^\d{1,2}$/ });
    const dayCount = Math.min(await dayButtons.count(), 8);
    for (let i = 0; i < dayCount && !pickedSlot; i++) {
      await dayButtons.nth(i).click();
      if (await typingDots.first().isVisible().catch(() => false)) await expect(typingDots.first()).toBeHidden({ timeout: 10_000 }).catch(() => {});
      const timeBtn = chatPanel.locator("button").filter({ hasText: /\b\d{1,2}:\d{2}\b/ }).first();
      if (await timeBtn.isVisible().catch(() => false)) {
        await timeBtn.click();
        pickedSlot = true;
      }
    }

    // Wait for time-pick response before proceeding
    if (pickedSlot) {
      if (await typingDots.first().isVisible().catch(() => false))
        await expect(typingDots.first()).toBeHidden({ timeout: 10_000 }).catch(() => {});
    }

    // Progress: qty → details → (custom fields) → voucher → confirm
    const scriptedReplies = [
      "2",
      "Playwright Test, gidslang89@gmail.com, +27 82 123 4567",
      "none",
      "none",
      "none",
      "none",
    ];
    for (const reply of scriptedReplies) {
      if (await paymentLink.isVisible().catch(() => false)) break;
      if (await chatPanel.getByRole("button", { name: /confirm.*pay/i }).first().isVisible().catch(() => false)) break;
      await sendChat(page, reply);
      if (await typingDots.first().isVisible().catch(() => false))
        await expect(typingDots.first()).toBeHidden({ timeout: 12_000 }).catch(() => {});
    }

    // If still at voucher step, skip it to reach confirm
    if (!await chatPanel.getByRole("button", { name: /confirm.*pay/i }).first().isVisible().catch(() => false)) {
      const noVoucherBtn = chatPanel.getByRole("button", { name: /no voucher/i }).first();
      if (await noVoucherBtn.isVisible().catch(() => false)) {
        await noVoucherBtn.click();
        if (await typingDots.first().isVisible().catch(() => false))
          await expect(typingDots.first()).toBeHidden({ timeout: 12_000 }).catch(() => {});
      }
    }

    // Confirm booking to trigger payment link
    const confirmPayBtn = chatPanel.getByRole("button", { name: /confirm/i }).filter({ hasNotText: /cancel/i }).first();
    await expect(confirmPayBtn).toBeVisible({ timeout: 15_000 });
    await debugLog("tests/e2e/section-d-web-chat.spec.ts:102", "HD3", "Reached confirm & pay button", { pickedSlot });
    for (let i = 0; i < 3; i++) {
      const confirmBtn = chatPanel.getByRole("button", { name: /confirm/i }).filter({ hasNotText: /cancel/i }).first();
      if (!await confirmBtn.isVisible().catch(() => false)) break;
      const label = (await confirmBtn.innerText().catch(() => "")).trim();
      await debugLog("tests/e2e/section-d-web-chat.spec.ts:106", "HD3", "Clicking confirm button", { attempt: i + 1, label });
      await confirmBtn.click();
      if (await typingDots.first().isVisible().catch(() => false))
        await expect(typingDots.first()).toBeHidden({ timeout: 15_000 }).catch(() => {});
    }

    const freeConfirmVisible = await chatPanel.getByRole("button", { name: /confirm \(free\)/i }).first().isVisible().catch(() => false);
    const tryAgainVisible = await chatPanel.getByText(/try again\?/i).last().isVisible().catch(() => false);
    await debugLog("tests/e2e/section-d-web-chat.spec.ts:113", "HD3", "Post-confirm state", { freeConfirmVisible, tryAgainVisible });

    const paymentVisible = await paymentLink.isVisible({ timeout: 25_000 }).catch(() => false);
    if (!paymentVisible && (freeConfirmVisible || tryAgainVisible)) {
      throw new Error("D3 blocker: chat switched to FREE confirm path and returned 'Try again?' without payment link.");
    }
    await expect(paymentLink).toBeVisible({ timeout: 25_000 });
    const paymentHref = await paymentLink.getAttribute("href");
    await debugLog("tests/e2e/section-d-web-chat.spec.ts:108", "HD3", "Payment link visible", { hasHref: Boolean(paymentHref) });

    // D4: Complete payment via Yoco and verify success
    const [checkoutPage] = await Promise.all([
      context.waitForEvent("page"),
      paymentLink.click(),
    ]);
    await checkoutPage.waitForLoadState("domcontentloaded");
    await expect(checkoutPage.locator('[data-testid="card-radio"]')).toBeVisible({ timeout: 30_000 });
    await checkoutPage.locator('[data-testid="card-radio"]').click();
    await checkoutPage.frameLocator('[data-testid="card-number-field"] iframe').locator("input").first().fill("4111111111111111");
    await checkoutPage.frameLocator('[data-testid="card-expiry-field"] iframe').locator("input").first().fill("01/30");
    await checkoutPage.frameLocator('[data-testid="card-cvv-field"] iframe').locator("input").first().fill("123");
    await checkoutPage.locator('[data-testid="card-pay-button"]').click();
    await checkoutPage.waitForURL(/\/success/, { timeout: 90_000 });
    await expect(checkoutPage).toHaveURL(/\/success/);
    await debugLog("tests/e2e/section-d-web-chat.spec.ts:123", "HD4", "Checkout success URL reached", { d4: "pass", url: checkoutPage.url() });
  });
});
