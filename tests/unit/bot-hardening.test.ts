import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const wa = readFileSync("supabase/functions/wa-webhook/index.ts", "utf8");
const web = readFileSync("supabase/functions/web-chat/index.ts", "utf8");

// P0: slot capacity changes must go through the atomic adjust_slot_capacity
// RPC (read-modify-write races leak or oversell capacity).
describe("bot slot updates are atomic (P0)", () => {
  it("both bots define and use the adjustSlotBooked helper", () => {
    expect(wa).toContain("adjust_slot_capacity");
    expect(web).toContain("adjust_slot_capacity");
    expect(wa).toContain("adjustSlotBooked(");
    expect(web).toContain("adjustSlotBooked(");
  });

  it("no inline read-modify-write slot updates remain outside the helper fallback", () => {
    // one .select("booked") remains per file — the helper's RPC-failure fallback
    expect((wa.match(/from\("slots"\)\.select\("booked"\)/g) || []).length).toBe(1);
    expect((web.match(/from\("slots"\)\.select\("booked"\)/g) || []).length).toBe(1);
  });
});

// P0: a booking whose capacity hold failed was never real — delete it
// instead of leaving CANCELLED junk rows.
describe("hold-failure cleanup deletes the junk booking (P0)", () => {
  it("wa-webhook deletes on hold failure", () => {
    expect(wa).toContain('from("bookings").delete().eq("id", booking.id)');
  });
  it("web-chat deletes on hold failure", () => {
    expect(web).toContain('from("bookings").delete().eq("id", bk.id)');
  });
});

// P0: the 24h-window reopen template must be configurable so an approved
// Meta template can be used without a code change.
describe("WhatsApp reopen template configurable (P0)", () => {
  it("uses WA_REOPEN_TEMPLATE env with hello_world fallback", () => {
    expect(wa).toContain('Deno.env.get("WA_REOPEN_TEMPLATE")');
    expect(wa).not.toContain('name: "hello_world"');
  });
});

// P1: the <24h "no refund" hard gate must consult the tenant's policy —
// tiers legitimately define <24h percents (e.g. 12-24h => 50%).
describe("cancel gate is policy-aware (P1)", () => {
  it("wa-webhook offers refund whenever the policy percent > 0", () => {
    expect(wa).toContain("if (cancelPct > 0)");
  });
  it("web-chat offers refund whenever the policy percent > 0", () => {
    expect(web).toContain("if (cnPct > 0)");
    // refund_status must key off the actual refund, not a hardcoded 24h test
    expect(web).not.toContain('refund_status: ns.hours >= 24 ? "REQUESTED" : "NONE"');
  });
});

// P1: guest-removal refunds must match the canonical web path
// (rebook-booking refunds the full excess, no 5% fee).
describe("guest-removal refund parity (P1)", () => {
  it("wa-webhook refunds the full removed-guest amount", () => {
    expect(wa).not.toContain("Guest removal refund (95%)");
    expect(wa).not.toContain("sd.rm_amount * 0.95");
  });
});

// P2: the open web-chat endpoint needs rate limiting.
describe("web-chat rate limiting (P2)", () => {
  it("throttles per client and returns 429", () => {
    expect(web).toContain("429");
    expect(web).toContain("rateLimited");
  });
});
