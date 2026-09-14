import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Turning the WhatsApp bot back on left every human-handled conversation
// silent. wa-webhook returns without replying whenever conversations.status is
// HUMAN, and the tenant-level mode toggle only ever wrote to `businesses` — so
// the operator saw "bot on" while the customer got nothing.
//
// Live on Cape Kayak 2026-08-18: an admin replied once at 15:27 (which sets
// HUMAN), the operator toggled the bot off and on again, and the next four
// inbound messages all carried bot_skipped_reason = NULL — proving the mode
// gate passed and the HUMAN check was what silenced the bot.
const ROUTE = readFileSync("app/api/admin/whatsapp/bot-mode/route.ts", "utf8");
const WEBHOOK = readFileSync("supabase/functions/wa-webhook/index.ts", "utf8");

describe("enabling the bot releases human-held conversations", () => {
  // The whole fix lives in the block that runs after the businesses update.
  const resumeBlock = ROUTE.slice(ROUTE.indexOf("let resumedConversations"), ROUTE.indexOf("// Write audit log"));

  it("flips HUMAN conversations back to BOT", () => {
    expect(resumeBlock).toContain('.from("conversations")');
    expect(resumeBlock).toContain('status: "BOT"');
    expect(resumeBlock).toContain('.eq("status", "HUMAN")');
  });

  it("only touches the caller's own tenant", () => {
    // Multi-tenancy: an unscoped update here would hand every operator's
    // conversations back to their bots at once.
    expect(resumeBlock).toContain('.eq("business_id", caller.business_id)');
  });

  it("does not release conversations when the bot is switched OFF", () => {
    // Turning the bot off must leave humans in control of their threads.
    expect(resumeBlock).toMatch(/effectiveMode === "ALWAYS_ON" \|\| effectiveMode === "OUTSIDE_HOURS"/);
    expect(resumeBlock).not.toContain('"OFF"');
  });

  it("does not fail the mode change if the release errors", () => {
    // The mode update already committed; surfacing a 500 would invite the
    // operator to toggle again, which changes nothing.
    expect(resumeBlock).toContain("console.error");
    expect(resumeBlock).not.toMatch(/status:\s*500/);
  });
});

describe("the behaviour this compensates for is still in place", () => {
  it("wa-webhook stays silent on HUMAN conversations", () => {
    // If this ever stops being true the fix above is redundant rather than
    // wrong — but the coupling should be visible when someone changes it.
    const gate = WEBHOOK.slice(WEBHOOK.indexOf('if (convo.status === "HUMAN")'));
    expect(gate.slice(0, 400)).toContain("return;");
  });

  it("a customer can still escape HUMAN mode with a reset keyword", () => {
    expect(WEBHOOK).toContain('status: "BOT", current_state: "IDLE", state_data: {}');
  });
});
