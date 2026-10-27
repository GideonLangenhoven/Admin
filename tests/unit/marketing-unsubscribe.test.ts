import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Item 10 — "Unsubscribe link does nothing". Two real defects:
// (1) the unsubscribe POST handler discarded every DB write's .error and
//     still returned the "you've been unsubscribed" success page even when
//     the status update itself silently failed;
// (2) unsubscribed contacts were never excluded from Broadcast (it reads
//     straight from paid bookings, never checks marketing_contacts.status),
//     and were only checked once — at enqueue time, not send time — for
//     Campaigns and Automations, so an unsubscribe mid-flight was ignored.
describe("marketing unsubscribe (item 10)", () => {
  const unsubscribeFn = readFileSync("supabase/functions/marketing-unsubscribe/index.ts", "utf8");
  const broadcast = readFileSync("supabase/functions/broadcast/index.ts", "utf8");
  const dispatch = readFileSync("supabase/functions/marketing-dispatch/index.ts", "utf8");
  const automationDispatch = readFileSync("supabase/functions/marketing-automation-dispatch/index.ts", "utf8");

  it("the unsubscribe endpoint requires an atomic, tenant-bound transaction before claiming success", () => {
    expect(unsubscribeFn).toContain('supabase.rpc("consume_marketing_unsubscribe"');
    expect(unsubscribeFn).toContain('if (error || !["processed", "already_processed"].includes(result))');
    expect(unsubscribeFn).toContain('"UNSUBSCRIBE_TRANSACTION_FAILED"');
    expect(unsubscribeFn).toContain('.eq("business_id", tokenRow.business_id)');
  });

  it("unsubscribe logs never contain the bearer token", () => {
    expect(unsubscribeFn).not.toContain('" token=" + token');
    expect(unsubscribeFn).not.toContain('metadata: { reason, token }');
  });

  it("broadcast excludes unsubscribed contacts before sending email", () => {
    expect(broadcast).toContain('.eq("status", "unsubscribed")');
    expect(broadcast).toContain("!unsubscribed.has(");
  });

  // H5 (go-live 2026-10-27): broadcast now only sends trip updates to guests
  // booked on the operator's own departures, without an unsubscribe link;
  // promotion to a wider audience is refused and stays with Marketing.
  // Behaviour is covered in broadcast-departure-runtime.test.ts.
  it("broadcast refuses promotion beyond the caller's own departures", () => {
    expect(broadcast).toContain('target_group !== "SLOT"');
    expect(broadcast).toContain('.eq("business_id", business_id).in("id", slotIds)');
  });

  it("campaign dispatch re-checks contact status at send time, not just at enqueue time", () => {
    expect(dispatch).toContain('contact.status !== "active"');
    expect(dispatch).toContain("Recipient unsubscribed before send");
  });

  it("automation dispatch exits an enrollment when the contact has unsubscribed", () => {
    expect(automationDispatch).toContain('contact.status !== "active"');
    expect(automationDispatch).toContain('status: "exited"');
  });
});
