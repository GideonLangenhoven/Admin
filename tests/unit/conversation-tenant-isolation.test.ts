import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Webchat + WhatsApp conversations are tenant-owned: a chat started on
// jerrys.booking.bookingtours.co.za must only ever surface in jerrys' admin
// inbox. RLS enforces reads, but admin-reply runs on the service role — it
// bypasses RLS, so its own auth + scoping IS the tenant boundary for writes.
//
// Found live: admin-reply accepted unauthenticated calls, trusted the
// client-supplied business_id, and — when business_id was omitted — looked the
// conversation up by bare phone across ALL tenants, then acted (posted as
// "Admin", flipped status, sent via that tenant's WhatsApp credentials) on
// whichever tenant it happened to match.
const REPLY = readFileSync("supabase/functions/admin-reply/index.ts", "utf8");
const INBOX = readFileSync("app/inbox/page.tsx", "utf8");
const BOOKINGS = readFileSync("app/bookings/page.tsx", "utf8");
const WEBCHAT = readFileSync("supabase/functions/web-chat/index.ts", "utf8");

describe("admin-reply is the tenant boundary for conversation writes", () => {
  it("authenticates every caller before touching any table", () => {
    expect(REPLY).toContain("requireAuth(req)");
    expect(REPLY).toContain("status: 401");
  });

  it("refuses to act for a business the caller does not belong to", () => {
    expect(REPLY).toContain('auth.role !== "SUPER_ADMIN" && auth.businessId !== reqBusinessId');
    expect(REPLY).toContain("status: 403");
  });

  it("never resolves a conversation by bare phone across tenants", () => {
    // The old shape: business_id filter applied only `if (reqBusinessId)`.
    expect(REPLY).not.toContain("if (reqBusinessId) convoQuery");
    const lookup = REPLY.slice(REPLY.indexOf('from("conversations")'), REPLY.indexOf(".single()"));
    expect(lookup).toContain('.eq("phone", to)');
    expect(lookup).toContain('.eq("business_id", reqBusinessId)');
  });
});

describe("admin surfaces only render the active tenant's thread", () => {
  it("inbox realtime subscription is filtered to the tenant server- and client-side", () => {
    expect(INBOX).toContain('filter: "business_id=eq." + businessId');
    expect(INBOX).toContain("payload.new.business_id === businessId");
  });

  it("bookings greeting looks up the conversation within the tenant", () => {
    const block = BOOKINGS.slice(BOOKINGS.indexOf("Ensure conversation exists"));
    const lookup = block.slice(0, block.indexOf(".maybeSingle()"));
    expect(lookup).toContain('.eq("phone", phone)');
    expect(lookup).toContain('.eq("business_id", businessId)');
  });
});

describe("web-chat visitor poll stays scoped to one tenant + one visitor", () => {
  it("reads status and admin replies keyed by (business_id, web:<vid>)", () => {
    const poll = WEBCHAT.slice(WEBCHAT.indexOf('body.action === "poll"'), WEBCHAT.indexOf('body.action === "rate"'));
    expect(poll).toContain('.eq("business_id", requestedBusinessId).eq("phone", webPhone)');
    const msgQuery = poll.slice(poll.indexOf('from("chat_messages")'));
    expect(msgQuery).toContain('.eq("business_id", requestedBusinessId).eq("phone", webPhone)');
  });
});
