import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Tier 3 (items 16–21) — source-level regression guards. These assert the
// specific mechanisms each fix depends on so a future refactor can't silently
// revert them (the way item 17's request-change had silently never worked).

describe("item 16 — cancel button surfaces in the 12–24h window", () => {
  const card = readFileSync("booking/app/my-bookings/BookingCard.tsx", "utf8");
  it("both hero and card LIMITED branches now render a Cancel action", () => {
    // Two LIMITED tiers (hero + card); each must offer cancel, not just FULL.
    const limitedBlocks = card.split('tier === "LIMITED"').length - 1;
    expect(limitedBlocks).toBeGreaterThanOrEqual(2);
    expect(card).toContain("onCancel(b)");
  });
});

describe("item 17 — request change reaches the operator", () => {
  const rebook = readFileSync("supabase/functions/rebook-booking/index.ts", "utf8");
  const page = readFileSync("booking/app/my-bookings/page.tsx", "utf8");
  it("rebook-booking has a REQUEST_CHANGE action", () => {
    expect(rebook).toContain('"REQUEST_CHANGE"');
    expect(rebook).toContain("handleRequestChange");
  });
  it("REQUEST_CHANGE routes into the inbox and flips the conversation to HUMAN", () => {
    expect(rebook).toContain('.from("chat_messages").insert');
    expect(rebook).toContain('status: "HUMAN"');
    expect(rebook).toContain('type: "OPERATOR_ALERT"');
  });
  it("the customer page no longer does a raw anon chat_messages insert", () => {
    expect(page).not.toContain('tenantSupabase.from("chat_messages").insert');
    expect(page).toContain('action: "REQUEST_CHANGE"');
  });
});

describe("item 19 — broadcast WhatsApp 24h-window routing", () => {
  const broadcast = readFileSync("supabase/functions/broadcast/index.ts", "utf8");
  const waText = readFileSync("supabase/functions/send-whatsapp-text/index.ts", "utf8");
  it("broadcast passes the approved reopener template as out-of-window fallback", () => {
    expect(broadcast).toContain("template_fallback");
    expect(broadcast).toContain("name: reopenerName");
    expect(broadcast).toContain('"booking_update_reopener"');
  });
  it("broadcast logs per-recipient channel routing and falls back to email", () => {
    expect(broadcast).toContain("channelCounts");
    expect(broadcast).toContain("wantEmailFallback");
    expect(broadcast).toContain("BROADCAST_CHANNELS");
  });
  it("send-whatsapp-text returns ok:false (not a 500) so callers can branch", () => {
    expect(waText).toContain("ok: false");
    expect(waText).toContain("via_template");
  });
});

describe("item 20 — Close vs Cancel are distinct slot actions", () => {
  const slots = readFileSync("app/slots/page.tsx", "utf8");
  const weather = readFileSync("supabase/functions/weather-cancel/index.ts", "utf8");
  it("saving a slot no longer cascades a booking cancellation", () => {
    expect(slots).not.toContain('cancellation_reason: "Slot closed by operator"');
    expect(slots).toContain("async function closeSlot");
    expect(slots).toContain("async function cancelSlotAndRefund");
  });
  it("close is status-only; cancel goes through the notify+refund backend", () => {
    expect(slots).toContain('.update({ status: "CLOSED" })');
    expect(slots).toContain("is_weather: false");
  });
  it("weather-cancel supports a non-weather operator cancellation", () => {
    expect(weather).toContain("isWeather");
    expect(weather).toContain('body.is_weather !== false');
  });
});

describe("item 21 — Notifications tab removed, WA-failure toast + email fallback", () => {
  const layout = readFileSync("app/layout.tsx", "utf8");
  const appShell = readFileSync("components/AppShell.tsx", "utf8");
  const adminReply = readFileSync("supabase/functions/admin-reply/index.ts", "utf8");
  it("the Notifications nav entry is gone", () => {
    expect(layout).not.toContain('href: "/notifications"');
  });
  it("the WA-failure watcher is mounted", () => {
    expect(appShell).toContain("<WaFailureWatcher />");
  });
  it("admin-reply falls back to email when WhatsApp can't deliver", () => {
    expect(adminReply).toContain("tryEmailFallback");
    expect(adminReply).toContain("via_email: true");
    expect(adminReply).toContain('type: "CUSTOMER_MESSAGE"');
  });
});

describe("item 18 — POPIA obfuscation covers all PII tables", () => {
  const migration = readFileSync("supabase/migrations/20260706150000_popia_anonymize_full.sql", "utf8");
  const fulfill = readFileSync("app/api/admin/data-requests/[id]/fulfill/route.ts", "utf8");
  it("the anonymizer scrubs invoices, vouchers, conversations, chat + wa messages", () => {
    for (const tbl of ["UPDATE invoices", "UPDATE vouchers", "UPDATE conversations", "UPDATE chat_messages", "UPDATE wa_messages"]) {
      expect(migration).toContain(tbl);
    }
  });
  it("financial columns are retained (only PII is removed)", () => {
    // never scrubs the money columns
    expect(migration).not.toContain("total_amount = NULL");
    expect(migration).not.toContain("invoice_number = NULL");
  });
  it("the fulfill route resolves customer_id from email so customer requests work", () => {
    expect(fulfill).toContain("email_lower");
    expect(fulfill).toContain("p_email: request.email");
  });
});
