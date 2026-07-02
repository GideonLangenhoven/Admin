import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Bot cancellations must action refunds per the tenant's refund_policies
// tiers (calculate_refund_percent RPC — same source as rebook-booking),
// not a hardcoded 95%. A tenant configured for 100% (or tiered 50%)
// refunds was being quoted and actioned at 95% by both bots.
describe("bot cancellation refunds follow tenant refund policy", () => {
  const wa = readFileSync("supabase/functions/wa-webhook/index.ts", "utf8");
  const web = readFileSync("supabase/functions/web-chat/index.ts", "utf8");

  it("wa-webhook computes the cancel percent from refund policy tiers", () => {
    expect(wa).toContain("calculate_refund_percent");
    expect(wa).not.toContain('"95% refund via WhatsApp"');
  });

  it("web-chat computes the cancel percent from refund policy tiers", () => {
    expect(web).toContain("calculate_refund_percent");
    expect(web).not.toContain("You'll receive a 95% refund");
  });

  it("web-chat slot lookup is tenant-scoped", () => {
    expect(web).toContain('.select("id,start_time,tour_id,price_per_person_override").eq("business_id"');
  });
});
