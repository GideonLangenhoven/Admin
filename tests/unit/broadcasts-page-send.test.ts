import { describe, expect, it } from "vitest";
import { sourceFunction } from "../helpers/source-handler";

// H5: the Broadcasts page reports what happened on each channel, shows a
// readable error when nothing went out, and a retry after a failure reuses the
// same broadcast id so no guest gets the message twice.
const PAGE = "app/broadcasts/page.tsx";
const broadcastSummary = sourceFunction(PAGE, "broadcastSummary", {});
const emailOnly = {
  ok: true, broadcast_id: "id-1", guests: 1, reached: 1, email: { queued: 1, no_email: 0 },
  whatsapp: { sent: 0, waiting: 0, failed: 0, skipped: { not_connected: 1, no_number: 0, no_opt_in: 0 } },
};

function page(reply: () => Promise<{ ok: boolean; json: () => Promise<unknown> }>) {
  const seen = { requests: [] as any[], results: [] as any[], notices: [] as any[], newIds: [] as string[], cleared: 0 };
  const sendBroadcast = sourceFunction(PAGE, "sendBroadcast", {
    message: "<p>Hi {name}, meet at the slipway.</p>", selectedSlotIds: ["slot-a"], bookings: [{ id: "guest" }],
    businessId: "biz-a", broadcastId: "id-1", SU: "https://fixture.invalid", SK: "anon-key",
    htmlToPlainText: (html: string) => html.replace(/<[^>]+>/g, ""),
    confirmAction: async () => true,
    supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "operator-jwt" } } }) } },
    fetch: async (url: string, init: RequestInit) => { seen.requests.push({ url, body: JSON.parse(String(init.body)) }); return reply(); },
    notify: (n: unknown) => seen.notices.push(n),
    broadcastSummary,
    crypto: { randomUUID: () => "id-2" },
    setSending: () => {}, setResult: (r: unknown) => seen.results.push(r),
    setMessage: () => seen.cleared++, setSelectedSlotIds: () => {}, setBookings: () => {},
    setBroadcastId: (id: string) => seen.newIds.push(id),
  });
  return { sendBroadcast, seen };
}

describe("broadcast summary", () => {
  it("says what happened on each channel", () => {
    expect(broadcastSummary(emailOnly)).toBe("1 email queued. Skipped 1 WhatsApp: WhatsApp not connected.");
    expect(broadcastSummary({
      email: { queued: 3, no_email: 1, unsubscribed: 2 },
      whatsapp: { sent: 1, waiting: 1, failed: 1, skipped: { not_connected: 0, no_number: 2, no_opt_in: 1 } },
    })).toBe("3 emails queued. 1 WhatsApp message sent. 1 WhatsApp message waiting for the guest to reply. "
      + "1 WhatsApp message failed (see Failed Notifications). Skipped 2 WhatsApp: no mobile number, 1 WhatsApp: no WhatsApp opt-in. "
      + "1 guest without an email address. 2 guests unsubscribed from emails.");
  });
});

describe("sending a departure message", () => {
  it("lets the server pick the channels and shows the per-channel summary", async () => {
    const { sendBroadcast, seen } = page(async () => ({ ok: true, json: async () => emailOnly }));
    await sendBroadcast();
    expect(seen.requests).toEqual([{ url: "https://fixture.invalid/functions/v1/broadcast", body: {
      action: "broadcast_targeted", message: "Hi {name}, meet at the slipway.", target_group: "SLOT", slot_ids: ["slot-a"],
      business_id: "biz-a", broadcast_id: "id-1",
    } }]);
    expect(seen.results).toEqual([null, emailOnly]);
    expect(seen.notices).toEqual([{ title: "Broadcast sent", message: "1 email queued. Skipped 1 WhatsApp: WhatsApp not connected.", tone: "success" }]);
    expect(seen.newIds).toEqual(["id-2"]);
  });

  it("warns when some guests could not be reached", async () => {
    const { sendBroadcast, seen } = page(async () => ({ ok: true, json: async () => ({ ...emailOnly, guests: 2, email: { queued: 1, no_email: 1 } }) }));
    await sendBroadcast();
    expect(seen.notices[0]).toMatchObject({ title: "Broadcast partly sent", tone: "warning" });
  });

  it("shows a readable error, keeps the message and reuses the broadcast id on retry", async () => {
    const failed = page(async () => ({ ok: false, json: async () => ({ error: "The emails could not be queued. No messages sent." }) }));
    await failed.sendBroadcast();
    expect(failed.seen.results.at(-1)).toEqual({ error: "The emails could not be queued. No messages sent." });
    expect(failed.seen.notices).toEqual([{ title: "Broadcast not sent", message: "The emails could not be queued. No messages sent.", tone: "error" }]);
    expect([failed.seen.cleared, failed.seen.newIds.length]).toEqual([0, 0]);

    const offline = page(async () => { throw new TypeError("Failed to fetch"); });
    await offline.sendBroadcast();
    expect(offline.seen.results.at(-1)).toEqual({ error: "The broadcast could not be sent. Check your connection and try again." });
    expect(offline.seen.newIds).toEqual([]);
  });
});
