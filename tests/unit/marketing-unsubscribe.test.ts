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

  it("the unsubscribe endpoint checks the status-update error before claiming success", () => {
    expect(unsubscribeFn).toContain('const { error: statusErr } = await supabase.from("marketing_contacts")');
    expect(unsubscribeFn).toContain("if (statusErr)");
    expect(unsubscribeFn).toContain("console.error(\"UNSUBSCRIBE_STATUS_UPDATE_FAILED");
  });

  it("failed unsubscribe attempts are logged, not silently discarded", () => {
    expect(unsubscribeFn).toContain("UNSUBSCRIBE_TOKEN_MARK_FAILED");
    expect(unsubscribeFn).toContain("UNSUBSCRIBE_EVENT_LOG_FAILED");
    expect(unsubscribeFn).toContain("UNSUBSCRIBE_COUNTER_FAILED");
  });

  it("broadcast excludes unsubscribed contacts before sending email", () => {
    expect(broadcast).toContain('.eq("status", "unsubscribed")');
    expect(broadcast).toContain("unsubscribedEmails.has(emailLowerRaw)");
  });

  it("broadcast fails closed instead of sending with a blank unsubscribe link", () => {
    expect(broadcast).toContain("if (!unsubscribeUrl)");
  });

  it("campaign dispatch re-checks contact status at send time, not just at enqueue time", () => {
    expect(dispatch).toContain("unsubscribedContactIds.has(item.contact_id)");
    expect(dispatch).toContain("Recipient unsubscribed before send");
  });

  it("automation dispatch exits an enrollment when the contact has unsubscribed", () => {
    expect(automationDispatch).toContain('contact.status === "unsubscribed"');
    expect(automationDispatch).toContain('status: "exited"');
  });
});
