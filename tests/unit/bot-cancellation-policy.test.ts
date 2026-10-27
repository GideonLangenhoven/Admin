import { describe, expect, it } from "vitest";
import { sourceExports, sourceFunction } from "../helpers/source-handler";
import { webChatFixture } from "../helpers/web-chat-fixture";

// M12: asked what a cancellation 10 hours before the trip refunds, the bots
// said "not sure": the tenant's refund tiers, their summary and the weather
// rule never reached the prompt.
const tiers = [{ hours_before: 24, refund_percent: 100 }, { hours_before: 6, refund_percent: 50 }, { hours_before: 0, refund_percent: 0 }];
const summary = "Cancel free up to 24 hours before your tour for a full refund. Within 24 hours, 50% refund. Within 6 hours of tour start, no refund.";
const tenHours = "• 6 to 24 hours before the start: 50% refund";
const botPrompt = () => sourceExports("supabase/functions/_shared/bot-prompt.ts", {
  "./platform-invariants.ts": { PLATFORM_INVARIANTS: "" },
  "./duration.ts": sourceExports("supabase/functions/_shared/duration.ts", {}),
}) as any;

describe("the bots know the cancellation policy", () => {
  it("states each refund tier, the summary and the weather rule", () => {
    const { cancellationPolicyPrompt } = botPrompt();
    const text = cancellationPolicyPrompt({ refund_policy_tiers: tiers, refund_policy_text: summary });
    expect(text).toContain("• 24 hours or more before the start: 100% refund");
    expect(text).toContain(tenHours);
    expect(text).toContain("• Less than 6 hours before the start: 0% refund");
    expect(text).toContain(summary);
    expect(text).toContain("if we cancel a trip because of the weather");
    expect(cancellationPolicyPrompt({ refund_policy_tiers: [{ hours_before: 48, refund_percent: 100 }] })).toContain("• Less than 48 hours before the start: no refund");
    expect(cancellationPolicyPrompt({})).toBe("");
  });

  it("puts the policy in the web chat prompt", async () => {
    const f = webChatFixture();
    Object.assign(f.business, { refund_policy_tiers: tiers, refund_policy_text: summary });
    await f.post(await f.session(), "What refund do I get if I cancel 10 hours before the trip?");
    const prompts = f.calls.filter(call => call.kind === "llm").map(call => String(call.data.system));
    expect(prompts.some(system => system.includes(tenHours))).toBe(true);
  });

  it("puts the policy in both WhatsApp prompts", () => {
    const { cancellationPolicyPrompt, buildBlockB } = botPrompt();
    const business = { refund_policy_tiers: tiers, refund_policy_text: summary, ai_system_prompt: "", terminology: {}, faq_json: {} };
    const v1 = sourceFunction("supabase/functions/wa-webhook/index.ts", "buildGeminiInstruction", {
      PLATFORM_INVARIANTS: "", cancellationPolicyPrompt, serializeTerminology: () => "", serializeFaqForPrompt: () => "",
    });
    expect(v1({ business })).toContain(tenHours);
    expect(buildBlockB({ name: "Kayak", tours: [], refundPolicyTiers: tiers, refundPolicyText: summary })).toContain(tenHours);
  });

  it("answers the WhatsApp Cancellation Policy button from the policy summary", async () => {
    const answer = sourceFunction("supabase/functions/wa-webhook/index.ts", "getFaqAnswer", { formatTourMeetingPoints: () => "", getActiveTours: async () => [] });
    expect(await answer({ business: { faq_json: {}, refund_policy_text: summary } }, "cancellation")).toBe(summary);
  });
});
